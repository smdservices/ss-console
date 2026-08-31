"""Tests for the AgentMail lists check (check-agentmail-lists.py).

The failure class it exists for: a rostered recipient on a send-block list (or
excluded by a non-empty send-allow) is SILENTLY unreachable -- the Operator
"sends", the vendor drops it, nothing records a failure. Both of the control's
own failure modes are pinned: reading a block list as empty (an undocumented
entry shape guessed at), and paging on an empty vendor state.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_BIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BIN / "lib"))

_spec = importlib.util.spec_from_file_location(
    "check_agentmail_lists", _BIN / "check-agentmail-lists.py"
)
lists = importlib.util.module_from_spec(_spec)
sys.modules["check_agentmail_lists"] = lists
_spec.loader.exec_module(lists)


# ---------------------------------------------------------------------------
# roster extraction
# ---------------------------------------------------------------------------


def test_rostered_recipients_covers_all_four_authored_sources():
    config = {
        "users": [{"email": "scott@smd.services", "role": "principal"}],
        "escalation": {
            "red_flag_recipients": ["scott@smd.services"],
            "failure_recipients": ["team@smd.services"],
        },
        "scope": {
            "outbound_roster": [
                {"address": "ap-client-standin@agentmail.to", "class": "client"}
            ],
            "inbound_allow_from": ["smdurgan@smdurgan.com", "not-an-address"],
        },
    }
    rostered = lists.rostered_recipients(config)
    assert rostered == [
        "scott@smd.services",
        "team@smd.services",
        "ap-client-standin@agentmail.to",
        "smdurgan@smdurgan.com",
    ]


def test_rostered_recipients_dedupes_case_insensitively():
    config = {"users": [{"email": "Scott@SMD.services"}, {"email": "scott@smd.services"}]}
    assert lists.rostered_recipients(config) == ["scott@smd.services"]


# ---------------------------------------------------------------------------
# entry-shape parsing (vendor shapes are probed, never assumed)
# ---------------------------------------------------------------------------


def test_entries_parse_from_strings_and_entry_mappings():
    assert lists._entries_of({"entries": ["a@b.c", {"entry": "d.e"}]}, "/x") == ["a@b.c", "d.e"]
    assert lists._entries_of({}, "/x") == []


def test_an_unrecognized_entry_shape_holds_rather_than_reading_empty():
    with pytest.raises(lists.ListsError):
        lists._entries_of({"entries": [{"address": "a@b.c"}]}, "/x")
    with pytest.raises(lists.ListsError):
        lists._entries_of({"something_else": True}, "/x")


# ---------------------------------------------------------------------------
# grading
# ---------------------------------------------------------------------------


def test_a_send_block_match_on_the_address_is_the_finding():
    report = lists.grade_seat(
        "pilot", "pilot@agentmail.to", ["scott@smd.services"],
        org_block=["scott@smd.services"], org_allow=[], inbox_block=[], inbox_allow=[],
    )
    assert [f.kind for f in report.findings] == ["send_block_match"]
    assert report.findings[0].scope == "org"


def test_a_domain_block_entry_matches_every_rostered_address_on_it():
    report = lists.grade_seat(
        "pilot", "pilot@agentmail.to", ["scott@smd.services", "team@smd.services"],
        org_block=[], org_allow=[], inbox_block=["smd.services"], inbox_allow=[],
    )
    assert len(report.findings) == 2
    assert all(f.kind == "send_block_match" for f in report.findings)


def test_a_nonempty_send_allow_that_omits_a_rostered_address_is_the_finding():
    report = lists.grade_seat(
        "pilot", "pilot@agentmail.to", ["scott@smd.services", "vendor@records.invalid"],
        org_block=[], org_allow=[],
        inbox_block=[], inbox_allow=["scott@smd.services"],
    )
    assert [(f.kind, f.recipient) for f in report.findings] == [
        ("send_allow_omission", "vendor@records.invalid")
    ]


def test_an_empty_allow_list_constrains_nothing():
    report = lists.grade_seat(
        "pilot", "pilot@agentmail.to", ["scott@smd.services"],
        org_block=[], org_allow=[], inbox_block=[], inbox_allow=[],
    )
    assert report.findings == [] and not report.is_finding


def test_matching_is_case_insensitive_and_ignores_blank_entries():
    assert lists._matches("SCOTT@SMD.SERVICES", "scott@smd.services")
    assert lists._matches("@smd.services", "scott@smd.services")
    assert not lists._matches("", "scott@smd.services")
    assert not lists._matches("other.invalid", "scott@smd.services")


# ---------------------------------------------------------------------------
# report + exit shape
# ---------------------------------------------------------------------------


def test_findings_render_with_a_fingerprint_and_holds_without_one():
    finding = lists.SeatListsReport(
        slug="pilot", inbox="pilot@agentmail.to", rostered=1,
        findings=[lists.ListsFinding(scope="org", kind="send_block_match",
                                     entry="x@y.z", recipient="x@y.z")],
    )
    rendered = lists.render([finding])
    assert "lists-fingerprint:" in rendered
    assert "silently dropped" in rendered
    held = lists.SeatListsReport(slug="pilot", inbox="pilot@agentmail.to")
    held.held = "agentmail GET /lists/send/block failed: HTTP 500"
    rendered_hold = lists.render([held])
    assert rendered_hold.startswith("HOLD")
    assert "lists-fingerprint:" not in rendered_hold


def test_fingerprint_is_stable_and_moves_with_the_set():
    def _report(entries):
        return lists.SeatListsReport(
            slug="pilot", inbox="pilot@agentmail.to",
            findings=[
                lists.ListsFinding(scope="org", kind="send_block_match", entry=e, recipient=e)
                for e in entries
            ],
        )

    assert lists.finding_fingerprint([_report(["a@b.c"])]) == lists.finding_fingerprint(
        [_report(["a@b.c"])]
    )
    assert lists.finding_fingerprint([_report(["a@b.c"])]) != lists.finding_fingerprint(
        [_report(["a@b.c", "d@e.f"])]
    )
    assert lists.finding_fingerprint([_report([])]) == ""


def test_missing_key_holds(monkeypatch, capsys):
    monkeypatch.delenv("AGENTMAIL_API_KEY", raising=False)
    assert lists.main([]) == lists.EXIT_HOLD
    assert "AGENTMAIL_API_KEY unset" in capsys.readouterr().out


def test_the_documented_rest_paths_are_the_ones_called():
    """Pins the probed vendor paths (docs.agentmail.to, probe date 2026-08-31)
    so a refactor cannot silently drift onto a guessed endpoint."""
    calls: list[str] = []

    def _fake_get(path, api_key, *, opener=None):
        calls.append(path)
        return {"entries": []}

    original = lists._get
    lists._get = _fake_get
    try:
        lists.fetch_list("key", "send", "block")
        lists.fetch_list("key", "send", "allow", inbox="pilot@agentmail.to")
    finally:
        lists._get = original
    assert calls[0].startswith("/lists/send/block?")
    assert calls[1].startswith("/inboxes/pilot%40agentmail.to/lists/send/allow?")
