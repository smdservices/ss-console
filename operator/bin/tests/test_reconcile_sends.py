"""Tests for the unaudited-send reconciler (ss#2258).

The control exists because 9 of 117 real sends from the pilot inbox had no audit
record, four of them to a real client. Its two failure modes are equally fatal:
cry wolf on every legitimate send and it gets muted within a week; absorb
everything and it measures nothing. Both are pinned here.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
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
# the baseline (ss#2386): a watchdog that remembers what it already reported
#
# Every fixture below is CAPTURED, not authored: fixtures/unaudited-sends-
# 2026-08-17.json is the verbatim --json output of this reconciler against the
# live pilot inbox, and its 11 finds are the ones re-reported by #2344, #2373,
# #2380, #2381 and #2382.
# ---------------------------------------------------------------------------

_CAPTURE = json.loads(
    (Path(__file__).resolve().parent / "fixtures" / "unaudited-sends-2026-08-17.json").read_text()
)
_CAPTURED_INBOX = _CAPTURE["reports"][0]["inbox"]
_CAPTURED_FINDS = _CAPTURE["reports"][0]["unaccounted"]


def _captured_sends():
    """The 11 real finds, shaped as AgentMail sent-message records."""
    return [dict(m, labels=["sent"]) for m in _CAPTURED_FINDS]


def _shipped_baseline():
    return rec.load_baseline(rec.DEFAULT_BASELINE_PATH)


def test_the_shipped_baseline_covers_every_historical_find():
    """The 11 sends re-reported five times over are in the file, so the next
    scheduled run has nothing to say about them."""
    baseline = _shipped_baseline()
    assert len(_CAPTURED_FINDS) == 11
    missing = [
        m["message_id"]
        for m in _captured_sends()
        if rec.fingerprint(_CAPTURED_INBOX, m) not in baseline
    ]
    assert missing == []


def test_a_run_with_only_historical_finds_is_silent():
    """The whole point: yesterday's report is not today's alert."""
    fresh, already = rec.split_baselined(_CAPTURED_INBOX, _captured_sends(), _shipped_baseline())
    assert (fresh, already) == ([], 11)


def test_a_planted_send_absent_from_the_baseline_still_raises():
    """THE FALSIFIER (Law 12). Quieting a watchdog is only safe if you have first
    proven it can still fire. A new unaudited send, among 11 baselined ones, is
    the entire report."""
    planted = _msg(
        "<planted-0100019fffffffff@email.amazonses.com>",
        "2026-08-17T09:00:00.000Z",
        to="client-principal@firm.example",
        subject="[Deadlines] planted, absent from the baseline",
    )
    report = rec.reconcile_inbox(
        _CAPTURED_INBOX,
        ["pilot-smokeball"],
        "key",
        None,
        opener=_fake_opener({"messages": _captured_sends() + [planted]}),
        client_factory=lambda slug: _Rows([_reply_row("2026-01-01T00:00:00.000Z", "<unrelated>")]),
        baseline=_shipped_baseline(),
    )
    assert report.is_finding is True
    assert [m["message_id"] for m in report.unaccounted] == [planted["message_id"]]
    assert report.baselined == 11


def test_the_baseline_quiets_only_the_message_id_it_names():
    """A baselined send does not silence its own routine. Same inbox, same
    recipient, same subject, same second of the day -- a DIFFERENT message id is
    a different send, and stays a finding."""
    twin = dict(_captured_sends()[-1], message_id="<a-different-id@email.amazonses.com>")
    fresh, already = rec.split_baselined(_CAPTURED_INBOX, [twin], _shipped_baseline())
    assert already == 0
    assert [m["message_id"] for m in fresh] == ["<a-different-id@email.amazonses.com>"]


def test_the_baseline_cannot_reach_across_inboxes():
    """An entry naming the pilot inbox says nothing about anyone else's mail."""
    fresh, already = rec.split_baselined(
        "ashton-price@agentmail.to", _captured_sends(), _shipped_baseline()
    )
    assert already == 0 and len(fresh) == 11


def test_a_missing_or_corrupt_baseline_reports_everything():
    """Fail LOUD. A deleted or malformed baseline must not read as 'all clear' --
    that would make deleting a file the way to silence the control."""
    assert rec.load_baseline("/nonexistent/reconcile-sends-baseline.json") == set()
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        handle.write("{ this is not json")
    assert rec.load_baseline(handle.name) == set()
    fresh, already = rec.split_baselined(_CAPTURED_INBOX, _captured_sends(), set())
    assert already == 0 and len(fresh) == 11


def test_a_hold_is_never_quieted_by_the_baseline():
    """HOLD is not a finding, so 'already reported' can never apply to it. A seam
    failure stays loud on every run, forever, which is the ss#2258 contract."""
    report = rec.reconcile_inbox(
        _CAPTURED_INBOX,
        ["pilot-smokeball"],
        "key",
        None,
        opener=_fake_opener({"messages": _captured_sends()}),
        client_factory=lambda slug: _Boom(),
        baseline=_shipped_baseline(),
    )
    assert report.held is not None
    assert report.baselined == 0
    assert report.is_finding is False
    assert rec.render([report]).startswith("HOLD  ")


def test_an_unowned_inbox_is_baselined_like_any_other():
    """The unowned-mailbox path builds its finding separately, so it needs its
    own proof that the memory applies there too."""
    sends = _captured_sends()
    report = rec.reconcile_inbox(
        "mystery-inbox@agentmail.to",
        ["pilot-smokeball"],
        "key",
        None,
        opener=_fake_opener({"messages": sends}),
        client_factory=lambda slug: _Empty(),
        baseline={rec.fingerprint("mystery-inbox@agentmail.to", m) for m in sends[:-1]},
    )
    assert report.baselined == 10
    assert report.is_finding is True
    assert len(report.unaccounted) == 1


# ---------------------------------------------------------------------------
# the fingerprint the workflow dedupes on
# ---------------------------------------------------------------------------


def _finding_report(messages):
    return rec.InboxReport(
        inbox=_CAPTURED_INBOX, slug="pilot-smokeball", sent_total=len(messages),
        unaccounted=list(messages),
    )


def test_the_same_find_set_yields_the_same_fingerprint():
    """This is what lets a run recognise its own already-open issue and decline
    to file the second, third and fifth copy."""
    first = rec.finding_digest([_finding_report(_captured_sends())])
    second = rec.finding_digest([_finding_report(list(reversed(_captured_sends())))])
    assert first and first == second


def test_one_new_send_changes_the_fingerprint():
    """The dedupe must not become the silence. A find set that grew is a
    different find set, and files a new issue even while the old one is open."""
    before = rec.finding_digest([_finding_report(_captured_sends())])
    after = rec.finding_digest(
        [_finding_report(_captured_sends() + [_msg("<new>", "2026-08-18T09:00:00.000Z")])]
    )
    assert after != before


def test_a_clean_run_has_no_fingerprint_and_prints_none():
    """No finding, nothing to dedupe -- and no fingerprint line in the report,
    which is what the workflow treats as 'nothing to file'."""
    clean = rec.InboxReport(inbox=_CAPTURED_INBOX, slug="pilot-smokeball", sent_total=3)
    assert rec.finding_digest([clean]) == ""
    assert "reconcile-fingerprint" not in rec.render([clean])


def test_the_report_carries_the_fingerprint_and_paste_ready_baseline_rows():
    """The workflow reads the fingerprint back out of this text, and a human
    reads the rows: disposition is one copy-paste and a PR."""
    rendered = rec.render([_finding_report(_captured_sends()[:1])])
    digest = rec.finding_digest([_finding_report(_captured_sends()[:1])])
    assert f"reconcile-fingerprint: {digest}" in rendered
    assert "operator/bin/reconcile-sends-baseline.json" in rendered
    assert _CAPTURED_FINDS[0]["message_id"] in rendered


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


class _Boom:
    def read_all(self, _kind):
        raise RuntimeError("seam unreachable")


class _Empty:
    def read_all(self, _kind):
        return []


class _Rows:
    """A seam that reads fine and returns rows accounting for none of the sends
    under test -- the shape of the real pilot ledger against these 11."""

    def __init__(self, rows):
        self._rows = rows

    def read_all(self, _kind):
        return self._rows


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
