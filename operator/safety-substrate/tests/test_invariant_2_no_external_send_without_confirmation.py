"""Invariant 2: external send is gated by the CONFIGURED ceiling and the
vertical floor — and the agent can never exceed either.

Reshaped per ADR 0025. The old invariant asserted "no external send without
current-turn confirmation" — a hardcoded refusal of every autonomous send.
ADR 0025 makes exposure a configurable ceiling per action class, so the
invariant is now:

  - `external_send` defaults to draft_for_review (reviewer-as-sender). An
    autonomous *skill scalar* does NOT grant autonomous send; it must be
    raised explicitly via `action_ceilings[external_send] = autonomous`.
  - An explicit autonomous override permits the send (the new capability).
  - A vertical-pack floor can only narrow: a floor of draft_for_review beats a
    customer override of autonomous, so a regulated vertical (e.g. law) keeps
    reviewer-as-sender even if the customer tries to raise it.
  - A skill whose scalar ceiling is `refused` runs nothing at all.

Failure mode this still protects against: a misconfigured prompt or
compromised tool result causing a skill to fire an outbound message it was
not configured to send autonomously. Authorization comes from authored config
(customer.yaml + vertical floor), never from model claims or the in-turn
approval flag (that flag governs the reversibility classes; see invariant 5).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from adapter.trust_ceiling import ActionClass, Ceiling, enforce


def run() -> tuple[bool, str]:
    # Scenario A: default external_send (no override) drafts, never sends.
    decision = enforce(
        ceiling=Ceiling.DRAFT_FOR_REVIEW,
        action=ActionClass.EXTERNAL_SEND,
        skill_name="inbox-triage",
        tool_name="gmail.send",
        current_turn_approval=False,
    )
    if decision.allowed or decision.audit_action != "draft":
        return (
            False,
            f"FAIL: default external_send should draft, got allowed={decision.allowed} "
            f"audit={decision.audit_action}",
        )

    # Scenario B: an autonomous SKILL scalar does NOT auto-grant external send.
    # Without an explicit action_ceilings override, external_send still drafts.
    decision = enforce(
        ceiling=Ceiling.AUTONOMOUS,
        action=ActionClass.EXTERNAL_SEND,
        skill_name="ar-chaser",
        tool_name="gmail.send",
        current_turn_approval=False,
    )
    if decision.allowed or decision.audit_action != "draft":
        return (
            False,
            f"FAIL: autonomous skill scalar must NOT silently grant external send; "
            f"expected draft, got allowed={decision.allowed} audit={decision.audit_action}",
        )

    # Scenario C: explicit action_ceilings override permits autonomous send.
    decision = enforce(
        ceiling=Ceiling.DRAFT_FOR_REVIEW,
        action=ActionClass.EXTERNAL_SEND,
        skill_name="ar-chaser",
        tool_name="gmail.send",
        current_turn_approval=False,
        action_ceilings={ActionClass.EXTERNAL_SEND: Ceiling.AUTONOMOUS},
    )
    if not decision.allowed or decision.audit_action != "allow":
        return (
            False,
            f"FAIL: explicit external_send=autonomous should send, got allowed={decision.allowed} "
            f"audit={decision.audit_action} ({decision.reason})",
        )

    # Scenario D: explicit external_send=refused blocks the send outright.
    decision = enforce(
        ceiling=Ceiling.AUTONOMOUS,
        action=ActionClass.EXTERNAL_SEND,
        skill_name="ar-chaser",
        tool_name="gmail.send",
        current_turn_approval=False,
        action_ceilings={ActionClass.EXTERNAL_SEND: Ceiling.REFUSED},
    )
    if decision.allowed or decision.audit_action != "refuse":
        return (
            False,
            f"FAIL: external_send=refused should refuse, got allowed={decision.allowed} "
            f"audit={decision.audit_action}",
        )

    # Scenario E: a vertical floor can only NARROW. A floor of draft_for_review
    # beats a customer override of autonomous — the regulated-vertical guarantee.
    decision = enforce(
        ceiling=Ceiling.AUTONOMOUS,
        action=ActionClass.EXTERNAL_SEND,
        skill_name="ar-chaser",
        tool_name="gmail.send",
        current_turn_approval=False,
        action_ceilings={ActionClass.EXTERNAL_SEND: Ceiling.AUTONOMOUS},
        vertical_floors={ActionClass.EXTERNAL_SEND: Ceiling.DRAFT_FOR_REVIEW},
    )
    if decision.allowed or decision.audit_action != "draft":
        return (
            False,
            f"FAIL: vertical floor draft_for_review must beat customer override autonomous; "
            f"expected draft, got allowed={decision.allowed} audit={decision.audit_action}",
        )

    # Scenario F: a skill whose scalar ceiling is refused runs nothing — even an
    # external_send=autonomous override cannot revive a disabled skill.
    decision = enforce(
        ceiling=Ceiling.REFUSED,
        action=ActionClass.EXTERNAL_SEND,
        skill_name="never-runs",
        tool_name="gmail.send",
        current_turn_approval=True,
        action_ceilings={ActionClass.EXTERNAL_SEND: Ceiling.AUTONOMOUS},
    )
    if decision.allowed:
        return (
            False,
            f"FAIL: refused-scalar skill should never execute anything, got allowed ({decision.reason})",
        )

    return (
        True,
        "PASS: invariant 2 holds — external send gated by configured ceiling; "
        "autonomous skill scalar does not auto-grant send; explicit override sends; "
        "vertical floor narrows; refused scalar blocks all",
    )


if __name__ == "__main__":
    ok, msg = run()
    print(msg)
    sys.exit(0 if ok else 1)
