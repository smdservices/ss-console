"""End-to-end tests for bin/lib/decommission.py against the smd fixture.

Coverage:

* dry-run prints per-step plan, performs no destructive operations,
  writes no audit rows, exits 0;
* live mode runs the 9-step sequence to completion against fake
  external services (memory, voice, R2, Vectorize) + NoOpStubs
  (Composio, AgentMail, Fly);
* idempotency: dry-run x2 -> live -> live again all succeed cleanly
  (the second live run is a full no-op because every step is already
  done);
* failure halts: a runner that raises mid-sequence halts with
  ``DecommissionStepFailed`` and the audit log contains a failure row
  for the failed step;
* audit-log emission: every step emits begin + end rows, plus a final
  ``DECOMMISSION_FINAL`` row.

The smd customer-zero fixture is copied into a tmp customers/ root per
test so the tombstone step can rename without touching the checked-in
fixture.
"""

from __future__ import annotations

import asyncio
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import pytest

_HERE = Path(__file__).resolve()
# ai-employee/ on sys.path so `from adapter.audit_log import ...` resolves.
sys.path.insert(0, str(_HERE.parents[2]))

from adapter.audit_log import (  # noqa: E402
    ACCEPTED_ACTION_TYPES,
    AuditEvent,
    AuditLogWriter,
    SqliteExecutor,
)
from bin.lib.decommission import (  # noqa: E402
    DecommissionPipeline,
    DecommissionStepFailed,
    FilesystemTombstoner,
    InMemoryComplianceArchiver,
    NoOpAgentMailStub,
    NoOpComposioStub,
    NoOpFlyStub,
    StepStatus,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_AUDIT_SCHEMA = """
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  ts            TEXT NOT NULL,
  action_type   TEXT NOT NULL,
  actor         TEXT NOT NULL,
  actor_role    TEXT,
  skill_name    TEXT,
  matter_ref    TEXT,
  input_digest  TEXT,
  output_digest TEXT,
  diff_digest   TEXT,
  trust_ceiling TEXT,
  metadata      TEXT
);
"""


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _make_audit(tmp_path: Path) -> tuple[AuditLogWriter, sqlite3.Connection]:
    conn = sqlite3.connect(str(tmp_path / "audit.sqlite"))
    conn.executescript(_AUDIT_SCHEMA)
    return AuditLogWriter(SqliteExecutor(conn)), conn


def _copy_fixture(tmp_path: Path) -> Path:
    """Copy the smd fixture into a fresh customers/ root under tmp_path."""
    src = _HERE.parent.parent / "fixtures" / "smd"
    assert src.exists(), f"smd fixture missing at {src}"
    customers_root = tmp_path / "customers"
    customers_root.mkdir(parents=True)
    shutil.copytree(src, customers_root / "smd")
    return customers_root


# ---------------------------------------------------------------------------
# Fake runners (memory + voice + R2 + Vectorize)
#
# Tracks calls so the idempotency assertion can check that re-runs are
# no-ops the second time around.
# ---------------------------------------------------------------------------


class _RecordingMemoryRunner:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self._depleted: set[tuple[str, str]] = set()

    async def run(self, source_kind: str, source_id: str) -> dict:
        self.calls.append((source_kind, source_id))
        if (source_kind, source_id) in self._depleted:
            return {"items_removed": 0, "r2_objects_removed": 0,
                    "vectorize_vectors_removed": 0, "skipped": False}
        self._depleted.add((source_kind, source_id))
        return {"items_removed": 4, "r2_objects_removed": 4,
                "vectorize_vectors_removed": 2, "skipped": False}


class _RecordingVoiceRunner:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self._depleted: set[tuple[str, str]] = set()

    async def run(self, source_kind: str, source_id: str) -> dict:
        self.calls.append((source_kind, source_id))
        if (source_kind, source_id) in self._depleted:
            return {"removed": 0, "errors": 0, "skipped": False}
        self._depleted.add((source_kind, source_id))
        return {"removed": 3, "errors": 0, "skipped": False}


class _RecordingR2Deleter:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self._depleted: set[str] = set()

    async def delete_namespace(self, customer_slug: str) -> dict:
        self.calls.append(customer_slug)
        if customer_slug in self._depleted:
            return {"objects_deleted": 0, "skipped": True, "reason": "namespace_already_empty"}
        self._depleted.add(customer_slug)
        return {"objects_deleted": 12}


class _RecordingVectorizeDeleter:
    def __init__(self) -> None:
        self.calls: list[str] = []
        self._depleted: set[str] = set()

    async def delete_indexes(self, customer_slug: str) -> dict:
        self.calls.append(customer_slug)
        if customer_slug in self._depleted:
            return {"indexes_deleted": 0, "skipped": True, "reason": "indexes_already_absent"}
        self._depleted.add(customer_slug)
        return {"indexes_deleted": 2}


class _FailingRunner:
    """Raises on first run; succeeds on second so the resume path can be tested."""

    def __init__(self) -> None:
        self.calls: list[str] = []
        self._failed_once = False

    async def delete_namespace(self, customer_slug: str) -> dict:
        self.calls.append(customer_slug)
        if not self._failed_once:
            self._failed_once = True
            raise RuntimeError("wrangler timed out")
        return {"objects_deleted": 7}


# ---------------------------------------------------------------------------
# Tests: dry-run
# ---------------------------------------------------------------------------


def test_dry_run_returns_planned_steps_and_does_nothing(tmp_path):
    customers_root = _copy_fixture(tmp_path)
    writer, conn = _make_audit(tmp_path)
    pipeline = DecommissionPipeline(
        customer_slug="smd",
        customers_root=customers_root,
        archive_root=tmp_path / "archive",
        audit_writer=writer,
        memory_runner=_RecordingMemoryRunner(),
        voice_runner=_RecordingVoiceRunner(),
        r2_deleter=_RecordingR2Deleter(),
        vectorize_deleter=_RecordingVectorizeDeleter(),
    )
    plan = _run(pipeline.plan())

    assert [r.name for r in plan] == [
        "01_drain", "02_d1_memory_voice", "03_r2_namespace",
        "04_vectorize_indexes", "05_composio", "06_agentmail",
        "07_fly_machine", "08_compliance_archive", "09_tombstone",
    ]
    for r in plan:
        assert r.status == StepStatus.PLANNED
    # Live customer dir is untouched.
    assert (customers_root / "smd" / "customer.yaml").exists()
    # No audit rows written for plan().
    rows = conn.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0]
    assert rows == 0


# ---------------------------------------------------------------------------
# Tests: live mode end-to-end
# ---------------------------------------------------------------------------


def test_live_runs_full_sequence_and_writes_audit_trail(tmp_path):
    customers_root = _copy_fixture(tmp_path)
    writer, conn = _make_audit(tmp_path)
    mem = _RecordingMemoryRunner()
    voi = _RecordingVoiceRunner()
    r2 = _RecordingR2Deleter()
    vec = _RecordingVectorizeDeleter()
    pipeline = DecommissionPipeline(
        customer_slug="smd",
        customers_root=customers_root,
        archive_root=tmp_path / "archive",
        audit_writer=writer,
        memory_runner=mem,
        voice_runner=voi,
        r2_deleter=r2,
        vectorize_deleter=vec,
    )

    results = _run(pipeline.run())

    assert len(results) == 9
    assert mem.calls, "memory runner should have been called for each configured source"
    assert voi.calls
    assert r2.calls == ["smd"]
    assert vec.calls == ["smd"]
    # Customer dir tombstoned.
    assert not (customers_root / "smd").exists()
    tomb = list(customers_root.glob("smd.decommissioned.*"))
    assert len(tomb) == 1
    assert (tomb[0] / "DECOMMISSIONED.md").exists()
    assert (tomb[0] / "customer.yaml").exists()
    # Compliance archive manifest written.
    archive = list((tmp_path / "archive" / "smd").glob("compliance-packet-manifest-*.json"))
    assert len(archive) == 1
    # Audit rows: begin/end per step + DECOMMISSION_FINAL.
    rows = conn.execute(
        "SELECT action_type FROM audit_log ORDER BY id"
    ).fetchall()
    action_types = [r[0] for r in rows]
    # At least one row per step plus DECOMMISSION_FINAL.
    assert "DECOMMISSION_INITIATED" in action_types
    assert "DECOMMISSION_DRAIN_COMPLETE" in action_types
    assert "DECOMMISSION_FINAL" in action_types
    # Every action_type written is in the spec's accepted set.
    for at in action_types:
        assert at in ACCEPTED_ACTION_TYPES


# ---------------------------------------------------------------------------
# Tests: idempotency — dry-run x2 -> live -> live again all succeed
# ---------------------------------------------------------------------------


def test_idempotent_repeated_runs(tmp_path):
    customers_root = _copy_fixture(tmp_path)
    writer, _conn = _make_audit(tmp_path)
    mem = _RecordingMemoryRunner()
    voi = _RecordingVoiceRunner()
    r2 = _RecordingR2Deleter()
    vec = _RecordingVectorizeDeleter()
    pipeline = DecommissionPipeline(
        customer_slug="smd",
        customers_root=customers_root,
        archive_root=tmp_path / "archive",
        audit_writer=writer,
        memory_runner=mem,
        voice_runner=voi,
        r2_deleter=r2,
        vectorize_deleter=vec,
    )

    # Dry-run x2 — both succeed, no destructive changes.
    _run(pipeline.plan())
    _run(pipeline.plan())
    assert (customers_root / "smd").exists()

    # Live x1 — full sequence.
    first = _run(pipeline.run())
    assert all(r.status in (StepStatus.EXECUTED, StepStatus.SKIPPED) for r in first)
    assert not (customers_root / "smd").exists()

    # Live x2 — fully decommissioned customer, every step idempotent.
    second = _run(pipeline.run())
    assert len(second) == 9
    # Tombstone step returns skipped on the second run (already tombstoned).
    tomb_step = next(r for r in second if r.name == "09_tombstone")
    assert tomb_step.status == StepStatus.SKIPPED
    assert tomb_step.detail.get("reason") == "already_tombstoned"
    # R2 step second time reports namespace already empty.
    r2_step = next(r for r in second if r.name == "03_r2_namespace")
    assert r2_step.status == StepStatus.SKIPPED
    # Vectorize same shape.
    vec_step = next(r for r in second if r.name == "04_vectorize_indexes")
    assert vec_step.status == StepStatus.SKIPPED


# ---------------------------------------------------------------------------
# Tests: failure halts the sequence and surfaces a clear error
# ---------------------------------------------------------------------------


def test_failure_halts_with_step_failed(tmp_path):
    customers_root = _copy_fixture(tmp_path)
    writer, conn = _make_audit(tmp_path)
    failing_r2 = _FailingRunner()
    pipeline = DecommissionPipeline(
        customer_slug="smd",
        customers_root=customers_root,
        archive_root=tmp_path / "archive",
        audit_writer=writer,
        memory_runner=_RecordingMemoryRunner(),
        voice_runner=_RecordingVoiceRunner(),
        r2_deleter=failing_r2,
        vectorize_deleter=_RecordingVectorizeDeleter(),
    )

    with pytest.raises(DecommissionStepFailed) as ei:
        _run(pipeline.run())

    assert ei.value.step_name == "03_r2_namespace"
    assert ei.value.customer_slug == "smd"
    # Customer dir is NOT tombstoned (we halted before step 9).
    assert (customers_root / "smd").exists()
    # Audit log contains the failure metadata for that step.
    failure_rows = conn.execute(
        "SELECT metadata FROM audit_log WHERE action_type = 'DECOMMISSION_INITIATED'"
    ).fetchall()
    failure_text = " ".join(r[0] or "" for r in failure_rows)
    assert "failed" in failure_text
    assert "03_r2_namespace" in failure_text

    # Resume path: with the failure latched, second run completes (R2
    # raised only once); idempotency contract holds.
    results = _run(pipeline.run())
    assert any(r.name == "09_tombstone" for r in results)


# ---------------------------------------------------------------------------
# Tests: tombstone with no live customer dir is a clean skip
# ---------------------------------------------------------------------------


def test_tombstone_skips_when_no_customer_dir(tmp_path):
    customers_root = tmp_path / "customers"
    customers_root.mkdir()
    tomb = FilesystemTombstoner(customers_root)
    result = tomb.tombstone("ghost-customer")
    assert result["skipped"] is True
    assert result["reason"] == "no_customer_dir"


def test_tombstone_idempotent_when_already_tombstoned(tmp_path):
    customers_root = tmp_path / "customers"
    customers_root.mkdir()
    (customers_root / "smd").mkdir()
    (customers_root / "smd" / "customer.yaml").write_text("x")
    tomb = FilesystemTombstoner(customers_root)
    when = datetime(2026, 5, 21, tzinfo=timezone.utc)
    first = tomb.tombstone("smd", now=when)
    assert first["skipped"] is False
    second = tomb.tombstone("smd", now=when)
    assert second["skipped"] is True
    assert second["reason"] == "already_tombstoned"


# ---------------------------------------------------------------------------
# Tests: stubs return skipped manifests
# ---------------------------------------------------------------------------


def test_noop_stubs_return_skipped_manifests():
    composio = NoOpComposioStub()
    agentmail = NoOpAgentMailStub()
    fly = NoOpFlyStub()
    r1 = _run(composio.revoke_connections("smd"))
    r2 = _run(agentmail.deprovision("smd"))
    r3 = _run(fly.destroy_machine("smd"))
    assert r1["skipped"] is True
    assert r2["skipped"] is True
    assert r3["skipped"] is True
    for r in (r1, r2, r3):
        assert r["reason"] == "external_client_not_wired"


# ---------------------------------------------------------------------------
# Tests: compliance archiver writes a manifest
# ---------------------------------------------------------------------------


def test_compliance_archiver_writes_manifest(tmp_path):
    archiver = InMemoryComplianceArchiver()
    archive_dir = tmp_path / "archive" / "smd"
    result = _run(archiver.archive("smd", archive_dir))
    assert Path(result["archive_path"]).exists()
    assert result["stub"] is True
