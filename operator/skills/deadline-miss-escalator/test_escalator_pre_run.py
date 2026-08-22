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
    acked: bool = False,
    task_id: str | None = None,
    last_raised: str | None = None,
) -> MatterDeadline:
    from datetime import timedelta

    return MatterDeadline(
        matter_id=matter_id,
        authored_date=TODAY + timedelta(days=days_out),
        label=label,
        matter_open=matter_open,
        conflict_hold=conflict_hold,
        acknowledged=acknowledged,
        acked=acked,
        task_id=task_id,
        last_raised=last_raised,
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
    sources = [FakeSource([_dl(days_out=5, task_id="task-9")])]
    executor = FakeExecutor()

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(run_once(sources, EscalationWindows(), factory, today=TODAY, now=NOW))
    assert code == 0
    # The wake line carries the facts the gate computed (#2253). A bare
    # wakeAgent flag left the woken turn to source per-item facts itself, and
    # with the connector down it sourced them from nowhere.
    payload = json.loads(out)
    digest = payload.pop("digest")  # ss #2405: asserted separately below
    assert payload == {
        "wakeAgent": True,
        "decision_basis": "deadline_in_escalation_range",
        "plans": [
            {
                "matter_id": "7001",
                "task_id": "task-9",
                "label": "filing-deadline",
                "authored_date": "2026-06-13",  # verbatim, not re-derived from days_out
                "days_out": 5,
                "rung": "re-route",
                "last_raised": None,  # never raised → no Operator raise on record
                "last_raised_source": "operator_ledger",
            }
        ],
        "plans_total": 1,
        "plans_emitted": 1,
        "plans_truncated": False,
    }
    assert digest["subject"].startswith("[Deadlines] 1 need you")
    # The wake leaves a row too (#2253). Before this, the gate logged why it did
    # NOT act and logged nothing when it did — which is why the 2026-08-10
    # fabricated escalation email was findable only by reading the mailbox.
    assert len(executor.calls) == 1
    _, params = executor.calls[0]
    assert params[2] == "EMITTED_WAKE"
    assert params[5] == "deadline-miss-escalator"
    metadata = json.loads(params[11])
    assert metadata["decision_basis"] == "deadline_in_escalation_range"
    # The row's plan accounting matches the wake line's, field for field.
    assert metadata["plans_total"] == 1
    assert metadata["plans_emitted"] == 1
    assert metadata["plans_truncated"] is False


def test_run_once_wake_is_unchanged_when_the_emitted_wake_write_fails():
    """The inverted contract: a failed audit write must not touch the wake.

    On the suppress path an audit failure escalates to a wake, because a silent
    suppress is indistinguishable from a broken gate. Here the wake is already
    the decision, so the row is observability and never a gate — the stdout must
    be byte-identical to the succeeding case above.
    """
    sources = [FakeSource([_dl(days_out=5, task_id="task-9")])]
    executor = FakeExecutor(fail=True)

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(
        run_once(sources, EscalationWindows(), factory, today=TODAY, now=NOW)
    )
    assert code == 0
    payload = json.loads(out)
    payload.pop("digest")  # ss #2405: same digest as the succeeding case
    assert payload == {
        "wakeAgent": True,
        "decision_basis": "deadline_in_escalation_range",
        "plans": [
            {
                "matter_id": "7001",
                "task_id": "task-9",
                "label": "filing-deadline",
                "authored_date": "2026-06-13",
                "days_out": 5,
                "rung": "re-route",
                "last_raised": None,
                "last_raised_source": "operator_ledger",
            }
        ],
        "plans_total": 1,
        "plans_emitted": 1,
        "plans_truncated": False,
    }
    assert len(executor.calls) == 1  # attempted, failed, swallowed


def test_run_once_wake_survives_a_writer_without_the_emitted_wake_method():
    """A writer object too old to have `write_emitted_wake` must not break a
    wake. The failure mode this closes is a half-deployed image, where the
    gate's own observability would otherwise take the tick down with it."""

    class _LegacyWriter:
        async def write_suppressed_wake(self, **_kwargs) -> str:
            return "x"

    sources = [FakeSource([_dl(days_out=5, task_id="task-9")])]
    code, out = _capture_stdout(
        run_once(
            sources, EscalationWindows(), lambda: _LegacyWriter(), today=TODAY, now=NOW
        )
    )
    assert code == 0
    parsed = json.loads(out)
    assert parsed["wakeAgent"] is True
    assert parsed["decision_basis"] == "deadline_in_escalation_range"
    assert len(parsed["plans"]) == 1


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
    broken heartbeat surfaces as the agent waking rather than going dark.

    Asserted by exact equality with NO ``plans`` key: pre-#2253 every wake path
    printed the same bare flag, so a blind fail-open and a fact-carrying wake
    were indistinguishable on the wire — which is precisely how a fact-free turn
    could read as a well-briefed one.
    """
    sources = [FakeSource([_dl(days_out=40)])]
    executor = FakeExecutor(fail=True)

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(run_once(sources, EscalationWindows(), factory, today=TODAY, now=NOW))
    assert code == 0
    parsed = json.loads(out)
    assert parsed == {
        "wakeAgent": True,
        "decision_basis": "suppress_heartbeat_failed_fail_open",
    }
    assert "plans" not in parsed  # woke blind: SKILL.md's enumeration fallback applies
    assert len(executor.calls) == 1  # attempt made before fallback


def test_run_once_falls_back_to_wake_when_no_writer():
    sources = [FakeSource([_dl(days_out=40)])]
    code, out = _capture_stdout(run_once(sources, EscalationWindows(), lambda: None, today=TODAY, now=NOW))
    assert code == 0
    parsed = json.loads(out)
    assert parsed == {
        "wakeAgent": True,
        "decision_basis": "no_audit_writer_fail_open",
    }
    assert "plans" not in parsed


# ---------------------------------------------------------------------------
# parse_pull — the production Smokeball pull parser (#1748 wiring)
# ---------------------------------------------------------------------------

parse_pull = _pre_run.parse_pull


def test_parse_pull_clean_tasks_and_events() -> None:
    raw = {
        "tasks": {"items": [{"matterId": "m-1", "dueDate": "2026-07-20T00:00:00Z"}]},
        "events": {"items": [{"matterId": "m-2", "startTime": "2026-07-09T09:00:00"}]},
    }
    deadlines, problem, _probe = parse_pull(raw)
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
    deadlines, problem, _probe = parse_pull(raw)
    assert problem is None
    assert deadlines[0].matter_id == "m-real"


def test_parse_pull_bare_list_envelope() -> None:
    raw = {"tasks": [{"matterId": "m-1", "dueDate": "2026-07-20"}], "events": []}
    deadlines, problem, _probe = parse_pull(raw)
    assert problem is None
    assert len(deadlines) == 1


def test_parse_pull_excludes_probe_artifacts() -> None:
    # ss #2403: a rehearsal probe task is never a deadline, [Operator]-stamped
    # or not. But a real task QUOTING the marker mid-subject is kept — the
    # match is position-anchored so subject text cannot silence a deadline.
    raw = {
        "tasks": [
            {
                "id": "t-p",
                "matterId": "m-1",
                "subject": "[Operator] [SMD-PROBE 2026-08-18T14:00Z] drafting prove-out",
                "dueDate": "2026-07-20",
            },
            {
                "id": "t-p2",
                "matterId": "m-1",
                "subject": "[SMD-PROBE 2026-08-18T14:00Z] unstamped probe",
                "dueDate": "2026-07-20",
            },
            {
                "id": "t-r",
                "matterId": "m-1",
                "subject": "Review the [SMD-PROBE] cleanup contract",
                "dueDate": "2026-07-21",
            },
        ],
        "events": [],
    }
    deadlines, problem, _probe = parse_pull(raw)
    assert problem is None
    assert [(d.task_id, d.authored_date.isoformat()) for d in deadlines] == [
        ("t-r", "2026-07-21")
    ]


def test_parse_pull_error_key_is_a_problem() -> None:
    raw = {"tasks": {"items": []}, "events": {"items": []}, "eventsError": "boom"}
    deadlines, problem, _probe = parse_pull(raw)
    assert deadlines == [] and problem is not None


def test_parse_pull_unrecognized_envelope_is_a_problem() -> None:
    deadlines, problem, _probe = parse_pull({"tasks": {"weird": 1}, "events": {"items": []}})
    assert deadlines == [] and problem is not None


def test_parse_pull_nonempty_pull_with_zero_dates_is_a_problem() -> None:
    """A wire shape whose date keys we don't recognize must WAKE, not read as
    an empty deadline book."""
    raw = {
        "tasks": {"items": [{"matterId": "m-1", "deadline_when": "2026-07-20"}]},
        "events": {"items": []},
    }
    deadlines, problem, _probe = parse_pull(raw)
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
    deadlines, problem, _probe = parse_pull(raw)
    assert problem is None
    assert [d.matter_id for d in deadlines] == ["m-1"]


def test_parse_pull_empty_pull_is_a_clean_empty_book() -> None:
    deadlines, problem, _probe = parse_pull({"tasks": {"items": []}, "events": {"items": []}})
    assert deadlines == [] and problem is None


def test_parse_pull_carries_stable_task_id() -> None:
    raw = {
        "tasks": {"items": [{"matterId": "m-1", "id": "task-77", "dueDate": "2026-07-20"}]},
        "events": {"items": []},
    }
    deadlines, problem, _probe = parse_pull(raw)
    assert problem is None
    assert deadlines[0].task_id == "task-77"


def test_parse_pull_idless_item_has_no_task_id() -> None:
    # An event with a date but no id key: still a deadline, but blanket-ack only.
    raw = {
        "tasks": {"items": []},
        "events": {"items": [{"matterId": "m-2", "startTime": "2026-07-09T09:00:00"}]},
    }
    deadlines, problem, _probe = parse_pull(raw)
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
    parsed = json.loads(out)
    assert parsed["wakeAgent"] is True
    assert parsed["decision_basis"] == "deadline_in_escalation_range"
    # The re-fire carries the prior raise it read, with its provenance — the
    # turn states "last raised" only from this, never from recall (#2253).
    assert parsed["plans"][0]["last_raised"] == "2026-06-01T07:00:00.000Z"
    assert parsed["plans"][0]["last_raised_source"] == "operator_ledger"


# ---------------------------------------------------------------------------
# The wake payload (#2253) — the handoff Hermes injects verbatim into the
# woken turn's prompt. What is absent here is what the turn has to invent.
# ---------------------------------------------------------------------------


def test_wake_payload_carries_last_raised_only_when_the_ledger_has_one() -> None:
    """A never-raised item carries None. Rendered downstream as "no Operator
    raise on record" — the ledger records Operator raises after a successful
    send, so absent is never evidence that nobody raised it."""
    raised = _dl(days_out=2, matter_id="m-1", task_id="t-1")
    fresh = _dl(days_out=4, matter_id="m-2", task_id="t-2")
    fired = _fired_event(raised, ts="2026-06-01T07:00:00.000Z")
    code, out = _capture_stdout(
        run_once(
            [FakeSource([raised, fresh])],
            EscalationWindows(),
            lambda: None,
            today=TODAY,
            now=NOW,
            fire_policy=_POLICY,
            ledger_events=[fired],
        )
    )
    assert code == 0
    by_matter = {p["matter_id"]: p for p in json.loads(out)["plans"]}
    assert by_matter["m-1"]["last_raised"] == "2026-06-01T07:00:00.000Z"
    assert by_matter["m-2"]["last_raised"] is None
    assert {p["last_raised_source"] for p in by_matter.values()} == {"operator_ledger"}


def test_wake_payload_truncation_announces_itself() -> None:
    """Over the cap the list is partial, and the payload says so. A truncated
    list that reads as complete is a check that cannot fail (Law 12)."""
    deadlines = [
        _dl(days_out=(i % 14), matter_id=f"m-{i}", task_id=f"t-{i}") for i in range(58)
    ]
    code, out = _capture_stdout(
        run_once(
            [FakeSource(deadlines)],
            EscalationWindows(),
            lambda: None,
            today=TODAY,
            now=NOW,
            fire_policy=_POLICY,
            ledger_events=[],
        )
    )
    assert code == 0
    parsed = json.loads(out)
    assert parsed["plans_total"] == 58
    assert parsed["plans_emitted"] == 50
    assert parsed["plans_truncated"] is True
    assert len(parsed["plans"]) == 50


def test_wake_payload_untruncated_says_so_explicitly() -> None:
    """The flag is present on the complete case too, so its absence never has
    to be read as "complete"."""
    deadlines = [_dl(days_out=3, matter_id=f"m-{i}", task_id=f"t-{i}") for i in range(4)]
    code, out = _capture_stdout(
        run_once(
            [FakeSource(deadlines)],
            EscalationWindows(),
            lambda: None,
            today=TODAY,
            now=NOW,
            fire_policy=_POLICY,
            ledger_events=[],
        )
    )
    assert code == 0
    parsed = json.loads(out)
    assert parsed["plans_total"] == parsed["plans_emitted"] == 4
    assert parsed["plans_truncated"] is False


def test_wake_payload_carries_the_rung_and_authored_date_per_item() -> None:
    """Each rung serializes, and the authored date rides verbatim alongside the
    derived days_out — an integer alone invites re-deriving a date, which is the
    one arithmetic this skill may never do."""
    deadlines = [
        _dl(days_out=1, matter_id="near", task_id="t-a"),
        _dl(days_out=6, matter_id="mid", task_id="t-b"),
        _dl(days_out=12, matter_id="far", task_id="t-c"),
        _dl(days_out=2, matter_id="held", task_id="t-d", conflict_hold=True),
    ]
    code, out = _capture_stdout(
        run_once(
            [FakeSource(deadlines)],
            EscalationWindows(),
            lambda: None,
            today=TODAY,
            now=NOW,
            fire_policy=_POLICY,
            ledger_events=[],
        )
    )
    assert code == 0
    plans = {p["matter_id"]: p for p in json.loads(out)["plans"]}
    assert plans["near"]["rung"] == "notify"
    assert plans["mid"]["rung"] == "re-route"
    assert plans["far"]["rung"] == "re-surface"
    assert plans["held"]["rung"] == "clearance"
    assert plans["far"]["authored_date"] == "2026-06-20"
    assert plans["far"]["days_out"] == 12


def test_decide_plans_mirror_the_in_range_set() -> None:
    decision = decide(
        [_dl(matter_id="a", days_out=2), _dl(matter_id="b", days_out=40), _dl(matter_id="c", days_out=12)],
        EscalationWindows(),
        raw_inputs_for_digest=b"x",
        today=TODAY,
    )
    assert {p.matter_id for p in decision.plans} == {"a", "c"}
    assert len(decision.plans) == len(decision.extra_metadata["matters"])


def test_decide_suppressed_decision_carries_no_plans() -> None:
    decision = decide([_dl(days_out=40)], EscalationWindows(), raw_inputs_for_digest=b"x", today=TODAY)
    assert decision.wake is False
    assert decision.plans == ()


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


# ---------------------------------------------------------------------------
# Digest projection (ss #2405) — counts are list lengths by construction; the
# 2026-08-14 defect ("1 routine confirmation(s)" above two ack codes, subject
# counting 32 routine confirms as "need you") is structurally impossible here.
# ---------------------------------------------------------------------------

project_digest = _pre_run.project_digest
parse_pull = _pre_run.parse_pull


def _project(deadlines, *, windows=None):
    return project_digest(deadlines, windows or EscalationWindows(), _ledger, today=TODAY)


def test_digest_counts_equal_list_lengths_per_matter():
    # 7 firing stable items: 5 most-overdue go to needs_you, 2 to admin —
    # and each admin matter's count equals its code-list length (the PI-106
    # falsifier: two items on one matter can never render as "1").
    items = [
        _dl(matter_id="m-a", days_out=-40 + i, task_id=f"t-{i}") for i in range(5)
    ] + [
        _dl(matter_id="m-b", days_out=-2, task_id="t-b1"),
        _dl(matter_id="m-b", days_out=-1, task_id="t-b2"),
    ]
    d = _project(items)
    assert len(d["needs_you"]) == 5
    assert d["subject"] == "[Deadlines] 5 need you, 2026-06-08"
    admin = d["admin_confirms"]
    assert admin["total"] == 2
    assert admin["matter_count"] == 1
    (matter,) = admin["matters"]
    assert matter["matter_id"] == "m-b"
    assert matter["count"] == 2
    assert matter["count"] == len(matter["ack_codes"]) == len(matter["items"])
    assert all(code and code.startswith("ACK-") for code in matter["ack_codes"])


def test_digest_needs_you_is_most_overdue_first_and_subject_counts_only_it():
    items = [
        _dl(matter_id="m-1", days_out=5, task_id="t-near"),
        _dl(matter_id="m-2", days_out=-30, task_id="t-overdue"),
    ]
    d = _project(items)
    assert [i["task_id"] for i in d["needs_you"]] == ["t-overdue", "t-near"]
    assert d["subject"].startswith("[Deadlines] 2 need you")
    assert "admin_confirms" not in d  # empty sections omitted whole (rule 9)


def test_digest_recently_raised_items_band_as_elsewhere_not_admin():
    quiet = _dl(
        matter_id="m-1",
        days_out=2,
        task_id="t-raised",
        acknowledged=True,
        last_raised="2026-06-07T09:00:00.000Z",
    )
    d = _project([quiet, _dl(matter_id="m-2", days_out=1, task_id="t-live")])
    assert [i["task_id"] for i in d["under_active_escalation_elsewhere"]] == ["t-raised"]
    assert [i["task_id"] for i in d["needs_you"]] == ["t-live"]


def test_digest_acked_items_are_omitted_entirely():
    acked = _dl(
        matter_id="m-1",
        days_out=2,
        task_id="t-acked",
        acknowledged=True,
        acked=True,
        last_raised="2026-06-01T09:00:00.000Z",
    )
    d = _project([acked, _dl(matter_id="m-2", days_out=1, task_id="t-live")])
    assert "under_active_escalation_elsewhere" not in d
    assert [i["task_id"] for i in d["needs_you"]] == ["t-live"]


def test_digest_clearance_and_blanket_bands():
    held = _dl(matter_id="m-h", days_out=2, task_id="t-h", conflict_hold=True)
    idless = _dl(matter_id="m-b", days_out=-3, task_id=None)
    d = _project([held, idless])
    assert [i["task_id"] for i in d["awaiting_clearance"]] == ["t-h"]
    assert [i["matter_id"] for i in d["blanket_ack_only"]] == ["m-b"]
    assert d["blanket_ack_only"][0]["ack_code"] is None
    assert d["needs_you"] == []


def test_digest_is_computed_over_the_full_universe_not_the_plan_cap():
    # 60 firing items — beyond _MAX_SERIALIZED_PLANS. The projection's totals
    # must cover all of them (the /critique finding: a projection built from a
    # truncated plan list reproduces confident-wrong counts).
    items = [_dl(matter_id=f"m-{i}", days_out=-i, task_id=f"t-{i}") for i in range(1, 61)]
    d = _project(items)
    assert len(d["needs_you"]) == 5
    assert d["admin_confirms"]["total"] == 55


def test_digest_out_of_range_and_closed_matters_are_excluded():
    d = _project(
        [
            _dl(matter_id="m-far", days_out=40, task_id="t-far"),
            _dl(matter_id="m-closed", days_out=1, task_id="t-c", matter_open=False),
            _dl(matter_id="m-live", days_out=1, task_id="t-live"),
        ]
    )
    assert [i["task_id"] for i in d["needs_you"]] == ["t-live"]
    assert "admin_confirms" not in d


def test_digest_probe_stats_render_only_when_present():
    live = [_dl(matter_id="m-1", days_out=1, task_id="t-1")]
    d = project_digest(
        live, EscalationWindows(), _ledger, today=TODAY, probe_stats={"excluded": 0, "stale": 0}
    )
    assert "probe_artifacts" not in d
    d2 = project_digest(
        live,
        EscalationWindows(),
        _ledger,
        today=TODAY,
        probe_stats={"excluded": 2, "stale": 1, "stale_task_ids": ["t-p"]},
    )
    assert d2["probe_artifacts"]["stale"] == 1


def test_parse_pull_probe_census_counts_and_ages():
    from datetime import datetime as _dt, timezone as _tz

    now = _dt(2026, 6, 8, 12, 0, tzinfo=_tz.utc)
    raw = {
        "tasks": [
            {  # fresh probe: excluded, not stale
                "id": "t-fresh",
                "matterId": "m-1",
                "subject": "[SMD-PROBE 2026-06-08T10:00Z] fresh rehearsal",
                "dueDate": "2026-06-20",
            },
            {  # stale probe: stamp older than 24h
                "id": "t-stale",
                "matterId": "m-1",
                "subject": "[Operator] [SMD-PROBE 2026-06-01T10:00Z] old rehearsal",
                "dueDate": "2026-06-20",
            },
            {  # malformed stamp: stale immediately
                "id": "t-bad",
                "matterId": "m-1",
                "subject": "[SMD-PROBE someday] malformed",
                "dueDate": "2026-06-20",
            },
            {"id": "t-real", "matterId": "m-1", "subject": "Real", "dueDate": "2026-06-20"},
        ],
        "events": [],
    }
    deadlines, problem, probe = parse_pull(raw, now=now)
    assert problem is None
    assert [d.task_id for d in deadlines] == ["t-real"]
    assert probe["excluded"] == 3
    assert probe["stale"] == 2
    assert set(probe["stale_task_ids"]) == {"t-stale", "t-bad"}


def test_run_once_wake_line_carries_the_digest():
    sources = [FakeSource([_dl(days_out=-2, task_id="task-9")])]

    def factory():
        return None  # fail-open writer path still emits the decision's digest

    code, out = _capture_stdout(
        run_once(sources, EscalationWindows(), factory, today=TODAY, now=NOW)
    )
    assert code == 0
    payload = json.loads(out)
    assert payload["wakeAgent"] is True
    digest = payload["digest"]
    assert digest["subject"].startswith("[Deadlines] 1 need you")
    (item,) = digest["needs_you"]
    assert item["task_id"] == "task-9"
    assert item["ack_code"].startswith("ACK-")


# ---------------------------------------------------------------------------
# Pre-run handoff (ss#2547)
# ---------------------------------------------------------------------------
# The gate reads authored dates from the firm's record and hands them to the
# turn as prompt text. Prompt text is not a source, so on 2026-08-19 the
# identifier gate refused this skill's digest four times over those very dates.
# The handoff file is what lets the overlay seed them as read, and these tests
# guard the three properties that make it safe to seed from: it lands, it
# carries exactly what the wake line already said, and it carries nothing else.

_HANDOFF_KEYS = {"skill", "started_at", "dates", "matter_ids"}


def _authored_dates_in(node, found=None) -> list:
    """Every authored_date in the wake payload, first-seen order.

    Written out again here rather than calling the module's own walker: a test
    that reuses the projection it is checking agrees with that projection's bugs.
    """
    if found is None:
        found = []
    if isinstance(node, dict):
        value = node.get("authored_date")
        if isinstance(value, str) and value and value not in found:
            found.append(value)
        for child in node.values():
            _authored_dates_in(child, found)
    elif isinstance(node, list):
        for child in node:
            _authored_dates_in(child, found)
    return found


def _wake_stdout() -> str:
    code, out = _capture_stdout(
        run_once(
            [FakeSource([_dl(days_out=3, matter_id="7001", task_id="t-1")])],
            EscalationWindows(),
            lambda: None,
            today=TODAY,
            now=NOW,
            fire_policy=_POLICY,
            ledger_events=[],
        )
    )
    assert code == 0
    return out


def _handoff_path(home) -> Path:
    return Path(home) / ".smd" / "pre_run" / "deadline-miss-escalator.json"


def test_the_wake_writes_a_handoff_whose_dates_are_the_dates_it_emitted(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    payload = json.loads(_wake_stdout())
    record = json.loads(_handoff_path(tmp_path).read_text(encoding="utf-8"))
    emitted = _authored_dates_in(payload)
    assert emitted, "this fixture must emit an authored date or the test proves nothing"
    assert record["dates"] == emitted
    assert record["skill"] == "deadline-miss-escalator"
    assert "7001" in record["matter_ids"]


def test_the_handoff_carries_nothing_but_the_projection(tmp_path, monkeypatch) -> None:
    """Labels, ack codes, subjects and prose never reach the register."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    _wake_stdout()
    record = json.loads(_handoff_path(tmp_path).read_text(encoding="utf-8"))
    assert set(record) == _HANDOFF_KEYS
    assert record["started_at"].endswith("Z")
    datetime.fromisoformat(record["started_at"].replace("Z", "+00:00"))


def test_a_handoff_write_failure_leaves_stdout_byte_identical(tmp_path, monkeypatch) -> None:
    """HERMES_HOME is a FILE, so the write fails for any uid. A read-only
    directory would still be writable by root, and CI containers run as root."""
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    good = _wake_stdout()
    assert _handoff_path(tmp_path).exists()
    blocked = tmp_path / "not-a-directory"
    blocked.write_text("x", encoding="utf-8")
    monkeypatch.setenv("HERMES_HOME", str(blocked))
    assert _wake_stdout() == good
