"""Tests for the verification tracker's renderer + envelope (WS-RENDER)."""

from __future__ import annotations

import importlib.util
import json
import re
import sys
from datetime import date
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent
OPERATOR_DIR = SKILL_DIR.parents[1]


def _load(filename: str, name: str):
    spec = importlib.util.spec_from_file_location(name, SKILL_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


render = _load("render.py", "cvt_render_under_test")
envelope = _load("dispatch_envelope.py", "cvt_envelope_under_test")
ledger = _load("escalation_ledger.py", "cvt_ledger_under_test")
pre_run = _load("pre_run.py", "cvt_pre_run_under_test")


def test_canonical_hash_matches_arbiter_vectors():
    vectors = json.loads(
        (OPERATOR_DIR / "contracts" / "fixtures" / "body-canon-vectors.json").read_text()
    )["vectors"]
    for vector in vectors:
        assert render.canonical_body_sha256(vector["input"]) == vector["sha256"], vector["name"]


def test_situation_map_is_closed():
    assert render.situation_line({"action": "surface_hold"})
    assert "have changed" in render.situation_line(
        {"action": "surface_hold", "reason": "determination_stale"}
    )
    assert "ceiling" in render.situation_line({"action": "handoff"})
    assert "not authored" in render.situation_line({"action": "surface_config_missing"})
    assert "return destination" in render.situation_line({"action": "chase"})
    # Unknown signal renders nothing.
    assert render.situation_line({"action": "resolved"}) is None
    assert render.situation_line({}) is None


def test_render_alert_names_matters_and_counts_by_construction():
    entries = [
        {
            "matter_id": "m-1",
            "matter_number": "2026-PI-104",
            "matter_number_absent": None,
            "action": "surface_hold",
            "attempt": 2,
            "ceiling": 3,
        },
        {
            "matter_id": "m-2",
            "matter_number": None,
            "matter_number_absent": "no_number_on_record",
            "action": "handoff",
            "attempt": 3,
            "ceiling": 3,
        },
    ]
    subject, body = render.render_alert(entries, today_iso="2026-08-31")
    assert subject == "[Verifications] 2 need attention, 2026-08-31"
    assert "## Needs a person (2)" in body
    assert "1. matter 2026-PI-104, verification: held for a person" in body
    assert "2. no number on record, verification:" in body
    assert "(nudge 3 of 3)" in body
    assert "no client message has been sent" in body
    assert "—" not in body
    assert "m-1" not in body  # never a GUID


def test_skeleton_is_identifier_free():
    body = render.render_skeleton(3)
    assert "3 items need a person" in body
    assert not re.search(r"\d{4}-\d{2}-\d{2}", body)
    assert "2026-PI" not in body


def test_render_chase_is_fail_closed_on_missing_slots():
    assert render.render_chase(signer_first_name="", return_link="https://x.example/y") is None
    assert render.render_chase(signer_first_name="Ana", return_link=" ") is None
    body = render.render_chase(signer_first_name="Ana", return_link="https://x.example/y")
    # Draft 2 verbatim, floor-clean: no "sign"/"deadline"/"attorney".
    assert body.startswith("Hi Ana, following up on the verification")
    assert "https://x.example/y" in body
    for banned in ("sign", "deadline", "attorney"):
        assert banned not in body.lower().replace("signer", "")


def test_authored_return_link_reads_skill_settings_only():
    data = {
        "personas": [
            {
                "skills": [
                    {
                        "name": "client-verification-tracker",
                        "settings": {"return_link": "https://portal.example/verify"},
                    }
                ]
            }
        ]
    }
    assert render.authored_return_link(data) == "https://portal.example/verify"
    assert render.authored_return_link({}) is None
    assert (
        render.authored_return_link(
            {"personas": [{"skills": [{"name": "client-verification-tracker"}]}]}
        )
        is None
    )


def _plan(**overrides):
    defaults = dict(
        matter_id="m-1",
        task_id="t-1",
        item_key="k-1",
        action="surface_hold",
        attempt=1,
        matter_number="2026-PI-104",
        matter_number_absent=None,
        next_chase_due="2026-08-29",
    )
    defaults.update(overrides)
    return pre_run.ItemPlan(**defaults)


def _yaml(tmp_path):
    path = tmp_path / "customer.yaml"
    path.write_text(
        "escalation:\n  red_flag_recipients:\n    - ops@firm.example\n"
        "scope:\n  inbound_allow_from:\n    - '@firm.example'\n"
    )
    return str(path)


def test_envelope_hold_surface_dispatch(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    meta = envelope.build_and_write(
        plans=[_plan()],
        items=[],
        ledger=ledger,
        ledger_events=[],
        today=date(2026, 8, 31),
        refire_days=3,
        ceiling=3,
        customer_yaml_path=_yaml(tmp_path),
    )
    assert meta["dispatch_expected"] is True
    assert meta["render_mode"] == "slot-templated"
    written = json.loads(
        (tmp_path / ".smd" / "pre_run" / "client-verification-tracker.dispatch.json").read_text()
    )
    [dispatch] = written["dispatches"]
    assert dispatch["recipients"] == ["ops@firm.example"]
    assert "matter 2026-PI-104" in dispatch["full_body"]
    [append] = dispatch["appends"]
    assert append == {
        "item_key": "k-1",
        "matter_id": "m-1",
        "event": "fired",
        "attempt": 1,
        "token": None,
    }
    assert dispatch["body_sha256_full"] == render.canonical_body_sha256(dispatch["full_body"])
    # The CVT in-turn check ships dark (Shape A is a legitimate free send).
    assert written["in_turn_enforce"] is False


def test_envelope_degraded_chase_collapses_to_one_throttled_line(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    plans = [
        _plan(action="chase", matter_id="m-1", item_key="c-1"),
        _plan(action="chase", matter_id="m-2", item_key="c-2"),
    ]
    meta = envelope.build_and_write(
        plans=plans,
        items=[],
        ledger=ledger,
        ledger_events=[],
        today=date(2026, 8, 31),
        refire_days=3,
        ceiling=3,
        customer_yaml_path=_yaml(tmp_path),
    )
    assert meta["chase_degraded_return_link_unauthored"] == 2
    written = json.loads(
        (tmp_path / ".smd" / "pre_run" / "client-verification-tracker.dispatch.json").read_text()
    )
    [dispatch] = written["dispatches"]
    # ONE seat-level line, not one per chase; keyed on the sentinel.
    assert dispatch["full_body"].count("return destination") == 1
    [append] = dispatch["appends"]
    sentinel_key = ledger.item_key("", envelope.RETURN_LINK_SOURCE_ID, "chase-return-link-missing", "")
    assert append["item_key"] == sentinel_key
    assert append["event"] == "fired"
    # No chased rows: no client was nudged; the ledger stays honest.
    assert all(a["event"] != "chased" for a in dispatch["appends"])


def test_envelope_degraded_chase_respects_refire_window(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    sentinel_key = ledger.item_key("", envelope.RETURN_LINK_SOURCE_ID, "chase-return-link-missing", "")
    events = [
        {
            "v": 2,
            "ts": "2026-08-30T14:00:00Z",
            "skill": "client-verification-tracker",
            "item_key": sentinel_key,
            "event": "fired",
            "attempt": 1,
        }
    ]
    meta = envelope.build_and_write(
        plans=[_plan(action="chase")],
        items=[],
        ledger=ledger,
        ledger_events=events,
        today=date(2026, 8, 31),
        refire_days=3,
        ceiling=3,
        customer_yaml_path=_yaml(tmp_path),
    )
    # Fired yesterday, refire window 3 days: nothing to dispatch, no envelope.
    assert meta == {}
