"""Tests for paid-media-anomaly-watcher/pre_run.py (ADR 0021 Stream B).

Exercises the wake / suppress decision logic, the audit emission, and the
mirror-don't-gate fallback (audit failure → wake). Uses a fake
PaidMediaConnector + a fake AuditLogWriter pair so the tests run with no
network, no real OAuth, and no D1.

Run from repo root:

    cd operator && python -m pytest \
        skills/paid-media-anomaly-watcher/test_pre_run.py -v
"""

from __future__ import annotations

import asyncio
import io
import json
import sys
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

import pytest

# Allow running from repo root or from operator/. The skill directory
# uses dashes, not underscores, so it is NOT importable as a Python package;
# we add it to sys.path and import `pre_run` as a top-level module.
_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # operator/ on sys.path (for adapter.*)
sys.path.insert(0, str(_HERE.parent))  # the skill dir itself (for pre_run)

from adapter.audit_log import (  # noqa: E402
    AuditLogWriter,
    AuditWriteError,
    SuppressedWakeWriter,
)
from pre_run import (  # noqa: E402
    AnomalyThresholds,
    BaselineMetrics,
    CampaignMetrics,
    CampaignSnapshot,
    decide,
    run_once,
)


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeConnector:
    """Stand-in for a paid-media platform adapter. Returns whatever
    snapshots the test injected."""

    def __init__(self, snapshots: Sequence[CampaignSnapshot]) -> None:
        self._snapshots = snapshots

    def pull_snapshots(self) -> Sequence[CampaignSnapshot]:
        return self._snapshots


class FakeExecutor:
    """Audit executor that records SQL calls or raises on demand."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple[str, list]] = []

    async def execute(self, sql: str, params: list) -> None:
        self.calls.append((sql, params))
        if self.fail:
            raise RuntimeError("D1 unreachable")


def _make_snapshot(
    *,
    campaign_id: str = "camp_1",
    platform: str = "meta",
    cpl: float = 10.0,
    cpl_avg: float = 10.0,
    frequency: float = 2.0,
    ctr: float = 0.05,
    ctr_avg: float = 0.05,
    conversions: int = 100,
    conversions_avg: float = 100.0,
) -> CampaignSnapshot:
    return CampaignSnapshot(
        daily=CampaignMetrics(
            campaign_id=campaign_id,
            platform=platform,
            cpl=cpl,
            frequency=frequency,
            ctr=ctr,
            spend=100.0,
            conversions=conversions,
        ),
        baseline=BaselineMetrics(
            cpl_avg=cpl_avg,
            frequency_avg=2.0,
            ctr_avg=ctr_avg,
            spend_avg=100.0,
            conversions_avg=conversions_avg,
        ),
    )


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# decide() — pure function tests
# ---------------------------------------------------------------------------


def test_decide_suppresses_when_no_anomalies():
    snaps = [_make_snapshot()]  # daily == baseline
    decision = decide(snaps, AnomalyThresholds(), raw_inputs_for_digest=b"x")
    assert decision.wake is False
    assert decision.decision_basis == "delta_under_threshold"
    assert decision.anomaly_count == 0
    assert decision.extra_metadata == {"campaigns_evaluated": 1}


def test_decide_wakes_on_cpl_spike():
    snaps = [_make_snapshot(cpl=25.0, cpl_avg=10.0)]  # 2.5× baseline > 2×
    decision = decide(snaps, AnomalyThresholds(), raw_inputs_for_digest=b"x")
    assert decision.wake is True
    assert decision.decision_basis == "anomaly_above_threshold"
    assert decision.anomaly_count == 1
    assert decision.extra_metadata["anomalies"][0]["kind"] == "cpl_spike"
    assert decision.extra_metadata["anomalies"][0]["severity"] == "CRITICAL"


def test_decide_wakes_on_frequency_saturation():
    snaps = [_make_snapshot(frequency=6.0)]  # > ceiling 5.0
    decision = decide(snaps, AnomalyThresholds(), raw_inputs_for_digest=b"x")
    assert decision.wake is True
    assert decision.extra_metadata["anomalies"][0]["kind"] == "frequency_saturation"


def test_decide_wakes_on_ctr_collapse():
    snaps = [_make_snapshot(ctr=0.02, ctr_avg=0.05)]  # 40% of baseline < 60%
    decision = decide(snaps, AnomalyThresholds(), raw_inputs_for_digest=b"x")
    assert decision.wake is True
    assert decision.extra_metadata["anomalies"][0]["kind"] == "ctr_collapse"


def test_decide_wakes_on_conversion_drop():
    snaps = [_make_snapshot(conversions=50, conversions_avg=100.0)]  # 50% < 70%
    decision = decide(snaps, AnomalyThresholds(), raw_inputs_for_digest=b"x")
    assert decision.wake is True
    assert decision.extra_metadata["anomalies"][0]["kind"] == "conversion_drop"


def test_decide_handles_zero_baseline_gracefully():
    """Brand-new campaign with no history (baseline averages == 0) does
    not falsely fire CPL/CTR/conversion anomalies — divide-by-zero protection."""
    snap = CampaignSnapshot(
        daily=CampaignMetrics("new", "google", cpl=50.0, frequency=1.0, ctr=0.03, spend=10.0, conversions=5),
        baseline=BaselineMetrics(cpl_avg=0.0, frequency_avg=0.0, ctr_avg=0.0, spend_avg=0.0, conversions_avg=0.0),
    )
    decision = decide([snap], AnomalyThresholds(), raw_inputs_for_digest=b"x")
    assert decision.wake is False  # no baseline ⇒ no anomaly fires


def test_decide_aggregates_multiple_anomalies():
    snaps = [
        _make_snapshot(campaign_id="a", cpl=25.0, cpl_avg=10.0),
        _make_snapshot(campaign_id="b", frequency=6.0),
    ]
    decision = decide(snaps, AnomalyThresholds(), raw_inputs_for_digest=b"x")
    assert decision.wake is True
    assert decision.anomaly_count == 2


# ---------------------------------------------------------------------------
# run_once() — integration tests with FakeConnector + FakeExecutor
# ---------------------------------------------------------------------------


def _capture_stdout(coro) -> tuple[int, str]:
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = _run(coro)
    return code, buf.getvalue().strip()


def test_run_once_emits_wake_on_anomaly():
    connectors = [FakeConnector([_make_snapshot(cpl=25.0, cpl_avg=10.0)])]
    executor = FakeExecutor()

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(
        run_once(connectors, AnomalyThresholds(), factory)
    )
    assert code == 0
    assert json.loads(out) == {"wakeAgent": True}
    assert executor.calls == []  # never invoked on the wake path


def test_run_once_writes_audit_then_suppresses_on_clean_data():
    connectors = [FakeConnector([_make_snapshot()])]  # daily == baseline
    executor = FakeExecutor()

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(
        run_once(
            connectors,
            AnomalyThresholds(),
            factory,
            now=datetime(2026, 5, 25, 7, 0, tzinfo=timezone.utc),
        )
    )
    assert code == 0
    assert json.loads(out) == {"wakeAgent": False}
    assert len(executor.calls) == 1
    sql, params = executor.calls[0]
    assert sql.startswith("INSERT INTO audit_log")
    assert params[2] == "SUPPRESSED_WAKE"  # action_type column
    assert params[5] == "paid-media-anomaly-watcher"  # skill_name column
    metadata = json.loads(params[11])
    assert metadata["decision_basis"] == "delta_under_threshold"
    assert metadata["next_scheduled_at"] == "2026-05-26T07:00:00.000Z"
    assert metadata["campaigns_evaluated"] == 1


def test_run_once_falls_back_to_wake_on_audit_failure():
    """The critical safety contract: audit-write failure forces wake.

    Without this, a silent suppress is structurally indistinguishable from
    a silently-broken pre_run.py — exactly the failure mode the
    Devil's Advocate critique flagged.
    """
    connectors = [FakeConnector([_make_snapshot()])]  # would suppress
    executor = FakeExecutor(fail=True)  # but audit write blows up

    def factory():
        return SuppressedWakeWriter(AuditLogWriter(executor))

    code, out = _capture_stdout(
        run_once(connectors, AnomalyThresholds(), factory)
    )
    assert code == 0
    assert json.loads(out) == {"wakeAgent": True}
    # The audit attempt was made (and failed) before the fallback.
    assert len(executor.calls) == 1


def test_run_once_falls_back_to_wake_when_writer_factory_returns_none():
    """No writer wired (dev mode / missing env) → wake. The contract is
    that suppress requires a trail; absent a trail, always wake."""
    connectors = [FakeConnector([_make_snapshot()])]

    code, out = _capture_stdout(
        run_once(connectors, AnomalyThresholds(), lambda: None)
    )
    assert code == 0
    assert json.loads(out) == {"wakeAgent": True}


# ---------------------------------------------------------------------------
# SuppressedWakeWriter direct tests
# ---------------------------------------------------------------------------


def test_suppressed_wake_writer_emits_correct_row():
    executor = FakeExecutor()
    writer = SuppressedWakeWriter(AuditLogWriter(executor))
    _run(
        writer.write_suppressed_wake(
            skill_name="some-skill",
            pre_run_inputs=b"raw-snapshot-bytes",
            decision_basis="delta_under_threshold",
            next_scheduled_at="2026-05-26T07:00:00.000Z",
            extra_metadata={"campaigns_evaluated": 3},
        )
    )
    assert len(executor.calls) == 1
    sql, params = executor.calls[0]
    assert params[2] == "SUPPRESSED_WAKE"
    assert params[5] == "some-skill"
    assert params[4] == "agent"  # actor_role
    # input_digest column is the SHA-256 of pre_run_inputs
    import hashlib

    expected = hashlib.sha256(b"raw-snapshot-bytes").hexdigest()
    assert params[7] == expected
    metadata = json.loads(params[11])
    assert metadata == {
        "decision_basis": "delta_under_threshold",
        "next_scheduled_at": "2026-05-26T07:00:00.000Z",
        "campaigns_evaluated": 3,
    }


def test_suppressed_wake_writer_raises_on_executor_failure():
    executor = FakeExecutor(fail=True)
    writer = SuppressedWakeWriter(AuditLogWriter(executor))
    with pytest.raises(AuditWriteError):
        _run(
            writer.write_suppressed_wake(
                skill_name="some-skill",
                pre_run_inputs=b"x",
                decision_basis="delta_under_threshold",
                next_scheduled_at="2026-05-26T07:00:00.000Z",
            )
        )


def test_suppressed_wake_writer_rejects_reserved_metadata_keys():
    """Caller cannot smuggle their own `decision_basis` or
    `next_scheduled_at` into extra_metadata — those are the wrapper's
    schema fields."""
    executor = FakeExecutor()
    writer = SuppressedWakeWriter(AuditLogWriter(executor))
    with pytest.raises(ValueError):
        _run(
            writer.write_suppressed_wake(
                skill_name="x",
                pre_run_inputs=b"x",
                decision_basis="a",
                next_scheduled_at="z",
                extra_metadata={"decision_basis": "evil"},  # collision
            )
        )
