"""Tests for ai-employee/adapter/memory/state.py (issue #860).

Exercises the SourceStateStore against a sqlite-backed executor that mirrors
the schema from ai-employee/migrations/0003_memory_ingestion.sql.

Coverage:
  - schema upsert: first write inserts, second write updates
  - successful run preserves last_success_at; errored run clears it not
  - record_items writes one row per record with stable JSON shape
  - read_source_states returns rows ordered newest-first
  - decommission_source removes R2 + Vectorize and clears state row
  - access_scope validation rejects unknown scopes
  - item_type validation rejects unknown types

Run:

    cd ai-employee && python -m pytest adapter/tests/test_memory_state.py -v
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # ai-employee/ on sys.path

from adapter.memory.state import (  # noqa: E402
    INGEST_STATUS_ERROR,
    INGEST_STATUS_OK,
    IngestedItemRecord,
    IngestionStateUpdate,
    SourceStateStore,
    decommission_source,
    read_source_states,
)


_SCHEMA_SQL = """
CREATE TABLE memory_source_state (
  source_kind         TEXT NOT NULL,
  source_id           TEXT NOT NULL,
  last_ingestion_at   TEXT NOT NULL,
  last_success_at     TEXT,
  last_error          TEXT,
  ingest_status       TEXT NOT NULL,
  items_last_run      INTEGER NOT NULL DEFAULT 0,
  schema_version      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (source_kind, source_id)
);

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


class _SqliteExecutor:
    """Sqlite-backed dual executor satisfying WriteExecutor + QueryExecutor."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    async def execute(self, sql: str, params: list) -> None:
        self._conn.execute(sql, params)
        self._conn.commit()

    async def query(self, sql: str, params: list) -> list[dict]:
        cur = self._conn.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(":memory:")
    c.executescript(_SCHEMA_SQL)
    return c


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_ingestion_state_update_rejects_unknown_status():
    with pytest.raises(ValueError, match="not in"):
        IngestionStateUpdate(
            source_kind="practice_management",
            source_id="filevine",
            ingested_at="2026-05-21T12:00:00.000Z",
            status="bogus",
            items_last_run=0,
        )


def test_ingested_item_rejects_unknown_access_scope():
    with pytest.raises(ValueError, match="access_scope"):
        IngestedItemRecord(
            source_kind="practice_management",
            source_id="filevine",
            external_id="m-1",
            item_type="matter",
            access_scope="public-internet",  # invalid
        )


def test_ingested_item_rejects_unknown_item_type():
    with pytest.raises(ValueError, match="item_type"):
        IngestedItemRecord(
            source_kind="practice_management",
            source_id="filevine",
            external_id="m-1",
            item_type="invoice",  # not in matter|document|recipient
        )


# ---------------------------------------------------------------------------
# upsert_state behavior
# ---------------------------------------------------------------------------


def test_upsert_state_inserts_then_updates():
    conn = _conn()
    store = SourceStateStore(_SqliteExecutor(conn))
    _run(
        store.upsert_state(
            IngestionStateUpdate(
                source_kind="practice_management",
                source_id="filevine",
                ingested_at="2026-05-21T12:00:00.000Z",
                status=INGEST_STATUS_OK,
                items_last_run=4,
            )
        )
    )
    _run(
        store.upsert_state(
            IngestionStateUpdate(
                source_kind="practice_management",
                source_id="filevine",
                ingested_at="2026-05-21T13:00:00.000Z",
                status=INGEST_STATUS_ERROR,
                items_last_run=0,
                error="boom",
            )
        )
    )
    row = conn.execute(
        "SELECT last_ingestion_at, last_success_at, last_error, ingest_status, items_last_run "
        "FROM memory_source_state WHERE source_kind=? AND source_id=?",
        ("practice_management", "filevine"),
    ).fetchone()
    last_ing, last_succ, last_err, status, items_run = row
    # last_ingestion_at always advances
    assert last_ing == "2026-05-21T13:00:00.000Z"
    # last_success_at is preserved from the earlier OK run, not overwritten by the errored run
    assert last_succ == "2026-05-21T12:00:00.000Z"
    assert last_err == "boom"
    assert status == INGEST_STATUS_ERROR
    assert items_run == 0


def test_upsert_state_ok_sets_last_success_at():
    conn = _conn()
    store = SourceStateStore(_SqliteExecutor(conn))
    _run(
        store.upsert_state(
            IngestionStateUpdate(
                source_kind="practice_management",
                source_id="none",
                ingested_at="2026-05-21T15:00:00.000Z",
                status=INGEST_STATUS_OK,
                items_last_run=0,
            )
        )
    )
    row = conn.execute(
        "SELECT last_success_at FROM memory_source_state WHERE source_id=?", ("none",)
    ).fetchone()
    assert row[0] == "2026-05-21T15:00:00.000Z"


# ---------------------------------------------------------------------------
# record_items behavior
# ---------------------------------------------------------------------------


def test_record_items_writes_one_row_per_record_with_json():
    conn = _conn()
    store = SourceStateStore(_SqliteExecutor(conn))
    items = [
        IngestedItemRecord(
            source_kind="practice_management",
            source_id="filevine",
            external_id="m-1",
            item_type="matter",
            access_scope="partner-only",
            access_scope_detail={"partners": ["p-1", "p-2"]},
            r2_key="slug/vault/narrative/pm-filevine-matter-m-1.json",
            content_digest="d" * 64,
            metadata={"client_name": "Acme", "status": "open"},
        ),
        IngestedItemRecord(
            source_kind="practice_management",
            source_id="filevine",
            external_id="doc-9",
            item_type="document",
            r2_key="slug/vault/process/pm-filevine-doc-doc-9.txt",
            vectorize_chunk_ids=("c1", "c2", "c3"),
            content_digest="e" * 64,
            metadata={"filename": "intake.pdf", "chunk_count": 3},
        ),
    ]
    ulids = _run(store.record_items(items, ingested_at="2026-05-21T12:00:00.000Z"))
    assert len(ulids) == 2
    rows = conn.execute(
        "SELECT external_id, item_type, access_scope, access_scope_detail, vectorize_chunk_ids, metadata "
        "FROM memory_ingested_items ORDER BY external_id"
    ).fetchall()
    # row order: doc-9, m-1
    assert rows[0][0] == "doc-9"
    assert rows[0][1] == "document"
    assert rows[0][2] == "firm-wide"
    assert json.loads(rows[0][4]) == ["c1", "c2", "c3"]
    assert json.loads(rows[0][5])["chunk_count"] == 3
    assert rows[1][0] == "m-1"
    assert rows[1][1] == "matter"
    assert rows[1][2] == "partner-only"
    assert json.loads(rows[1][3])["partners"] == ["p-1", "p-2"]


# ---------------------------------------------------------------------------
# list_states / read_source_states
# ---------------------------------------------------------------------------


def test_read_source_states_returns_newest_first():
    conn = _conn()
    store = SourceStateStore(_SqliteExecutor(conn))
    _run(
        store.upsert_state(
            IngestionStateUpdate(
                source_kind="practice_management",
                source_id="filevine",
                ingested_at="2026-05-21T10:00:00.000Z",
                status=INGEST_STATUS_OK,
                items_last_run=3,
            )
        )
    )
    _run(
        store.upsert_state(
            IngestionStateUpdate(
                source_kind="practice_management",
                source_id="none",
                ingested_at="2026-05-21T11:00:00.000Z",
                status=INGEST_STATUS_OK,
                items_last_run=0,
            )
        )
    )
    states = _run(read_source_states(store))
    assert len(states) == 2
    # newest-first ordering
    assert states[0].source_id == "none"
    assert states[1].source_id == "filevine"
    assert states[0].ingest_status == INGEST_STATUS_OK
    assert states[1].items_last_run == 3


# ---------------------------------------------------------------------------
# Decommission
# ---------------------------------------------------------------------------


class _FakeStorageRemoval:
    def __init__(self) -> None:
        self.removed_keys: list[str] = []
        self.removed_vectors: list[list[str]] = []

    async def delete_r2_object(self, key: str) -> None:
        self.removed_keys.append(key)

    async def delete_vectorize_vectors(self, vector_ids: list) -> None:
        self.removed_vectors.append(list(vector_ids))


def test_decommission_source_removes_everything():
    conn = _conn()
    store = SourceStateStore(_SqliteExecutor(conn))
    items = [
        IngestedItemRecord(
            source_kind="practice_management",
            source_id="filevine",
            external_id="m-1",
            item_type="matter",
            r2_key="slug/vault/narrative/pm-filevine-matter-m-1.json",
        ),
        IngestedItemRecord(
            source_kind="practice_management",
            source_id="filevine",
            external_id="doc-9",
            item_type="document",
            r2_key="slug/vault/process/pm-filevine-doc-doc-9.txt",
            vectorize_chunk_ids=("c1", "c2"),
        ),
        IngestedItemRecord(
            source_kind="practice_management",
            source_id="filevine",
            external_id="r-3",
            item_type="recipient",
        ),
    ]
    _run(store.record_items(items, ingested_at="2026-05-21T12:00:00.000Z"))
    _run(
        store.upsert_state(
            IngestionStateUpdate(
                source_kind="practice_management",
                source_id="filevine",
                ingested_at="2026-05-21T12:00:00.000Z",
                status=INGEST_STATUS_OK,
                items_last_run=3,
            )
        )
    )

    storage = _FakeStorageRemoval()
    manifest = _run(
        decommission_source(
            store,
            storage,
            source_kind="practice_management",
            source_id="filevine",
        )
    )

    # All three items were enumerated; the matter + the document had R2 keys;
    # only the document had Vectorize vectors.
    assert manifest["items_removed"] == 3
    assert manifest["r2_objects_removed"] == 2
    assert manifest["vectorize_vectors_removed"] == 2

    # The state row is gone.
    rows = conn.execute(
        "SELECT * FROM memory_source_state WHERE source_id='filevine'"
    ).fetchall()
    assert rows == []

    # Items are soft-deleted (deleted_at populated, rows still present for audit).
    rows = conn.execute(
        "SELECT deleted_at FROM memory_ingested_items WHERE source_id='filevine'"
    ).fetchall()
    assert all(r[0] is not None for r in rows)


def test_decommission_with_no_persisted_items_is_safe():
    conn = _conn()
    store = SourceStateStore(_SqliteExecutor(conn))
    storage = _FakeStorageRemoval()
    manifest = _run(
        decommission_source(
            store,
            storage,
            source_kind="practice_management",
            source_id="none",
        )
    )
    assert manifest["items_removed"] == 0
    assert manifest["r2_objects_removed"] == 0
    assert manifest["vectorize_vectors_removed"] == 0
