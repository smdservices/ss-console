"""Tests for deadline-miss-escalator/pre_run.py (ADR 0021 Stream B).

Exercises the wake / suppress decision, the rung mapping, the SUPPRESSED_WAKE
heartbeat emission, and the mirror-don't-gate fallback (audit failure → wake —
the dead-man's-switch the plan critique flagged). Fake source + fake executor;
no network, no OAuth, no D1.

Mirrors `retainer-hours-reconciler/test_retainer_pre_run.py` — same harness,
adapted for authored-deadline proximity instead of utilization buckets.

Run from repo root:

    cd operator && python -m pytest \\
        skills/deadline-miss-escalator/test_escalator_pre_run.py -v
"""

from __future__ import annotations

import asyncio
import importlib.util
import io
import json
import sys
from contextlib import redirect_stdout
from datetime import date, datetime, timezone
from pathlib import Path

# operator/ on sys.path (for adapter.*). Load this skill's pre_run.py under a
# unique module name — every Stream B skill names the file pre_run.py, so a bare
# import would collide across skills.
_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))

from adapter.audit_log import AuditLogWriter, SuppressedWakeWriter  # noqa: E402

_PRE_RUN_PATH = _HERE.parent / "pre_run.py"
_spec = importlib.util.spec_from_file_location("deadline_escalator_pre_run", _PRE_RUN_PATH)
assert _spec is not None and _spec.loader is not None
_pre_run = importlib.util.module_from_spec(_spec)
sys.modules["deadline_escalator_pre_run"] = _pre_run
_spec.loader.exec_module(_pre_run)

EscalationWindows = _pre_run.EscalationWindows
MatterDeadline = _pre_run.MatterDeadline
decide = _pre_run.decide
run_once = _pre_run.run_once
_rung_for = _pre_run._rung_for


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeSource:
    def __init__(self, deadlines):
        self._deadlines = deadlines

    def pull_deadlines(self):
        return self._deadlines


class FakeExecutor:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple[str, list]] = []

    async def execute(self, sql: str, params: list) -> None:
        self.calls.append((sql, params))
        if self.fail:
            raise RuntimeError("D1 unreachable")


TODAY = date(2026, 6, 8)
NOW = datetime(2026, 6, 8, 8, 0, tzinfo=timezone.utc)


def _dl(
    *,
    matter_id: str = "7001",
    days_out: int = 30,
    label: str = "filing-deadline",
    matter_open: bool = True,
    conflict_hold: bool = False,
    acknowledged: bool = False,
) -> MatterDeadline:
    from datetime import timedelta

    return MatterDeadline(
        matter_id=matter_id,
        authored_date=TODAY + timedelta(days=days_out),
        label=label,
        matter_open=matter_open,
        conflict_hold=conflict_hold,
        acknowledged=acknowledged,
    )


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _capture_stdout(coro) -> tuple[int, str]:
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = _run(coro)
    return code, buf.getvalue().strip()


# ---------------------------------------------------------------------------
# decide() — pure
# ---------------------------------------------------------------------------


def test_decide_suppresses_when_all_far_off():
    # 30 days out, window 14 → not in range.
    decision = decide([_dl(days_out=30)], EscalationWindows(), raw_inputs_for_digest=b"x", today=TODAY)
    assert decision.wake is False
    assert decision.decision_basis == "no_deadline_in_escalation_range"


def test_decide_wakes_when_within_window():
    decision = decide([_dl(days_out=10)], EscalationWindows(), raw_inputs_for_digest=b"x", today=TODAY)
    assert decision.wake is True
    assert decision.decision_basis == "deadline_in_escalation_range"
    assert decision.extra_metadata["matters"][0]["matter_id"] == "7001"


def test_decide_wakes_on_overdue():
    decision = decide([_dl(days_out=-3)], EscalationWindows(), raw_inputs_for_digest=b"x", today=TODAY)
    assert decision.wake is True
    assert decision.extra_metadata["matters"][0]["days_out"] == -3


def test_decide_suppresses_when_acknowledged():
    # In-range but already acknowledged → stop re-firing.
    decision = decide(
        [_dl(days_out=5, acknowledged=True)], EscalationWindows(), raw_inputs_for_digest=b"x", today=TODAY
    )
    assert decision.wake is False


def test_decide_suppresses_when_matter_closed():
    decision = decide(
        [_dl(days_out=2, matter_open=False)], EscalationWindows(), raw_inputs_for_digest=b"x", today=TODAY
    )
    assert decision.wake is False


def test_decide_wakes_on_held_matter_in_range():
    decision = decide(
        [_dl(days_out=5, conflict_hold=True)], EscalationWindows(), raw_inputs_for_digest=b"x", today=TODAY
    )
    assert decision.wake is True
    assert decision.extra_metadata["matters"][0]["rung"] == "clearance"


def test_decide_aggregates_multiple_in_range():
    decision = decide(
        [_dl(matter_id="a", days_out=2), _dl(matter_id="b", days_out=40), _dl(matter_id="c", days_out=12)],
        EscalationWindows(),
        raw_inputs_for_digest=b"x",
        today=TODAY,
    )
    assert decision.wake is True
    ids = {m["matter_id"] for m in decision.extra_metadata["matters"]}
    assert ids == {"a", "c"}  # b is 40 days out, outside the 14-day window


# ---------------------------------------------------------------------------
# rung mapping
# ---------------------------------------------------------------------------


def test_rung_notify_within_3_days_or_overdue():
    assert _rung_for(_dl(days_out=2), TODAY, EscalationWindows()) == "notify"
    assert _rung_for(_dl(days_out=-1), TODAY, EscalationWindows()) == "notify"


def test_rung_re_route_within_near_window():
    assert _rung_for(_dl(days_out=6), TODAY, EscalationWindows()) == "re-route"


def test_rung_re_surface_in_outer_window():
    assert _rung_for(_dl(days_out=12), TODAY, EscalationWindows()) == "re-surface"


def test_rung_clearance_for_held_regardless_of_proximity():
    assert _rung_for(_dl(days_out=1, conflict_hold=True), TODAY, EscalationWindows()) == "clearance"


# ---------------------------------------------------------------------------
# run_once() — integration
# ---------------------------------------------------------------------------


def test_run_once_wakes_on_in_range_no_audit_written():
    sources = [FakeSource([_dl(days_out=5)])]
    executor = FakeExecutor()

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(run_once(sources, EscalationWindows(), factory, today=TODAY, now=NOW))
    assert code == 0
    assert json.loads(out) == {"wakeAgent": True}
    assert executor.calls == []  # audit only on suppress path


def test_run_once_writes_heartbeat_then_suppresses_when_quiet():
    sources = [FakeSource([_dl(days_out=40)])]
    executor = FakeExecutor()

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(run_once(sources, EscalationWindows(), factory, today=TODAY, now=NOW))
    assert code == 0
    assert json.loads(out) == {"wakeAgent": False}
    assert len(executor.calls) == 1  # the SUPPRESSED_WAKE heartbeat row
    sql, params = executor.calls[0]
    assert sql.startswith("INSERT INTO audit_log")
    assert params[2] == "SUPPRESSED_WAKE"
    assert params[5] == "deadline-miss-escalator"
    metadata = json.loads(params[11])
    assert metadata["decision_basis"] == "no_deadline_in_escalation_range"


def test_run_once_falls_back_to_wake_on_audit_failure():
    """The dead-man's-switch: audit-write failure forces wake, so a silently
    broken heartbeat surfaces as the agent waking rather than going dark."""
    sources = [FakeSource([_dl(days_out=40)])]
    executor = FakeExecutor(fail=True)

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(run_once(sources, EscalationWindows(), factory, today=TODAY, now=NOW))
    assert code == 0
    assert json.loads(out) == {"wakeAgent": True}
    assert len(executor.calls) == 1  # attempt made before fallback


def test_run_once_falls_back_to_wake_when_no_writer():
    sources = [FakeSource([_dl(days_out=40)])]
    code, out = _capture_stdout(run_once(sources, EscalationWindows(), lambda: None, today=TODAY, now=NOW))
    assert code == 0
    assert json.loads(out) == {"wakeAgent": True}


# ---------------------------------------------------------------------------
# parse_pull — the production Smokeball pull parser (#1748 wiring)
# ---------------------------------------------------------------------------

parse_pull = _pre_run.parse_pull


def test_parse_pull_clean_tasks_and_events() -> None:
    raw = {
        "tasks": {"items": [{"matterId": "m-1", "dueDate": "2026-07-20T00:00:00Z"}]},
        "events": {"items": [{"matterId": "m-2", "startTime": "2026-07-09T09:00:00"}]},
    }
    deadlines, problem = parse_pull(raw)
    assert problem is None
    assert {(d.matter_id, d.label, d.authored_date.isoformat()) for d in deadlines} == {
        ("m-1", "task-deadline", "2026-07-20"),
        ("m-2", "court-date", "2026-07-09"),
    }


def test_parse_pull_reads_nested_matter_link_object() -> None:
    # The live Smokeball /tasks payload nests the matter as a link object —
    # the flat-key miss put "unknown-matter" (or worse, the task's own id via
    # the bare-"id" fallback) into item identity (WP-D probe find, ss #1915).
    raw = {
        "tasks": {
            "items": [
                {
                    "id": "t-1",
                    "matter": {"id": "m-real", "href": "https://api/matters/m-real"},
                    "dueDate": "2026-07-20T00:00:00Z",
                }
            ]
        },
        "events": [],
    }
    deadlines, problem = parse_pull(raw)
    assert problem is None
    assert deadlines[0].matter_id == "m-real"


def test_parse_pull_bare_list_envelope() -> None:
    raw = {"tasks": [{"matterId": "m-1", "dueDate": "2026-07-20"}], "events": []}
    deadlines, problem = parse_pull(raw)
    assert problem is None
    assert len(deadlines) == 1


def test_parse_pull_error_key_is_a_problem() -> None:
    raw = {"tasks": {"items": []}, "events": {"items": []}, "eventsError": "boom"}
    deadlines, problem = parse_pull(raw)
    assert deadlines == [] and problem is not None


def test_parse_pull_unrecognized_envelope_is_a_problem() -> None:
    deadlines, problem = parse_pull({"tasks": {"weird": 1}, "events": {"items": []}})
    assert deadlines == [] and problem is not None


def test_parse_pull_nonempty_pull_with_zero_dates_is_a_problem() -> None:
    """A wire shape whose date keys we don't recognize must WAKE, not read as
    an empty deadline book."""
    raw = {
        "tasks": {"items": [{"matterId": "m-1", "deadline_when": "2026-07-20"}]},
        "events": {"items": []},
    }
    deadlines, problem = parse_pull(raw)
    assert deadlines == [] and problem is not None


def test_parse_pull_dateless_items_skipped_when_others_parse() -> None:
    raw = {
        "tasks": {
            "items": [
                {"matterId": "m-1", "dueDate": "2026-07-20"},
                {"matterId": "m-2"},  # dateless task: not an authored deadline
            ]
        },
        "events": {"items": []},
    }
    deadlines, problem = parse_pull(raw)
    assert problem is None
    assert [d.matter_id for d in deadlines] == ["m-1"]


def test_parse_pull_empty_pull_is_a_clean_empty_book() -> None:
    deadlines, problem = parse_pull({"tasks": {"items": []}, "events": {"items": []}})
    assert deadlines == [] and problem is None


def test_parse_pull_carries_stable_task_id() -> None:
    raw = {
        "tasks": {"items": [{"matterId": "m-1", "id": "task-77", "dueDate": "2026-07-20"}]},
        "events": {"items": []},
    }
    deadlines, problem = parse_pull(raw)
    assert problem is None
    assert deadlines[0].task_id == "task-77"


def test_parse_pull_idless_item_has_no_task_id() -> None:
    # An event with a date but no id key: still a deadline, but blanket-ack only.
    raw = {
        "tasks": {"items": []},
        "events": {"items": [{"matterId": "m-2", "startTime": "2026-07-09T09:00:00"}]},
    }
    deadlines, problem = parse_pull(raw)
    assert problem is None
    assert deadlines[0].task_id is None


# ---------------------------------------------------------------------------
# Ledger-aware re-fire policy (the daily-re-fire fix) — run_once + enrich
# ---------------------------------------------------------------------------

FirePolicy = _pre_run.FirePolicy
enrich_with_ledger = _pre_run.enrich_with_ledger
load_escalation_config = _pre_run.load_escalation_config

# The vendored ledger module the skill loads at runtime — used here to mint
# real events so the tests exercise the true item_key/state join.
import importlib.util as _il  # noqa: E402

_LEDGER_PATH = _HERE.parent / "escalation_ledger.py"
_lspec = _il.spec_from_file_location("escalation_ledger_test", _LEDGER_PATH)
_ledger = _il.module_from_spec(_lspec)
sys.modules["escalation_ledger_test"] = _ledger
_lspec.loader.exec_module(_ledger)


def _fired_event(dl, *, ts, attempt=1):
    key = _ledger.item_key(dl.matter_id, dl.task_id, dl.label, dl.authored_date)
    return _ledger.make_event(
        skill="deadline-miss-escalator",
        matter_id=dl.matter_id,
        item_key=key,
        event="fired",
        attempt=attempt,
        token=_ledger.token_for(key),
        ts=ts,
    )


def _acked_event(dl, *, ts):
    key = _ledger.item_key(dl.matter_id, dl.task_id, dl.label, dl.authored_date)
    return _ledger.make_event(
        skill="deadline-miss-escalator",
        matter_id=dl.matter_id,
        item_key=key,
        event="acked",
        attempt=1,
        token=_ledger.token_for(key),
        ts=ts,
    )


_POLICY = FirePolicy(refire_days=3, ack_snooze_days=7)


def test_enrich_suppresses_item_fired_within_refire_window() -> None:
    dl = _dl(days_out=2, matter_id="m-1")  # overdue-ish, in range
    fired = _fired_event(dl, ts="2026-06-07T07:00:00.000Z")  # yesterday
    enriched = enrich_with_ledger([dl], today=TODAY, policy=_POLICY, ledger_events=[fired])
    assert enriched[0].acknowledged is True  # inside the 3-day window → suppressed


def test_enrich_refires_after_window() -> None:
    dl = _dl(days_out=2, matter_id="m-1")
    fired = _fired_event(dl, ts="2026-06-04T07:00:00.000Z")  # 4 days ago
    enriched = enrich_with_ledger([dl], today=TODAY, policy=_POLICY, ledger_events=[fired])
    assert enriched[0].acknowledged is False  # window elapsed → fires again


def test_enrich_acked_is_snoozed_then_resurfaces() -> None:
    dl = _dl(days_out=2, matter_id="m-1")
    events = [
        _fired_event(dl, ts="2026-06-05T07:00:00.000Z"),
        _acked_event(dl, ts="2026-06-05T09:00:00.000Z"),  # acked 3 days ago
    ]
    snoozed = enrich_with_ledger([dl], today=TODAY, policy=_POLICY, ledger_events=events)
    assert snoozed[0].acknowledged is True  # within 7-day snooze
    later = date(2026, 6, 13)  # 8 days after the ack
    resurfaced = enrich_with_ledger([dl], today=later, policy=_POLICY, ledger_events=events)
    assert resurfaced[0].acknowledged is False  # ack is a snooze, not a tombstone


def test_enrich_new_item_fires() -> None:
    dl = _dl(days_out=2, matter_id="m-1")
    enriched = enrich_with_ledger([dl], today=TODAY, policy=_POLICY, ledger_events=[])
    assert enriched[0].acknowledged is False


def test_run_once_suppresses_recently_fired_in_range_item() -> None:
    """End-to-end: an in-range item that fired yesterday does NOT re-wake."""
    dl = _dl(days_out=2, matter_id="m-1")
    fired = _fired_event(dl, ts="2026-06-07T07:00:00.000Z")
    executor = FakeExecutor()

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(
        run_once(
            [FakeSource([dl])],
            EscalationWindows(),
            factory,
            today=TODAY,
            now=NOW,
            fire_policy=_POLICY,
            ledger_events=[fired],
        )
    )
    assert code == 0
    assert json.loads(out) == {"wakeAgent": False}  # suppressed via ledger
    assert len(executor.calls) == 1  # heartbeat row written


def test_run_once_still_wakes_when_refire_window_elapsed() -> None:
    dl = _dl(days_out=2, matter_id="m-1")
    fired = _fired_event(dl, ts="2026-06-01T07:00:00.000Z")  # a week ago
    code, out = _capture_stdout(
        run_once(
            [FakeSource([dl])],
            EscalationWindows(),
            lambda: None,
            today=TODAY,
            now=NOW,
            fire_policy=_POLICY,
            ledger_events=[fired],
        )
    )
    assert json.loads(out) == {"wakeAgent": True}


def test_no_stable_id_item_always_fires_until_blanket_acked() -> None:
    """An idless item can be acked only en bloc; with no ack event it keeps
    firing (its item_key state is absent so should_fire stays True)."""
    idless = _dl(days_out=2, matter_id="m-2")  # _dl leaves task_id=None
    assert idless.task_id is None
    enriched = enrich_with_ledger([idless], today=TODAY, policy=_POLICY, ledger_events=[])
    assert enriched[0].acknowledged is False


def test_load_escalation_config_reads_overrides(tmp_path, monkeypatch) -> None:
    cfg = tmp_path / "customer.yaml"
    cfg.write_text(
        "escalation:\n"
        "  red_flag_recipients: [scott@smd.services]\n"
        "  refire_days: 5\n"
        "  ack_snooze_days: 10\n"
        "  near_days: 9\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("SMD_CUSTOMER_YAML_PATH", str(cfg))
    windows, policy = load_escalation_config()
    assert policy.refire_days == 5
    assert policy.ack_snooze_days == 10
    assert windows.near_days == 9
    assert windows.escalation_window_days == 14  # unset → pack default


def test_load_escalation_config_defaults_when_missing(monkeypatch) -> None:
    monkeypatch.delenv("SMD_CUSTOMER_YAML_PATH", raising=False)
    windows, policy = load_escalation_config()
    assert policy == FirePolicy()  # pack defaults
    assert windows == EscalationWindows()


def test_load_escalation_config_defaults_on_unparseable(tmp_path, monkeypatch) -> None:
    bad = tmp_path / "customer.yaml"
    bad.write_text("escalation: [this is: not valid: yaml", encoding="utf-8")
    monkeypatch.setenv("SMD_CUSTOMER_YAML_PATH", str(bad))
    _windows, policy = load_escalation_config()
    assert policy == FirePolicy()  # never crash, never silent-suppress
