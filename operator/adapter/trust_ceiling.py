"""Trust-ceiling enforcement — the safety floor under every skill.

Phase A.5 deliverable. Each tool call from the model passes through
`enforce()`, which inspects:

  - the current skill's declared trust_ceiling (from SKILL.md frontmatter)
  - the customer.yaml ceiling override (cannot raise above authored)
  - the tool being invoked + its declared action class (read / write /
    send / delete / commit)

and refuses any action that violates the ceiling. Refusals are logged to
the customer's audit log and surfaced in the per-fixture grading trail.

The enforcement runs in code, not in prompt. Prompt drift cannot escalate
a skill — the model can ask all it wants; the adapter says no.

Per ADR 0025, autonomy is enforced as a configurable ceiling **per action
class**, not one scalar applied to the whole skill. Per ADR 0035, the harness
imposes **no default posture**: `enforce()` resolves the effective ceiling for
an action as the most restrictive of {vertical floor, the customer's explicit
per-action override, the unauthored resolution}. The `external_send` class,
when no ceiling is authored, is **fail-closed** (`refused` — no send, no draft);
`draft_for_review` is a value the engagement authors
explicitly, never a fallback. An authored ceiling can never be raised above a
vertical-pack floor, and the agent can never raise its own ceiling (that is a
control-plane act, ADR 0026).
"""

from __future__ import annotations

import enum
from collections.abc import Mapping
from dataclasses import dataclass


class Ceiling(str, enum.Enum):
    AUTONOMOUS = "autonomous"
    DRAFT_FOR_REVIEW = "draft_for_review"
    REFUSED = "refused"


class ActionClass(str, enum.Enum):
    """Categorization of every tool call by reversibility / blast radius."""

    READ = "read"  # Always allowed
    INTERNAL_WRITE = "internal_write"  # Notes, drafts, internal state — autonomous OK
    EXTERNAL_SEND = "external_send"  # Email, SMS, Slack-to-external, posts — gated
    COMMITMENT = "commitment"  # Sign, accept terms, agree to dates — never autonomous
    DESTRUCTIVE = "destructive"  # Delete, drop, irreversible — explicit per-call approval


@dataclass(frozen=True)
class EnforcementDecision:
    allowed: bool
    reason: str
    audit_action: str  # "allow" | "draft" | "refuse"


# Restrictiveness ordering: higher number == more restrictive. Used to pick
# the most-restrictive ceiling when combining a configured value with a
# vertical-pack floor (a floor can only narrow, never widen — ADR 0025).
_RESTRICTIVENESS: dict[Ceiling, int] = {
    Ceiling.AUTONOMOUS: 0,
    Ceiling.DRAFT_FOR_REVIEW: 1,
    Ceiling.REFUSED: 2,
}


def _most_restrictive(a: Ceiling, b: Ceiling) -> Ceiling:
    return a if _RESTRICTIVENESS[a] >= _RESTRICTIVENESS[b] else b


def _unauthored_resolution(action: ActionClass, skill_ceiling: Ceiling) -> Ceiling:
    """How an action class resolves when the engagement authored NO ceiling for
    it. There is no imposed posture (ADR 0035): an unauthored entitled action is
    fail-closed (`refused`) — it does not execute, and no draft is produced.
    `draft_for_review` is a value an engagement authors
    explicitly, never a fallback.

    `READ` resolves to `autonomous` at this layer because read *breadth* is
    governed by the authored scope envelope one layer over (an engagement that
    authors no scope can read nothing — fail-closed by the same principle).
    `INTERNAL_WRITE` follows the skill's authored scalar ceiling (authored in
    SKILL.md frontmatter). Every other entitled class with no authored ceiling
    is `refused`."""
    if action == ActionClass.READ:
        return Ceiling.AUTONOMOUS
    if action == ActionClass.INTERNAL_WRITE:
        return skill_ceiling
    # EXTERNAL_SEND and any unrecognized entitled class: no authored grant means
    # no action (ADR 0035 fail-closed). COMMITMENT / DESTRUCTIVE additionally
    # carry their own current-turn-approval reversibility floors in enforce().
    return Ceiling.REFUSED


def resolve_ceiling(
    action: ActionClass,
    skill_ceiling: Ceiling,
    action_ceilings: Mapping[ActionClass, Ceiling] | None = None,
    vertical_floors: Mapping[ActionClass, Ceiling] | None = None,
) -> Ceiling:
    """Resolve the effective ceiling for one action class.

    Effective = most restrictive of:
      - the customer's explicit per-action override (if present), else the
        unauthored resolution (fail-closed for entitled classes, ADR 0035); and
      - the vertical-pack floor for that class (if present).

    A vertical floor can only make the result *more* restrictive — customer
    config can never raise above it (ADR 0025 / ADR 0022 compliance floors).
    """
    explicit = action_ceilings.get(action) if action_ceilings else None
    base = explicit if explicit is not None else _unauthored_resolution(action, skill_ceiling)
    floor = vertical_floors.get(action) if vertical_floors else None
    return _most_restrictive(base, floor) if floor is not None else base


def enforce(
    *,
    ceiling: Ceiling,
    action: ActionClass,
    skill_name: str,
    tool_name: str,
    current_turn_approval: bool = False,
    action_ceilings: Mapping[ActionClass, Ceiling] | None = None,
    vertical_floors: Mapping[ActionClass, Ceiling] | None = None,
) -> EnforcementDecision:
    """Return whether this tool call is allowed under the configured ceilings.

    `ceiling` is the skill-level scalar (governs `internal_write` and acts as
    the cap). `action_ceilings` are the customer's explicit per-action-class
    overrides; `vertical_floors` are non-raisable per-class floors from the
    vertical pack. Both optional — when omitted, the unauthored resolution
    applies (ADR 0035): entitled classes such as `external_send` are
    fail-closed (`refused` — no send, no draft) until the engagement authors a
    ceiling. The `draft_for_review` posture is an authored value, not a
    fallback posture.

    `current_turn_approval` is True iff the operator explicitly approved this
    specific action in the current invocation. Approvals from prior turns or
    prior sessions are NOT valid (safety invariant #1). It gates the
    reversibility classes (COMMITMENT, DESTRUCTIVE); `external_send` autonomy is
    governed by the configured ceiling, not by an in-turn approval (ADR 0025).
    """
    # REFUSED ceiling: nothing executes
    if ceiling == Ceiling.REFUSED:
        return EnforcementDecision(
            allowed=False,
            reason=f"skill {skill_name} has trust_ceiling=refused; tool {tool_name} blocked",
            audit_action="refuse",
        )

    # READ always allowed regardless of ceiling
    if action == ActionClass.READ:
        return EnforcementDecision(allowed=True, reason="read action", audit_action="allow")

    # COMMITMENT never autonomous (invariant #3)
    # Draft_for_review skills never originate commitments — escalate to autonomous
    # authorship if you want commitment-capable behavior.
    if action == ActionClass.COMMITMENT:
        if ceiling == Ceiling.DRAFT_FOR_REVIEW:
            return EnforcementDecision(
                allowed=False,
                reason="draft_for_review skills do not originate commitments; produce draft instead",
                audit_action="draft",
            )
        if not current_turn_approval:
            return EnforcementDecision(
                allowed=False,
                reason="commitment action requires explicit current-turn approval",
                audit_action="refuse",
            )
        return EnforcementDecision(allowed=True, reason="commitment with current-turn approval", audit_action="allow")

    # DESTRUCTIVE requires current-turn approval (invariant #1)
    # Draft_for_review skills never originate destructive actions — they only
    # produce text for human review. If a skill needs to destruct, author it as
    # autonomous and gate via approval there.
    if action == ActionClass.DESTRUCTIVE:
        if ceiling == Ceiling.DRAFT_FOR_REVIEW:
            return EnforcementDecision(
                allowed=False,
                reason="draft_for_review skills do not originate destructive actions; report instead",
                audit_action="refuse",
            )
        if not current_turn_approval:
            return EnforcementDecision(
                allowed=False,
                reason="destructive action requires explicit current-turn approval",
                audit_action="refuse",
            )
        return EnforcementDecision(allowed=True, reason="destructive with current-turn approval", audit_action="allow")

    # EXTERNAL_SEND: governed by the resolved per-action ceiling (ADR 0025/0035).
    # autonomous → send; draft_for_review (an AUTHORED value) → draft; refused →
    # block. Unauthored external_send is fail-closed (refused), not draft (ADR
    # 0035 — no imposed default). No in-turn-approval escape: exposure autonomy is
    # configured, not approved per message.
    if action == ActionClass.EXTERNAL_SEND:
        eff = resolve_ceiling(action, ceiling, action_ceilings, vertical_floors)
        if eff == Ceiling.AUTONOMOUS:
            return EnforcementDecision(
                allowed=True,
                reason="external_send permitted: configured ceiling is autonomous",
                audit_action="allow",
            )
        if eff == Ceiling.REFUSED:
            return EnforcementDecision(
                allowed=False,
                reason="external_send refused: configured ceiling (or vertical floor) is refused",
                audit_action="refuse",
            )
        # draft_for_review — an AUTHORED draft_for_review ceiling (not a default)
        return EnforcementDecision(
            allowed=False,
            reason="external_send at authored draft_for_review ceiling; routing to draft",
            audit_action="draft",
        )

    # INTERNAL_WRITE: governed by the resolved per-action ceiling (defaults to
    # the skill scalar). autonomous → write; draft_for_review → route to draft;
    # refused (only if explicitly set) → block.
    if action == ActionClass.INTERNAL_WRITE:
        eff = resolve_ceiling(action, ceiling, action_ceilings, vertical_floors)
        if eff == Ceiling.AUTONOMOUS:
            return EnforcementDecision(allowed=True, reason="autonomous internal write", audit_action="allow")
        if eff == Ceiling.REFUSED:
            return EnforcementDecision(
                allowed=False,
                reason="internal_write refused by configured ceiling",
                audit_action="refuse",
            )
        # draft_for_review: allow write but route to notes folder
        return EnforcementDecision(allowed=True, reason="internal write routed to draft folder", audit_action="draft")

    # Unknown action class
    return EnforcementDecision(
        allowed=False,
        reason=f"unknown action class {action}; defaulting to refuse",
        audit_action="refuse",
    )
