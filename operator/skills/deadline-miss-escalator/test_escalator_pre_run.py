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
