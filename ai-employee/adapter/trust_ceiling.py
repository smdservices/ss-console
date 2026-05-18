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

For Phase A this module is a stub; Phase A.5 fills in real enforcement.
"""

from __future__ import annotations

import enum
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


def enforce(
    *,
    ceiling: Ceiling,
    action: ActionClass,
    skill_name: str,
    tool_name: str,
    current_turn_approval: bool = False,
) -> EnforcementDecision:
    """Return whether this tool call is allowed under the current trust ceiling.

    `current_turn_approval` is True iff the operator explicitly approved
    this specific action in the current invocation. Approvals from prior
    turns or prior sessions are NOT valid (per safety invariant #1).

    Phase A: this is a stub — returns allow for READ + INTERNAL_WRITE, draft
    for EXTERNAL_SEND, refuse for COMMITMENT + DESTRUCTIVE. Phase A.5 wires
    this into Hermes' tool dispatch and runs it against five invariant
    fixtures.
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
    if action == ActionClass.COMMITMENT:
        if not current_turn_approval:
            return EnforcementDecision(
                allowed=False,
                reason="commitment action requires explicit current-turn approval",
                audit_action="refuse",
            )
        return EnforcementDecision(allowed=True, reason="commitment with current-turn approval", audit_action="allow")

    # DESTRUCTIVE requires current-turn approval (invariant #1)
    if action == ActionClass.DESTRUCTIVE:
        if not current_turn_approval:
            return EnforcementDecision(
                allowed=False,
                reason="destructive action requires explicit current-turn approval",
                audit_action="refuse",
            )
        return EnforcementDecision(allowed=True, reason="destructive with current-turn approval", audit_action="allow")

    # EXTERNAL_SEND requires current-turn approval unless skill is autonomous (invariant #2)
    if action == ActionClass.EXTERNAL_SEND:
        if ceiling == Ceiling.AUTONOMOUS and current_turn_approval:
            return EnforcementDecision(allowed=True, reason="autonomous send with approval", audit_action="allow")
        if ceiling == Ceiling.AUTONOMOUS:
            # Even autonomous skills don't send to external parties without explicit approval
            return EnforcementDecision(
                allowed=False,
                reason="external_send requires explicit current-turn approval even for autonomous skills",
                audit_action="refuse",
            )
        # draft_for_review: produce the draft, don't send
        return EnforcementDecision(
            allowed=False,
            reason="skill is draft_for_review; produce draft to notes folder instead of sending",
            audit_action="draft",
        )

    # INTERNAL_WRITE: autonomous OK, draft_for_review writes to notes folder
    if action == ActionClass.INTERNAL_WRITE:
        if ceiling == Ceiling.AUTONOMOUS:
            return EnforcementDecision(allowed=True, reason="autonomous internal write", audit_action="allow")
        # draft_for_review: allow write but route to notes folder
        return EnforcementDecision(allowed=True, reason="internal write routed to draft folder", audit_action="draft")

    # Unknown action class
    return EnforcementDecision(
        allowed=False,
        reason=f"unknown action class {action}; defaulting to refuse",
        audit_action="refuse",
    )
