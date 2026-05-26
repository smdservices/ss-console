"""Tests for retainer-hours-reconciler/pre_run.py (ADR 0021 Stream B.2).

Exercises the wake / suppress decision logic, the audit emission, and the
mirror-don't-gate fallback (audit failure → wake). Uses a fake
RetainerHoursConnector + a fake AuditLogWriter pair so the tests run with
no network, no real OAuth, and no D1.

Mirrors `paid-media-anomaly-watcher/test_pre_run.py` (B.1, PR #1062) —
same harness shape, adapted for the retainer-hours utilization buckets +
weekly mandatory boundary + previously-critical-ack policy.

Run from repo root:

    cd ai-employee && python -m pytest \\
        skills/retainer-hours-reconciler/test_retainer_pre_run.py -v
"""

from __future__ import annotations

import asyncio
import importlib.util
import io
import json
import sys
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

import pytest

# Allow running from repo root or from ai-employee/. Every Stream B skill
# has a `pre_run.py` named identically per Hermes convention, so we can't
# add the skill dir to sys.path and `from pre_run import ...` — the first
# skill's pre_run wins the bare module name and subsequent tests collide.
# Load this skill's pre_run.py via importlib under a unique module name.
_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # ai-employee/ on sys.path (for adapter.*)

from adapter.audit_log import (  # noqa: E402
    AuditLogWriter,
    AuditWriteError,
    SuppressedWakeWriter,
)

_PRE_RUN_PATH = _HERE.parent / "pre_run.py"
_spec = importlib.util.spec_from_file_location(
    "retainer_hours_pre_run", _PRE_RUN_PATH
)
assert _spec is not None and _spec.loader is not None
_pre_run = importlib.util.module_from_spec(_spec)
sys.modules["retainer_hours_pre_run"] = _pre_run
_spec.loader.exec_module(_pre_run)

BucketThresholds = _pre_run.BucketThresholds
ClientUtilization = _pre_run.ClientUtilization
_assign_bucket = _pre_run._assign_bucket
_project_eom_pct = _pre_run._project_eom_pct
decide = _pre_run.decide
run_once = _pre_run.run_once


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeConnector:
    """Stand-in for a time-tracking adapter. Returns whatever
    utilizations the test injected."""

    def __init__(self, utilizations: Sequence[ClientUtilization]) -> None:
        self._utilizations = utilizations

    def pull_utilizations(self) -> Sequence[ClientUtilization]:
        return self._utilizations


class FakeExecutor:
    """Audit executor that records SQL calls or raises on demand."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple[str, list]] = []

    async def execute(self, sql: str, params: list) -> None:
        self.calls.append((sql, params))
        if self.fail:
            raise RuntimeError("D1 unreachable")


def _make_util(
    *,
    client_slug: str = "client_a",
    actual_mtd_hours: float = 50.0,
    contracted_monthly_hours: float = 80.0,
    mtd_days_elapsed: int = 15,
    calendar_days_in_month: int = 30,
    previously_critical_pending_ack: bool = False,
) -> ClientUtilization:
    return ClientUtilization(
        client_slug=client_slug,
        actual_mtd_hours=actual_mtd_hours,
        contracted_monthly_hours=contracted_monthly_hours,
        mtd_days_elapsed=mtd_days_elapsed,
        calendar_days_in_month=calendar_days_in_month,
        previously_critical_pending_ack=previously_critical_pending_ack,
    )


# Tuesday at 09:00 UTC — NOT the weekly mandatory boundary.
TUESDAY = datetime(2026, 5, 26, 9, 0, tzinfo=timezone.utc)
# Monday at 14:00 UTC — IS the weekly mandatory boundary.
MONDAY = datetime(2026, 5, 25, 14, 0, tzinfo=timezone.utc)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# _project_eom_pct() and _assign_bucket() — math sanity
# ---------------------------------------------------------------------------


def test_project_eom_pct_linear_extrapolation():
    """50 hours over 15 of 30 days = 100 projected EOM = 125% of 80h cap."""
    util = _make_util(
        actual_mtd_hours=50.0,
        contracted_monthly_hours=80.0,
        mtd_days_elapsed=15,
        calendar_days_in_month=30,
    )
    assert abs(_project_eom_pct(util) - 1.25) < 0.001


def test_project_eom_pct_handles_zero_days_elapsed():
    util = _make_util(actual_mtd_hours=0.0, mtd_days_elapsed=0)
    assert _project_eom_pct(util) == 0.0


def test_project_eom_pct_handles_zero_contracted_hours():
    util = _make_util(contracted_monthly_hours=0.0)
    assert _project_eom_pct(util) == 0.0


def test_assign_bucket_over_critical():
    util = _make_util(actual_mtd_hours=50.0, contracted_monthly_hours=80.0)
    # 100h projected / 80h cap = 125% → OVER_CRITICAL
    assert _assign_bucket(util, BucketThresholds()).bucket == "OVER_CRITICAL"


def test_assign_bucket_over_warning():
    util = _make_util(actual_mtd_hours=40.0, contracted_monthly_hours=80.0)
    # 80h projected / 80h cap = 100% → OVER_WARNING (95-110%)
    assert _assign_bucket(util, BucketThresholds()).bucket == "OVER_WARNING"


def test_assign_bucket_balanced():
    util = _make_util(actual_mtd_hours=30.0, contracted_monthly_hours=80.0)
    # 60h projected / 80h cap = 75% → BALANCED (65-95%)
    assert _assign_bucket(util, BucketThresholds()).bucket == "BALANCED"


def test_assign_bucket_under_warning():
    util = _make_util(actual_mtd_hours=20.0, contracted_monthly_hours=80.0)
    # 40h projected / 80h cap = 50% → UNDER_WARNING (40-65%)
    assert _assign_bucket(util, BucketThresholds()).bucket == "UNDER_WARNING"


def test_assign_bucket_under_critical():
    util = _make_util(actual_mtd_hours=10.0, contracted_monthly_hours=80.0)
    # 20h projected / 80h cap = 25% → UNDER_CRITICAL (<40%)
    assert _assign_bucket(util, BucketThresholds()).bucket == "UNDER_CRITICAL"


def test_assign_bucket_low_confidence_under_min_days():
    util = _make_util(mtd_days_elapsed=3)  # < default low_confidence_min_days=5
    assignment = _assign_bucket(util, BucketThresholds())
    assert assignment.low_confidence is True


def test_assign_bucket_high_confidence_at_or_above_min_days():
    util = _make_util(mtd_days_elapsed=15)
    assert _assign_bucket(util, BucketThresholds()).low_confidence is False


# ---------------------------------------------------------------------------
# decide() — pure function tests
# ---------------------------------------------------------------------------


def test_decide_suppresses_when_balanced_midweek():
    utils = [_make_util(actual_mtd_hours=30.0)]  # BALANCED at 75%
    decision = decide(
        utils, BucketThresholds(), raw_inputs_for_digest=b"x", now=TUESDAY
    )
    assert decision.wake is False
    assert decision.decision_basis == "all_clients_in_balanced_or_under_warning"


def test_decide_suppresses_when_under_warning_midweek():
    utils = [_make_util(actual_mtd_hours=20.0)]  # UNDER_WARNING at 50%
    decision = decide(
        utils, BucketThresholds(), raw_inputs_for_digest=b"x", now=TUESDAY
    )
    assert decision.wake is False
    assert decision.decision_basis == "all_clients_in_balanced_or_under_warning"


def test_decide_wakes_on_monday_even_with_all_balanced():
    """The weekly mandatory boundary fires even when nothing is wrong.
    Owner relies on the absence-of-noise as a signal."""
    utils = [_make_util(actual_mtd_hours=30.0)]  # BALANCED
    decision = decide(
        utils, BucketThresholds(), raw_inputs_for_digest=b"x", now=MONDAY
    )
    assert decision.wake is True
    assert decision.decision_basis == "weekly_mandatory_boundary"


def test_decide_wakes_on_over_critical_client():
    utils = [_make_util(actual_mtd_hours=50.0)]  # OVER_CRITICAL at 125%
    decision = decide(
        utils, BucketThresholds(), raw_inputs_for_digest=b"x", now=TUESDAY
    )
    assert decision.wake is True
    assert decision.decision_basis == "client_in_critical_band"
    assert decision.extra_metadata["critical_clients"][0]["bucket"] == "OVER_CRITICAL"


def test_decide_wakes_on_over_warning_client():
    """OVER_WARNING is also a critical wake bucket — the owner needs to
    know before it tips into OVER_CRITICAL."""
    utils = [_make_util(actual_mtd_hours=40.0)]  # OVER_WARNING at 100%
    decision = decide(
        utils, BucketThresholds(), raw_inputs_for_digest=b"x", now=TUESDAY
    )
    assert decision.wake is True
    assert decision.extra_metadata["critical_clients"][0]["bucket"] == "OVER_WARNING"


def test_decide_wakes_on_under_critical_client():
    utils = [_make_util(actual_mtd_hours=10.0)]  # UNDER_CRITICAL at 25%
    decision = decide(
        utils, BucketThresholds(), raw_inputs_for_digest=b"x", now=TUESDAY
    )
    assert decision.wake is True
    assert decision.extra_metadata["critical_clients"][0]["bucket"] == "UNDER_CRITICAL"


def test_decide_wakes_on_previously_critical_pending_ack():
    """Auto-promotion ban: a previously-critical client that has not been
    acknowledged continues to wake even if current bucket is balanced."""
    utils = [
        _make_util(
            actual_mtd_hours=30.0,  # currently BALANCED
            previously_critical_pending_ack=True,
        )
    ]
    decision = decide(
        utils, BucketThresholds(), raw_inputs_for_digest=b"x", now=TUESDAY
    )
    assert decision.wake is True
    assert decision.decision_basis == "previously_critical_pending_ack"
    assert decision.extra_metadata["pending_ack_clients"] == ["client_a"]


def test_decide_aggregates_multiple_critical_clients():
    utils = [
        _make_util(client_slug="a", actual_mtd_hours=50.0),  # OVER_CRITICAL
        _make_util(client_slug="b", actual_mtd_hours=10.0),  # UNDER_CRITICAL
        _make_util(client_slug="c", actual_mtd_hours=30.0),  # BALANCED
    ]
    decision = decide(
        utils, BucketThresholds(), raw_inputs_for_digest=b"x", now=TUESDAY
    )
    assert decision.wake is True
    critical = decision.extra_metadata["critical_clients"]
    assert len(critical) == 2
    assert {c["client_slug"] for c in critical} == {"a", "b"}


def test_decide_monday_takes_precedence_over_no_critical():
    """Monday boundary fires even if no client would otherwise wake."""
    utils = [_make_util(actual_mtd_hours=30.0)]
    decision = decide(
        utils, BucketThresholds(), raw_inputs_for_digest=b"x", now=MONDAY
    )
    assert decision.decision_basis == "weekly_mandatory_boundary"


# ---------------------------------------------------------------------------
# run_once() — integration tests with FakeConnector + FakeExecutor
# ---------------------------------------------------------------------------


def _capture_stdout(coro) -> tuple[int, str]:
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = _run(coro)
    return code, buf.getvalue().strip()


def test_run_once_emits_wake_on_monday():
    connectors = [FakeConnector([_make_util(actual_mtd_hours=30.0)])]
    executor = FakeExecutor()

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(
        run_once(connectors, BucketThresholds(), factory, now=MONDAY)
    )
    assert code == 0
    assert json.loads(out) == {"wakeAgent": True}
    assert executor.calls == []  # audit never invoked on wake path


def test_run_once_emits_wake_on_critical_client_midweek():
    connectors = [FakeConnector([_make_util(actual_mtd_hours=50.0)])]
    executor = FakeExecutor()

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(
        run_once(connectors, BucketThresholds(), factory, now=TUESDAY)
    )
    assert code == 0
    assert json.loads(out) == {"wakeAgent": True}
    assert executor.calls == []


def test_run_once_writes_audit_then_suppresses_on_quiet_tuesday():
    connectors = [FakeConnector([_make_util(actual_mtd_hours=30.0)])]
    executor = FakeExecutor()

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(
        run_once(connectors, BucketThresholds(), factory, now=TUESDAY)
    )
    assert code == 0
    assert json.loads(out) == {"wakeAgent": False}
    assert len(executor.calls) == 1
    sql, params = executor.calls[0]
    assert sql.startswith("INSERT INTO audit_log")
    assert params[2] == "SUPPRESSED_WAKE"  # action_type column
    assert params[5] == "retainer-hours-reconciler"  # skill_name column
    metadata = json.loads(params[11])
    assert metadata["decision_basis"] == "all_clients_in_balanced_or_under_warning"
    assert metadata["next_scheduled_at"] == "2026-05-27T09:00:00.000Z"
    assert metadata["client_count"] == 1


def test_run_once_falls_back_to_wake_on_audit_failure():
    """The critical safety contract: audit-write failure forces wake.

    Without this, a silent suppress is structurally indistinguishable
    from a silently-broken pre_run.py — exactly the failure mode the
    Devil's Advocate critique flagged.
    """
    connectors = [FakeConnector([_make_util(actual_mtd_hours=30.0)])]
    executor = FakeExecutor(fail=True)

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(
        run_once(connectors, BucketThresholds(), factory, now=TUESDAY)
    )
    assert code == 0
    assert json.loads(out) == {"wakeAgent": True}
    assert len(executor.calls) == 1  # the attempt was made before fallback


def test_run_once_falls_back_to_wake_when_writer_factory_returns_none():
    """No writer wired (dev mode / missing env) → wake. The contract is
    that suppress requires a trail; absent a trail, always wake."""
    connectors = [FakeConnector([_make_util(actual_mtd_hours=30.0)])]

    code, out = _capture_stdout(
        run_once(connectors, BucketThresholds(), lambda: None, now=TUESDAY)
    )
    assert code == 0
    assert json.loads(out) == {"wakeAgent": True}


def test_run_once_suppresses_with_multiple_clients_all_balanced():
    """Realistic agency: 5 clients, all balanced, on a quiet Tuesday.
    Exactly one audit row written; no agent wake."""
    connectors = [
        FakeConnector(
            [
                _make_util(client_slug=f"client_{i}", actual_mtd_hours=30.0)
                for i in range(5)
            ]
        )
    ]
    executor = FakeExecutor()

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(
        run_once(connectors, BucketThresholds(), factory, now=TUESDAY)
    )
    assert code == 0
    assert json.loads(out) == {"wakeAgent": False}
    assert len(executor.calls) == 1
    metadata = json.loads(executor.calls[0][1][11])
    assert metadata["client_count"] == 5
