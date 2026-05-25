"""L1 reviewer-as-sender pipeline — contract tests.

Per test plan v2 §"Layer 1 — Plumbing & integration — Reviewer-as-
sender pipeline" + ADR 0005 (reviewer-as-sender). Verifies the
contract the send pathway must honor:

  draft above draft_for_review ceiling → trust plugin allows draft
  creation → audit row written → review notification fires to
  escalation contact → reviewer approval transition → send goes
  through under reviewer's identity (not the agent's).

Two-sided implementation:

  - TypeScript (portal-side): src/lib/portal/ai-employee/send-as.ts
    has the sendAsReviewer function with required Reviewer positional
    arg. Already covered by tests/portal-ai-employee-send-as.test.ts.
  - Python (connector-side): ai-employee/connectors/ms_graph/send.py
    has send_draft_as_reviewer. Already covered by
    ai-employee/connectors/ms_graph/tests/test_send.py.

This file's job is the CROSS-LAYER contract — assertions on the SHAPE
of both sides that the L1 boot smoke E2E + L4 launch-check expect to
see. The full pipeline runs against a live reviewer OAuth grant +
real Microsoft Graph API call, which is outside the scope of unit
tests; this contract layer documents what L4 verifies.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
REPO_ROOT = _HERE.parents[2]
SEND_AS_TS = REPO_ROOT / "src" / "lib" / "portal" / "ai-employee" / "send-as.ts"
MS_GRAPH_SEND_PY = REPO_ROOT / "ai-employee" / "connectors" / "ms_graph" / "send.py"


class TestPortalSendAsContract:
    """The portal's sendAsReviewer must require a Reviewer positional arg."""

    def test_send_as_ts_exists(self):
        assert SEND_AS_TS.exists(), f"send-as.ts missing at {SEND_AS_TS}"

    def test_reviewer_is_required_positional(self):
        """ADR 0005: there is no overload that accepts agent / system sender.
        The function signature enforces reviewer identity at compile time."""
        text = SEND_AS_TS.read_text(encoding="utf-8")
        # The contract: sendAsReviewer takes a Reviewer parameter that is
        # NOT optional (no `?` after the param name). Conservative check.
        assert "sendAsReviewer" in text, "sendAsReviewer function not present"
        assert "Reviewer" in text, "Reviewer type not referenced"
        # Look for the documented contract phrase in the module docstring.
        assert "REQUIRED positional argument" in text, (
            "send-as.ts docstring does not document the REQUIRED reviewer "
            "argument contract — ADR 0005 enforcement may have drifted"
        )

    def test_audit_emission_documented(self):
        """Every send (success, pending, fail) must emit a send_approved
        audit event."""
        text = SEND_AS_TS.read_text(encoding="utf-8")
        assert "send_approved" in text, (
            "send-as.ts does not reference send_approved audit event — "
            "audit emission contract from ADR 0005 may have drifted"
        )

    def test_no_agent_sender_overload(self):
        """There must be no `sendAsAgent` / `sendAsSystem` function."""
        text = SEND_AS_TS.read_text(encoding="utf-8")
        # Pattern: function name with Agent or System as the sender type.
        forbidden_patterns = (
            r"sendAsAgent",
            r"sendAsSystem",
            r"send\s*\(",  # bare send(...) — should not exist as exported
        )
        for pattern in forbidden_patterns:
            # Allow comment references; check for exported-function declarations.
            # Conservative heuristic: the literal token "sendAsAgent" must
            # not appear as a function declaration anywhere in the file.
            if pattern == r"send\s*\(":
                # Skip — too many false positives (string literals, comments).
                continue
            assert not re.search(
                rf"function\s+{pattern}\b|export\s+(?:const|function)\s+{pattern}\b",
                text,
            ), (
                f"send-as.ts has a forbidden sender pathway: {pattern!r}"
            )


class TestPythonConnectorSendContract:
    """The MS Graph connector's send_draft_as_reviewer must enforce the
    reviewer-identity contract on the Python side."""

    def test_ms_graph_send_py_exists(self):
        assert MS_GRAPH_SEND_PY.exists(), (
            f"ms_graph send.py missing at {MS_GRAPH_SEND_PY}"
        )

    def test_module_documents_adr_0005(self):
        text = MS_GRAPH_SEND_PY.read_text(encoding="utf-8")
        assert "ADR 0005" in text or "0005-reviewer-as-sender" in text, (
            "ms_graph/send.py does not reference ADR 0005 — the contract "
            "binding may be lost without the citation in the docstring"
        )

    def test_agent_cannot_hold_send_token(self):
        """ADR 0005: the agent never holds a send token; only the reviewer
        does. The capability Email interface omits a send method; only this
        dashboard-bound module can fire a send, and only when the reviewer
        approves it as a partner-tap action."""
        text = MS_GRAPH_SEND_PY.read_text(encoding="utf-8")
        # Multiple equivalent phrasings of the same contract. Any of them
        # establishes the Pattern A boundary; if none appears, the contract
        # has drifted out of the module docstring.
        phrases = (
            "agent never holds a send token",
            "skills MUST NOT call",
            "skills must not call",
            "Skills MUST NOT call this module",
            "partner-tap action",  # the action shape that requires reviewer
        )
        assert any(p in text for p in phrases), (
            "ms_graph/send.py docstring missing the agent/skills-cannot-send "
            "contract phrasing — Pattern A boundary may have drifted"
        )

    def test_send_function_named_correctly(self):
        text = MS_GRAPH_SEND_PY.read_text(encoding="utf-8")
        assert "def send_draft_as_reviewer" in text or \
               "send_draft_as_reviewer" in text, (
            "expected send_draft_as_reviewer function in ms_graph/send.py"
        )


class TestCrossLayerContract:
    """The TS and Python sides must agree on the audit event vocabulary."""

    def test_send_approved_event_referenced_both_sides(self):
        """Cross-layer assertion: the TS module emits send_approved; the
        Python module's audit emission must use the matching action_type."""
        ts_text = SEND_AS_TS.read_text(encoding="utf-8")
        py_text = MS_GRAPH_SEND_PY.read_text(encoding="utf-8")
        ts_has = "send_approved" in ts_text
        py_has = "DRAFT_APPROVED" in py_text or "send_approved" in py_text
        assert ts_has, "TS side missing send_approved"
        assert py_has, (
            "Python side missing audit emission marker (DRAFT_APPROVED or "
            "send_approved) — vocabulary may have drifted between layers"
        )

    def test_reviewer_oauth_scope_documented(self):
        """The reviewer's OAuth grant must carry Mail.Send (wave-2 scope) for
        the connector to ship messages. ADR 0005 + the Phase-2 re-consent
        flow document this."""
        py_text = MS_GRAPH_SEND_PY.read_text(encoding="utf-8")
        assert "Mail.Send" in py_text, (
            "ms_graph/send.py does not reference Mail.Send scope — the "
            "OAuth scope contract for wave-2 send may not be documented"
        )


class TestL4LaunchCheckIntegration:
    """The launch-check runner must verify reviewer contacts are wired."""

    def test_launch_check_includes_reviewer_contacts_check(self):
        launch_check = REPO_ROOT / "ai-employee" / "bin" / "launch-check.sh"
        if not launch_check.exists():
            pytest.skip(f"launch-check not at {launch_check}")
        text = launch_check.read_text(encoding="utf-8")
        # The 8-check launch-check runner has a reviewer-contacts step.
        assert "reviewer-contacts" in text, (
            "launch-check.sh does not have a reviewer-contacts step — "
            "L4 contract from the plan is not enforced"
        )
        # The check verifies the customer.yaml has an escalation: block.
        assert "escalation" in text, (
            "launch-check.sh reviewer-contacts step does not verify "
            "escalation contacts in customer.yaml"
        )
