"""Tests for ai-employee/adapter/memory/retention.py (issue #863).

Coverage:

* Per-data-type retention windows are read from customer.yaml and
  default values are applied when keys are missing.
* The retention runner deletes only rows whose ``ingested_at`` is older
  than the configured window for the item type, leaving fresh rows
  untouched.
* Per-matter access controls are respected: a ``firm_wide`` sweep does
  not touch ``partner-only`` rows.
* Re-running on a recently-cleaned store is a no-op (idempotency).
* The cross-pipeline runner composes the memory pass with the voice
  pipeline's existing ``enforce_retention`` and emits exactly one audit
  row per pipeline.

Run from repo root::

    cd ai-employee && python -m pytest adapter/tests/test_retention.py -v
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # ai-employee/ on sys.path

from adapter.memory.retention import (  # noqa: E402
    DEFAULT_AUDIT_LOG_DAYS,
    DEFAULT_DOCUMENTS_DAYS,
    DEFAULT_DRAFTS_DAYS,
    DEFAULT_MATTERS_DAYS,
    DEFAULT_RECIPIENTS_DAYS,
    DEFAULT_VOICE_SAMPLES_DAYS,
    DeletingScope,
    MemoryRetentionPolicy,
    run_full_retention,
    run_memory_retention,
)


# ---------------------------------------------------------------------------
# Schema mirror — same shape as adapter/memory/state.py expects
# ---------------------------------------------------------------------------


_SCHEMA_SQL = """
CREATE TABLE memory_ingested_items (
  id                   TEXT PRIMARY KEY,
  source_kind          TEXT NOT NULL,
  source_id            TEXT NOT NULL,
  external_id          TEXT NOT NULL,
  item_type            TEXT NOT NULL,
  ingested_at          TEXT NOT NULL,
  access_scope         TEXT NOT NULL DEFAULT 'firm-wide',
  access_scope_detail  TEXT,
  r2_key               TEXT,
  vectorize_chunk_ids  TEXT,
  content_digest       TEXT,
  metadata             TEXT,
  deleted_at           TEXT
);
"""


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _DualExecutor:
    """Sqlite-backed executor matching adapter.memory.state's expected shape."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    async def execute(self, sql: str, params: list) -> None:
        self._conn.execute(sql, params)
        self._conn.commit()

    async def query(self, sql: str, params: list) -> list[dict]:
        cur = self._conn.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


class _FakeStorage:
    """Tracks R2 + Vectorize deletes for assertion."""

    def __init__(self) -> None:
        self.r2_deletes: list[str] = []
        self.vector_deletes: list[list[str]] = []
        self.r2_fail_on: set[str] = set()

    async def delete_r2_object(self, key: str) -> None:
        if key in self.r2_fail_on:
            raise RuntimeError(f"simulated R2 outage for {key}")
        self.r2_deletes.append(key)

    async def delete_vectorize_vectors(self, vector_ids: list[str]) -> None:
        self.vector_deletes.append(list(vector_ids))


class _FakeAuditWriter:
    """Records every AuditEvent passed to ``write``."""

    def __init__(self) -> None:
        self.events: list[object] = []

    async def write(self, event: object) -> str:
        self.events.append(event)
        return "01ABCDEFGHJKMNPQRSTVWXYZ00"


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _insert_item(
    conn: sqlite3.Connection,
    *,
    item_id: str,
    item_type: str,
    ingested_at: str,
    access_scope: str = "firm-wide",
    r2_key: str | None = None,
    chunk_ids: list[str] | None = None,
) -> None:
    conn.execute(
        "INSERT INTO memory_ingested_items "
        "(id, source_kind, source_id, external_id, item_type, ingested_at, "
        " access_scope, r2_key, vectorize_chunk_ids) "
        "VALUES (?, 'practice_management', 'filevine', ?, ?, ?, ?, ?, ?)",
        [
            item_id,
            f"ext-{item_id}",
            item_type,
            ingested_at,
            access_scope,
            r2_key,
            json.dumps(chunk_ids) if chunk_ids else None,
        ],
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Policy construction
# ---------------------------------------------------------------------------


def test_policy_defaults_match_documented_values():
    policy = MemoryRetentionPolicy()
    assert policy.matters_days == DEFAULT_MATTERS_DAYS
    assert policy.documents_days == DEFAULT_DOCUMENTS_DAYS
    assert policy.recipients_days == DEFAULT_RECIPIENTS_DAYS
    assert policy.voice_samples_days == DEFAULT_VOICE_SAMPLES_DAYS
    assert policy.audit_log_days == DEFAULT_AUDIT_LOG_DAYS
    assert policy.drafts_days == DEFAULT_DRAFTS_DAYS


def test_policy_from_customer_yaml_partial_override():
    parsed = {
        "memory": {
            "retention": {
                "matters_days": 90,
                "documents_days": 60,
                # voice_samples_days omitted: should fall back to default
            }
        }
    }
    policy = MemoryRetentionPolicy.from_customer_yaml(parsed)
    assert policy.matters_days == 90
    assert policy.documents_days == 60
    assert policy.voice_samples_days == DEFAULT_VOICE_SAMPLES_DAYS
    assert policy.audit_log_days == DEFAULT_AUDIT_LOG_DAYS


def test_policy_from_customer_yaml_with_no_retention_block_uses_defaults():
    parsed = {"memory": {"d1_namespace": "demo-firm"}}
    policy = MemoryRetentionPolicy.from_customer_yaml(parsed)
    assert policy.matters_days == DEFAULT_MATTERS_DAYS


def test_policy_from_customer_yaml_with_missing_memory_block_uses_defaults():
    parsed = {"customer_id": "demo-firm"}
    policy = MemoryRetentionPolicy.from_customer_yaml(parsed)
    assert policy.documents_days == DEFAULT_DOCUMENTS_DAYS


def test_policy_rejects_non_positive_window():
    with pytest.raises(ValueError, match="matters_days"):
        MemoryRetentionPolicy(matters_days=0)
    with pytest.raises(ValueError, match="documents_days"):
        MemoryRetentionPolicy(documents_days=-1)


def test_policy_ignores_non_int_yaml_value_with_log_fallback():
    parsed = {"memory": {"retention": {"matters_days": "ninety"}}}
    policy = MemoryRetentionPolicy.from_customer_yaml(parsed)
    assert policy.matters_days == DEFAULT_MATTERS_DAYS


# ---------------------------------------------------------------------------
# Deleting scope
# ---------------------------------------------------------------------------


def test_deleting_scope_firm_wide_filters_to_firm_scope_only():
    assert DeletingScope.FIRM_WIDE.scopes() == ("firm-wide",)
    assert DeletingScope.PARTNER_ONLY.scopes() == ("partner-only",)
    assert DeletingScope.ATTORNEY_LIST.scopes() == ("attorney-list",)
    assert set(DeletingScope.ALL.scopes()) == {
        "firm-wide",
        "partner-only",
        "attorney-list",
    }


# ---------------------------------------------------------------------------
# Memory retention runner — per-type windows
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime(2026, 5, 21, 12, 0, 0, tzinfo=timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def test_runner_deletes_only_rows_older_than_per_type_window():
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_SQL)

    now = _now()
    # Documents: window=30 days. One fresh, one expired.
    _insert_item(
        conn,
        item_id="doc-fresh",
        item_type="document",
        ingested_at=_iso(now - timedelta(days=10)),
        r2_key="demo/vault/process/doc-fresh.txt",
        chunk_ids=["c1", "c2"],
    )
    _insert_item(
        conn,
        item_id="doc-expired",
        item_type="document",
        ingested_at=_iso(now - timedelta(days=120)),
        r2_key="demo/vault/process/doc-expired.txt",
        chunk_ids=["c9"],
    )
    # Matters: window=365 days. Fresh (300d old) and expired (400d).
    _insert_item(
        conn,
        item_id="matter-fresh",
        item_type="matter",
        ingested_at=_iso(now - timedelta(days=300)),
        r2_key="demo/vault/narrative/matter-fresh.json",
    )
    _insert_item(
        conn,
        item_id="matter-expired",
        item_type="matter",
        ingested_at=_iso(now - timedelta(days=400)),
        r2_key="demo/vault/narrative/matter-expired.json",
    )

    executor = _DualExecutor(conn)
    storage = _FakeStorage()
    policy = MemoryRetentionPolicy(
        matters_days=365,
        documents_days=30,
        recipients_days=365,
        voice_samples_days=365,
        audit_log_days=365,
        drafts_days=30,
    )

    result = _run(
        run_memory_retention(
            executor=executor,
            storage=storage,
            policy=policy,
            now=now,
        )
    )

    per_type = {t.item_type: t for t in result.per_type}
    assert per_type["document"].considered == 1
    assert per_type["document"].deleted == 1
    assert per_type["matter"].considered == 1
    assert per_type["matter"].deleted == 1
    assert per_type["recipient"].considered == 0
    assert per_type["recipient"].deleted == 0

    # R2 deletes hit only the expired keys.
    assert "demo/vault/process/doc-expired.txt" in storage.r2_deletes
    assert "demo/vault/narrative/matter-expired.json" in storage.r2_deletes
    assert "demo/vault/process/doc-fresh.txt" not in storage.r2_deletes
    assert "demo/vault/narrative/matter-fresh.json" not in storage.r2_deletes

    # Vector deletes only for the expired document.
    assert storage.vector_deletes == [["c9"]]

    # Fresh rows are still active; expired rows are soft-deleted.
    deleted_ids = {
        row[0]
        for row in conn.execute(
            "SELECT id FROM memory_ingested_items WHERE deleted_at IS NOT NULL"
        ).fetchall()
    }
    assert deleted_ids == {"doc-expired", "matter-expired"}


def test_runner_respects_per_matter_access_scope():
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_SQL)
    now = _now()
    # A partner-only matter old enough to be expired under any window.
    _insert_item(
        conn,
        item_id="partner-matter",
        item_type="matter",
        ingested_at=_iso(now - timedelta(days=10_000)),
        access_scope="partner-only",
        r2_key="demo/vault/narrative/partner-matter.json",
    )
    # A firm-wide matter also expired.
    _insert_item(
        conn,
        item_id="firm-matter",
        item_type="matter",
        ingested_at=_iso(now - timedelta(days=10_000)),
        access_scope="firm-wide",
        r2_key="demo/vault/narrative/firm-matter.json",
    )

    executor = _DualExecutor(conn)
    storage = _FakeStorage()
    policy = MemoryRetentionPolicy()  # defaults

    # Firm-wide sweep must not touch the partner-only row.
    result = _run(
        run_memory_retention(
            executor=executor,
            storage=storage,
            policy=policy,
            deleting_scope=DeletingScope.FIRM_WIDE,
            now=now,
        )
    )
    per_type = {t.item_type: t for t in result.per_type}
    assert per_type["matter"].considered == 1
    assert per_type["matter"].deleted == 1
    assert storage.r2_deletes == ["demo/vault/narrative/firm-matter.json"]

    # Partner-only row still active.
    active = {
        row[0]
        for row in conn.execute(
            "SELECT id FROM memory_ingested_items WHERE deleted_at IS NULL"
        ).fetchall()
    }
    assert "partner-matter" in active
    assert "firm-matter" not in active

    # Now run a partner-only sweep — should clean up the remaining row.
    result_partner = _run(
        run_memory_retention(
            executor=executor,
            storage=storage,
            policy=policy,
            deleting_scope=DeletingScope.PARTNER_ONLY,
            now=now,
        )
    )
    per_type2 = {t.item_type: t for t in result_partner.per_type}
    assert per_type2["matter"].deleted == 1
    assert "demo/vault/narrative/partner-matter.json" in storage.r2_deletes


def test_runner_is_idempotent_when_no_new_expired_rows():
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_SQL)
    now = _now()
    _insert_item(
        conn,
        item_id="recent",
        item_type="document",
        ingested_at=_iso(now - timedelta(days=1)),
        r2_key="demo/vault/process/recent.txt",
    )

    executor = _DualExecutor(conn)
    storage = _FakeStorage()
    policy = MemoryRetentionPolicy(documents_days=365)

    first = _run(
        run_memory_retention(executor=executor, storage=storage, policy=policy, now=now)
    )
    second = _run(
        run_memory_retention(executor=executor, storage=storage, policy=policy, now=now)
    )
    assert first.total_considered == 0
    assert first.total_deleted == 0
    assert second.total_considered == 0
    assert second.total_deleted == 0
    assert storage.r2_deletes == []


def test_runner_counts_errors_without_aborting_sweep():
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_SQL)
    now = _now()
    # Two expired documents; the first will trip a simulated R2 outage.
    _insert_item(
        conn,
        item_id="doc-bad",
        item_type="document",
        ingested_at=_iso(now - timedelta(days=999)),
        r2_key="demo/vault/process/doc-bad.txt",
    )
    _insert_item(
        conn,
        item_id="doc-good",
        item_type="document",
        ingested_at=_iso(now - timedelta(days=999)),
        r2_key="demo/vault/process/doc-good.txt",
    )

    executor = _DualExecutor(conn)
    storage = _FakeStorage()
    storage.r2_fail_on.add("demo/vault/process/doc-bad.txt")
    policy = MemoryRetentionPolicy(documents_days=30)

    result = _run(
        run_memory_retention(executor=executor, storage=storage, policy=policy, now=now)
    )
    per_type = {t.item_type: t for t in result.per_type}
    # Both considered; one fail, one success.
    assert per_type["document"].considered == 2
    assert per_type["document"].deleted == 1
    assert per_type["document"].errors == 1


# ---------------------------------------------------------------------------
# Cross-pipeline runner
# ---------------------------------------------------------------------------


def test_run_full_retention_invokes_memory_and_voice_and_emits_audit_rows():
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_SQL)
    now = _now()
    _insert_item(
        conn,
        item_id="doc-old",
        item_type="document",
        ingested_at=_iso(now - timedelta(days=999)),
        r2_key="demo/vault/process/doc-old.txt",
    )
    executor = _DualExecutor(conn)
    storage = _FakeStorage()
    audit = _FakeAuditWriter()
    voice_calls: list[dict] = []

    async def fake_voice_retention(*, voice_retention_days, now):  # noqa: ARG001 — protocol shape
        voice_calls.append({"voice_retention_days": voice_retention_days})
        return {"considered": 5, "deleted": 4, "errors": 1}

    policy = MemoryRetentionPolicy(
        documents_days=30,
        voice_samples_days=180,
    )

    result = _run(
        run_full_retention(
            customer_slug="demo-firm",
            policy=policy,
            memory_executor=executor,
            memory_storage=storage,
            voice_retention=fake_voice_retention,
            audit_writer=audit,
            now=now,
        )
    )

    assert result.memory.total_deleted == 1
    assert result.voice["deleted"] == 4
    assert result.total_deleted == 5
    assert result.total_errors == 1
    assert voice_calls == [{"voice_retention_days": 180}]

    # One audit row per pipeline.
    assert len(audit.events) == 2
    steps = {event.metadata["step"] for event in audit.events}
    assert steps == {"retention/memory", "retention/voice"}
    for event in audit.events:
        assert event.action_type == "DECOMMISSION_DRAIN_COMPLETE"
        assert event.metadata["customer_slug"] == "demo-firm"
