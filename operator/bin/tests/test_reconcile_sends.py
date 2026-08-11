"""Tests for the unaudited-send reconciler (ss#2258).

The control exists because 9 of 117 real sends from the pilot inbox had no audit
record, four of them to a real client. Its two failure modes are equally fatal:
cry wolf on every legitimate send and it gets muted within a week; absorb
everything and it measures nothing. Both are pinned here.
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

_BIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BIN / "lib"))
_spec = importlib.util.spec_from_file_location("reconcile_sends", _BIN / "reconcile-sends.py")
rec = importlib.util.module_from_spec(_spec)
# Register BEFORE exec: @dataclass resolves its own module out of sys.modules,
# and a spec-loaded module that is not there fails at class-creation time.
sys.modules["reconcile_sends"] = rec
_spec.loader.exec_module(rec)


def _msg(mid, ts, to="scott@smd.services", subject="s"):
    return {"message_id": mid, "timestamp": ts, "to": [to], "subject": subject, "labels": ["sent"]}


def _reply_row(ts, mid):
    return {"ts": ts, "action_type": "REPLY_SENT", "metadata": {"sent_message_id": mid}}


def _tool_row(ts, outcome="ok", action_class="external_send"):
    return {
        "ts": ts,
        "action_type": "TOOL_CALL_COMPLETED",
        "metadata": {
            "action_class": action_class,
            "outcome": outcome,
            "tool": "mcp_agentmail_send_message",
        },
    }


# ---------------------------------------------------------------------------
# pass 1 — exact message-id join
# ---------------------------------------------------------------------------


def test_exact_match_on_recorded_message_id():
    sent = [_msg("<a>", "2026-08-01T10:00:00.000Z")]
    rows = [_reply_row("2026-08-01T10:00:00.100Z", "<a>")]
    exact, tool, unaccounted = rec.reconcile(sent, rows)
    assert (exact, tool, unaccounted) == (1, 0, [])


def test_exact_match_ignores_clock_skew_entirely():
    """The id join has no time component, so an audit row written minutes later
    still matches. This is why pass 1 is preferred over pass 2."""
    sent = [_msg("<a>", "2026-08-01T10:00:00.000Z")]
    rows = [_reply_row("2026-08-01T10:47:00.000Z", "<a>")]
    exact, _, unaccounted = rec.reconcile(sent, rows)
    assert exact == 1 and unaccounted == []


# ---------------------------------------------------------------------------
# pass 2 — tool path, tight window, one-to-one
# ---------------------------------------------------------------------------


def test_tool_path_matches_within_the_window():
    """Real observed skew was 341ms (2026-08-01)."""
    sent = [_msg("<a>", "2026-08-01T10:00:00.285Z")]
    rows = [_tool_row("2026-08-01T10:00:00.626Z")]
    exact, tool, unaccounted = rec.reconcile(sent, rows)
    assert (exact, tool, unaccounted) == (0, 1, [])


def test_tool_path_does_not_match_outside_the_window():
    sent = [_msg("<a>", "2026-08-01T10:00:00.000Z")]
    rows = [_tool_row("2026-08-01T10:00:30.000Z")]  # 30s -> way outside
    _, tool, unaccounted = rec.reconcile(sent, rows)
    assert tool == 0 and len(unaccounted) == 1


def test_one_audit_row_cannot_cover_two_messages():
    """The absorption failure. Two sends a second apart with only ONE audit row
    must leave exactly one unaccounted -- otherwise a single legitimate row
    launders every neighbouring unaudited send."""
    sent = [_msg("<a>", "2026-08-01T10:00:00.000Z"), _msg("<b>", "2026-08-01T10:00:01.000Z")]
    rows = [_tool_row("2026-08-01T10:00:00.500Z")]
    _, tool, unaccounted = rec.reconcile(sent, rows)
    assert tool == 1
    assert len(unaccounted) == 1


def test_errored_tool_call_does_not_cover_a_send():
    """A send tool that ERRORED did not deliver, so it cannot account for a
    message that demonstrably left the mailbox."""
    sent = [_msg("<a>", "2026-08-01T10:00:00.000Z")]
    rows = [_tool_row("2026-08-01T10:00:00.100Z", outcome="error")]
    _, tool, unaccounted = rec.reconcile(sent, rows)
    assert tool == 0 and len(unaccounted) == 1


def test_non_send_tool_call_does_not_cover_a_send():
    sent = [_msg("<a>", "2026-08-01T10:00:00.000Z")]
    rows = [_tool_row("2026-08-01T10:00:00.100Z", action_class="read")]
    _, tool, unaccounted = rec.reconcile(sent, rows)
    assert tool == 0 and len(unaccounted) == 1


# ---------------------------------------------------------------------------
# the incident, and the no-false-positive property
# ---------------------------------------------------------------------------


def test_the_2026_08_11_incident_is_reported():
    """A message that left the mailbox with no id in the ledger and no send row
    near it is exactly the case this control was built for."""
    sent = [
        _msg("<legit>", "2026-08-11T14:00:00.000Z"),
        _msg("<incident>", "2026-08-11T14:03:14.543Z", subject="Escalator woke but..."),
    ]
    rows = [_reply_row("2026-08-11T14:00:00.100Z", "<legit>")]
    exact, tool, unaccounted = rec.reconcile(sent, rows)
    assert exact == 1 and tool == 0
    assert [m["message_id"] for m in unaccounted] == ["<incident>"]


def test_a_busy_legitimate_mailbox_produces_no_finding():
    """The mute-it-within-a-week failure. Mixed transports, all accounted."""
    sent = [_msg(f"<r{i}>", f"2026-08-01T10:0{i}:00.000Z") for i in range(5)]
    sent += [_msg(f"<t{i}>", f"2026-08-01T11:0{i}:00.000Z") for i in range(4)]
    rows = [_reply_row(f"2026-08-01T10:0{i}:00.200Z", f"<r{i}>") for i in range(5)]
    rows += [_tool_row(f"2026-08-01T11:0{i}:00.300Z") for i in range(4)]
    exact, tool, unaccounted = rec.reconcile(sent, rows)
    assert (exact, tool, unaccounted) == (5, 4, [])


# ---------------------------------------------------------------------------
# fail-closed the OTHER way: a broken instrument holds, it does not accuse
# ---------------------------------------------------------------------------


def test_seam_failure_holds_and_is_not_a_finding():
    def _boom(_slug):
        raise RuntimeError("seam unreachable")

    report = rec.reconcile_inbox(
        "pilot-smokeball@agentmail.to",
        ["pilot-smokeball"],
        "key",
        None,
        opener=_fake_opener({"messages": [_msg("<a>", "2026-08-01T10:00:00.000Z")]}),
        client_factory=lambda slug: (_ for _ in ()).throw(RuntimeError("x")) if False else _Boom(),
    )
    assert report.held is not None
    assert report.is_finding is False


def test_empty_audit_read_holds_rather_than_accusing():
    """A literally empty ledger on a seat that demonstrably sent mail is
    unmeasurable, not clean. Reading it as clean would be the connector-ledger
    'absent means healthy' bug all over again."""
    report = rec.reconcile_inbox(
        "pilot-smokeball@agentmail.to",
        ["pilot-smokeball"],
        "key",
        None,
        opener=_fake_opener({"messages": [_msg("<a>", "2026-08-01T10:00:00.000Z")]}),
        client_factory=lambda slug: _Empty(),
    )
    assert report.held is not None and report.is_finding is False


def test_unowned_unauthored_inbox_is_the_loudest_signal():
    """A mailbox nobody owns and nobody authored: the shape of a decommissioned
    seat still sending. The case a seat-side check could never represent."""
    report = rec.reconcile_inbox(
        "mystery-inbox@agentmail.to",
        ["pilot-smokeball", "ashton-price"],
        "key",
        None,
        opener=_fake_opener({"messages": [_msg("<a>", "2026-08-01T10:00:00.000Z")]}),
        client_factory=lambda slug: _Empty(),
    )
    assert report.slug is None
    assert report.is_finding is True
    assert len(report.unaccounted) == 1


def test_authored_non_seat_inbox_is_not_a_finding():
    """Our own rigs (probe harnesses, the opposing-counsel simulator) have no
    seat ledger to appear in. The first live run flagged 135 such sends across
    six inboxes -- a control that loud gets muted in a week."""
    inbox = next(iter(rec.KNOWN_NON_SEAT_INBOXES))
    report = rec.reconcile_inbox(
        inbox,
        ["pilot-smokeball"],
        "key",
        None,
        opener=_fake_opener({"messages": [_msg("<a>", "2026-08-01T10:00:00.000Z")]}),
        client_factory=lambda slug: _Empty(),
    )
    assert report.non_seat_reason
    assert report.is_finding is False


def test_allowlist_is_not_a_blanket_skip_of_seatless_inboxes():
    """The allowlist must stay an allowlist. If it ever becomes 'any inbox
    without a seat is fine', the loudest signal goes silent."""
    assert "mystery-inbox@agentmail.to" not in rec.KNOWN_NON_SEAT_INBOXES
    assert all("@" in k and v for k, v in rec.KNOWN_NON_SEAT_INBOXES.items())


def test_slug_for_inbox_matches_local_part():
    slugs = ["pilot-smokeball", "ashton-price"]
    assert rec.slug_for_inbox("ashton-price@agentmail.to", slugs) == "ashton-price"
    assert rec.slug_for_inbox("ss-probe-admin@agentmail.to", slugs) is None


def test_window_is_tight_enough_to_be_meaningful():
    """Pinned so nobody widens it into uselessness: past a few seconds one row
    starts absorbing neighbouring sends."""
    assert 0 < rec.TOOL_PATH_WINDOW_S <= 10


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


class _Boom:
    def read_all(self, _kind):
        raise RuntimeError("seam unreachable")


class _Empty:
    def read_all(self, _kind):
        return []


def _fake_opener(payload):
    import json as _json

    class _Resp:
        def read(self):
            return _json.dumps(payload).encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def _open(_req, timeout=None):
        return _Resp()

    return _open
