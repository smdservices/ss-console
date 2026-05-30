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
class**, not one scalar applied to the whole skill. `enforce()` resolves the
effective ceiling for an action as the most restrictive of {vertical floor,
the customer's explicit per-action override, the safe class default}. The
`external_send` class defaults to `draft_for_review` (reviewer-as-sender) and
must be *explicitly* raised to `autonomous` in `action_ceilings` to permit an
autonomous send — and can never be raised above a vertical-pack floor. The
agent can never raise its own ceiling (that is a control-plane act, ADR 0026).
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


def _class_default(action: ActionClass, skill_ceiling: Ceiling) -> Ceiling:
    """The safe default ceiling for an action class when no explicit override
    is authored. `external_send` defaults to draft_for_review regardless of
    the skill's scalar, so an autonomous skill does not silently gain the
    ability to send externally — it must be granted explicitly (ADR 0025)."""
    if action == ActionClass.READ:
        return Ceiling.AUTONOMOUS
    if action == ActionClass.INTERNAL_WRITE:
        return skill_ceiling
    if action == ActionClass.EXTERNAL_SEND:
        return Ceiling.DRAFT_FOR_REVIEW
    # COMMITMENT / DESTRUCTIVE keep their own reversibility floors in enforce();
    # this default only matters if those branches ever consult it.
    return Ceiling.DRAFT_FOR_REVIEW


def resolve_ceiling(
    action: ActionClass,
    skill_ceiling: Ceiling,
    action_ceilings: Mapping[ActionClass, Ceiling] | None = None,
    vertical_floors: Mapping[ActionClass, Ceiling] | None = None,
) -> Ceiling:
    """Resolve the effective ceiling for one action class.

    Effective = most restrictive of:
      - the customer's explicit per-action override (if present), else the
        safe class default; and
      - the vertical-pack floor for that class (if present).

    A vertical floor can only make the result *more* restrictive — customer
    config can never raise above it (ADR 0025 / ADR 0022 compliance floors).
    """
    explicit = action_ceilings.get(action) if action_ceilings else None
    base = explicit if explicit is not None else _class_default(action, skill_ceiling)
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
    vertical pack. Both optional — when omitted, the safe class defaults apply
    (notably `external_send` → draft_for_review), preserving reviewer-as-sender
    as the default until a customer explicitly raises the exposure ceiling.

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

    # EXTERNAL_SEND: governed by the resolved per-action ceiling (ADR 0025).
    # autonomous → send; draft_for_review (the default) → draft; refused → block.
    # No in-turn-approval escape: exposure autonomy is configured, not approved
    # per message. The hardcoded "always require approval" refusal is gone.
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
        # draft_for_review — the safe default and the reviewer-as-sender path
        return EnforcementDecision(
            allowed=False,
            reason="external_send below autonomous ceiling; routing to draft (reviewer-as-sender)",
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
