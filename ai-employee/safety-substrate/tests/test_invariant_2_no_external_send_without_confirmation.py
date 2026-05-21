"""Invariant 2: no outbound external send without explicit current-turn confirmation.

Email send, SMS send, social post, calendar invite to external attendees,
draft committed to a public surface — all gated. Even autonomous skills
cannot fire an external send without the operator's approval in the
current invocation.

Failure mode this protects against: a misconfigured prompt or compromised
tool result causing a skill to fire an outbound message to a customer
or third party.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from adapter.trust_ceiling import ActionClass, Ceiling, enforce


def run() -> tuple[bool, str]:
    # Scenario A: draft_for_review skill, external send, no approval — drafted, not sent
    decision = enforce(
        ceiling=Ceiling.DRAFT_FOR_REVIEW,
        action=ActionClass.EXTERNAL_SEND,
        skill_name="inbox-triage",
        tool_name="gmail.send",
        current_turn_approval=False,
    )
    if decision.allowed:
        return (
            False,
            f"FAIL: draft_for_review external_send was allowed, should route to draft (audit={decision.audit_action})",
        )
    if decision.audit_action != "draft":
        return (
            False,
            f"FAIL: draft_for_review external_send should audit as 'draft', got '{decision.audit_action}'",
        )

    # Scenario B: autonomous skill, external send, no approval — refused
    decision = enforce(
        ceiling=Ceiling.AUTONOMOUS,
        action=ActionClass.EXTERNAL_SEND,
        skill_name="ar-chaser",
        tool_name="gmail.send",
        current_turn_approval=False,
    )
    if decision.allowed:
        return (
            False,
            f"FAIL: autonomous external_send WITHOUT approval was allowed (audit={decision.audit_action})",
        )
    if decision.audit_action != "refuse":
        return (
            False,
            f"FAIL: autonomous external_send no approval should refuse, got '{decision.audit_action}'",
        )

    # Scenario C: autonomous skill, external send, WITH approval — allowed
    decision = enforce(
        ceiling=Ceiling.AUTONOMOUS,
        action=ActionClass.EXTERNAL_SEND,
        skill_name="ar-chaser",
        tool_name="gmail.send",
        current_turn_approval=True,
    )
    if not decision.allowed:
        return (
            False,
            f"FAIL: autonomous external_send WITH approval should be allowed ({decision.reason})",
        )

    # Scenario D: refused-ceiling skill, external send, with approval — still refused
    decision = enforce(
        ceiling=Ceiling.REFUSED,
        action=ActionClass.EXTERNAL_SEND,
        skill_name="never-runs",
        tool_name="gmail.send",
        current_turn_approval=True,
    )
    if decision.allowed:
        return (
            False,
            f"FAIL: refused-ceiling skill should never execute anything, got allowed ({decision.reason})",
        )

    return (True, "PASS: invariant 2 holds — external send gated by approval; draft routes to folder; refused blocks all")


if __name__ == "__main__":
    ok, msg = run()
    print(msg)
    sys.exit(0 if ok else 1)
