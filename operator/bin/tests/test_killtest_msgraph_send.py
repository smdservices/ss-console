"""The kill test's own guardrails (ss#2499).

A script that deliberately transmits an unaudited message into a real mailbox is
worth exactly as much as its fence. These tests pin the fence and the shape of
what it sends; the send itself is a Captain act and is not performed here.
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

_BIN = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "killtest_msgraph_send", _BIN / "killtest-msgraph-send.py"
)
kill = importlib.util.module_from_spec(_spec)
sys.modules["killtest_msgraph_send"] = kill
_spec.loader.exec_module(kill)


def test_the_paying_firms_seat_is_refused():
    """A client's mailbox is the client's. Posting a message into it to see
    whether our watchdog barks would leave an unexplained artifact in a firm's
    own correspondence -- and SMD has no UI access there, so the firm would be
    the only party who could see it."""
    with pytest.raises(kill.KillTestRefused) as exc:
        kill.guard("ashton-price")
    assert "sandbox" in str(exc.value)


def test_an_unknown_seat_is_refused():
    with pytest.raises(kill.KillTestRefused):
        kill.guard("some-seat-nobody-authored")


def test_the_sandbox_seat_is_allowed():
    """Law 12 control: a fence that refuses everything proves nothing."""
    assert kill.guard("smd-staging")


def test_the_fence_is_not_a_flag(monkeypatch):
    """--confirm gates the transmit; it does not widen WHERE it may transmit. A
    flag is a thing an operator in a hurry passes."""
    assert kill.main(["--seat", "ashton-price", "--confirm"]) == 2


def test_a_dry_run_transmits_nothing(monkeypatch, capsys):
    def explode(*_a, **_k):  # pragma: no cover - must never be reached
        raise AssertionError("a dry run reached the network")

    monkeypatch.setattr(kill, "mint_token", explode)
    monkeypatch.setattr(kill, "transmit", explode)
    assert kill.main(["--seat", "smd-staging"]) == 0
    assert "DRY RUN" in capsys.readouterr().out


def test_the_message_carries_no_audit_header():
    """The whole experiment. A stamped message would be matched by the header and
    the run would come back clean -- a kill test that always passes."""
    payload = kill.killtest_message(kill.killtest_subject())
    assert "internetMessageHeaders" not in payload["message"]
    # Every key the message carries, so a header cannot arrive under another
    # spelling. (The body PROSE names the header; that is explanation for a human
    # who finds this in a mailbox, and explanation is not a header.)
    assert set(payload["message"]) == {"subject", "body", "toRecipients"}


def test_the_subject_carries_the_marker_and_a_creation_stamp():
    """Same marker as the AgentMail kill test of 2026-08-13, so the two read as
    one control. The stamp is the probe-artifact contract: whoever finds this in
    a mailbox must be able to tell it is a probe and when it was made."""
    subject = kill.killtest_subject(datetime(2026, 8, 21, 14, 30, tzinfo=timezone.utc))
    assert subject.startswith("[UNAUDITED-KILLTEST-2258] 2026-08-21T14:30Z")


def test_the_message_is_addressed_to_smd_and_never_a_client():
    """A kill test that reaches a client is not a test."""
    payload = kill.killtest_message("s")
    recipients = [
        r["emailAddress"]["address"] for r in payload["message"]["toRecipients"]
    ]
    assert recipients == ["team@smd.services"]
