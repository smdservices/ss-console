"""Tests for operator/adapter/memory/pipeline.py (issue #860).

Exercises the full MemoryIngestionRunner end-to-end against in-memory fakes
for the source adapter, storage client, embedding client, and state store.

Coverage:
  - successful scheduled run writes matters + documents + recipients
  - failed source raises through but is captured into INGEST_STATUS_ERROR;
    runner does not re-raise
  - "no PM system" fallback runs cleanly and produces a green state row
  - per-matter access_scope is propagated to memory_ingested_items
  - on-demand mode shares the entrypoint with scheduled
  - decommission removes everything the runner persisted (chunk vector IDs
    enumerated, R2 keys removed)
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
sys.path.insert(0, str(_HERE.parents[2]))

from adapter.memory.chunking import DocumentChunker  # noqa: E402
from adapter.memory.pipeline import (  # noqa: E402
    IngestedDocument,
    IngestedMatter,
    IngestedRecipient,
    IngestionMode,
    MemoryIngestionRunner,
    NoPracticeManagementSource,
    PracticeManagementSourceAdapter,
    SourceDescriptor,
    StorageError,
)
from adapter.memory.state import (  # noqa: E402
    INGEST_STATUS_ERROR,
    INGEST_STATUS_OK,
    SourceStateStore,
    decommission_source,
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


class _DualExecutor:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    async def execute(self, sql: str, params: list) -> None:
        self._conn.execute(sql, params)
        self._conn.commit()

    async def query(self, sql: str, params: list) -> list[dict]:
        cur = self._conn.execute(sql, params)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


class _FakeSource:
    def __init__(
        self,
        matters: list[IngestedMatter] | None = None,
        docs: dict[str, list[IngestedDocument]] | None = None,
        recipients: list[IngestedRecipient] | None = None,
        *,
        fail: bool = False,
    ) -> None:
        self._matters = matters or []
        self._docs = docs or {}
        self._recipients = recipients or []
        self._fail = fail

    async def list_matters(self) -> list[IngestedMatter]:
        if self._fail:
            raise RuntimeError("upstream PM API unavailable")
        return list(self._matters)

    async def list_matter_documents(
        self, matter_external_id: str
    ) -> list[IngestedDocument]:
        return list(self._docs.get(matter_external_id, []))

    async def list_recipients(self) -> list[IngestedRecipient]:
        return list(self._recipients)


class _FakeStorage:
    def __init__(self) -> None:
        self.r2_objects: dict[str, tuple[bytes, str]] = {}
        self.vector_calls: list[tuple[str, list[dict]]] = []
        self.r2_deletes: list[str] = []
        self.vector_deletes: list[list[str]] = []

    async def put_r2_object(self, key: str, body: bytes, *, content_type: str) -> None:
        self.r2_objects[key] = (body, content_type)

    async def upsert_vectors(self, index_name: str, vectors: list[dict]) -> None:
        self.vector_calls.append((index_name, vectors))

    async def delete_r2_object(self, key: str) -> None:
        self.r2_deletes.append(key)
        self.r2_objects.pop(key, None)

    async def delete_vectorize_vectors(self, vector_ids: list[str]) -> None:
        self.vector_deletes.append(list(vector_ids))


class _FakeEmbeddings:
    def __init__(self, dim: int = 4) -> None:
        self._dim = dim
        self.calls: list[list[str]] = []

    async def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(list(texts))
        # Deterministic, content-derived fake vector so the assertion is
        # cheap and reads obviously in test output.
        return [
            [float((hash(t) >> i) & 1) for i in range(self._dim)] for t in texts
        ]


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _build_runner(*, source: object, customer_slug: str = "demo-firm"):
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_SQL)
    store = SourceStateStore(_DualExecutor(conn))
    storage = _FakeStorage()
    embeds = _FakeEmbeddings()
    runner = MemoryIngestionRunner(
        customer_slug=customer_slug,
        source_adapter=PracticeManagementSourceAdapter(source),
        storage=storage,
        embeddings=embeds,
        chunker=DocumentChunker(target_chars=400, overlap_chars=50),
        state_store=store,
        clock=lambda: datetime(2026, 5, 21, 12, 0, 0, tzinfo=timezone.utc),
    )
    return runner, conn, store, storage, embeds


# ---------------------------------------------------------------------------
# Success path
# ---------------------------------------------------------------------------


def test_scheduled_run_persists_matters_documents_and_recipients():
    matters = [
        IngestedMatter(
            external_id="m-1",
            client_name="Acme Inc",
            matter_type="contract",
            status="open",
            access_scope="firm-wide",
            custom_fields={"jurisdiction": "AZ"},
        ),
        IngestedMatter(
            external_id="m-2",
            client_name="Beta LLC",
            matter_type="employment",
            status="open",
            access_scope="partner-only",
            access_scope_detail={"partners": ["p-7"]},
        ),
    ]
    docs = {
        "m-1": [
            IngestedDocument(
                external_id="doc-1",
                matter_external_id="m-1",
                filename="contract-draft.txt",
                mime_type="text/plain",
                body_text="Paragraph one of the contract.\n\nParagraph two follows.",
            )
        ],
        "m-2": [],
    }
    recipients = [
        IngestedRecipient(
            external_id="r-1",
            name="Jane Counsel",
            role="opposing_counsel",
            email="jane@opp.example",
            matter_external_ids=("m-1",),
        )
    ]
    runner, conn, store, storage, embeds = _build_runner(
        source=_FakeSource(matters, docs, recipients)
    )

    result = _run(
        runner.run_ingestion(
            SourceDescriptor(source_kind="practice_management", source_id="filevine"),
            IngestionMode.SCHEDULED,
        )
    )

    assert result.ok is True
    assert result.matters_seen == 2
    assert result.documents_seen == 1
    assert result.recipients_seen == 1
    # 2 matters + 1 document + 1 recipient = 4
    assert result.items_ingested == 4

    # State row is green and matches the clock.
    row = conn.execute(
        "SELECT ingest_status, last_ingestion_at, last_error, items_last_run FROM memory_source_state"
    ).fetchone()
    assert row[0] == INGEST_STATUS_OK
    assert row[1] == "2026-05-21T12:00:00.000Z"
    assert row[2] is None
    assert row[3] == 4

    # R2 received the matter narrative + the document body.
    assert "demo-firm/vault/narrative/pm-filevine-matter-m-1.json" in storage.r2_objects
    assert "demo-firm/vault/narrative/pm-filevine-matter-m-2.json" in storage.r2_objects
    assert "demo-firm/vault/process/pm-filevine-doc-doc-1.txt" in storage.r2_objects

    # The document was chunked and embedded.
    assert embeds.calls, "embedding client must be called for documents"
    assert storage.vector_calls, "vectorize must receive upsert calls"
    index_name, vectors = storage.vector_calls[0]
    assert index_name == "hermes-demo-firm-vault"
    assert len(vectors) >= 1
    assert vectors[0]["metadata"]["customer_slug"] == "demo-firm"
    assert vectors[0]["metadata"]["matter_external_id"] == "m-1"

    # Per-matter access_scope is propagated.
    rows = conn.execute(
        "SELECT external_id, access_scope, access_scope_detail FROM memory_ingested_items WHERE item_type='matter' ORDER BY external_id"
    ).fetchall()
    assert rows[0][0] == "m-1"
    assert rows[0][1] == "firm-wide"
    assert rows[1][0] == "m-2"
    assert rows[1][1] == "partner-only"
    assert json.loads(rows[1][2])["partners"] == ["p-7"]


def test_on_demand_mode_uses_same_entrypoint():
    runner, conn, *_ = _build_runner(source=_FakeSource())
    result = _run(
        runner.run_ingestion(
            SourceDescriptor(source_kind="practice_management", source_id="none"),
            IngestionMode.ON_DEMAND,
        )
    )
    assert result.ok is True
    assert result.mode == IngestionMode.ON_DEMAND


# ---------------------------------------------------------------------------
# No-PM-system fallback
# ---------------------------------------------------------------------------


def test_no_pm_system_fallback_produces_green_state():
    runner, conn, *_ = _build_runner(source=NoPracticeManagementSource())
    result = _run(
        runner.run_ingestion(
            SourceDescriptor(source_kind="practice_management", source_id="none"),
            IngestionMode.SCHEDULED,
        )
    )
    assert result.ok is True
    assert result.items_ingested == 0
    row = conn.execute(
        "SELECT ingest_status, last_ingestion_at FROM memory_source_state"
    ).fetchone()
    assert row[0] == INGEST_STATUS_OK
    assert row[1] == "2026-05-21T12:00:00.000Z"


# ---------------------------------------------------------------------------
# Failure handling
# ---------------------------------------------------------------------------


def test_source_failure_writes_error_state_but_does_not_raise():
    runner, conn, *_ = _build_runner(source=_FakeSource(fail=True))
    result = _run(
        runner.run_ingestion(
            SourceDescriptor(source_kind="practice_management", source_id="filevine"),
            IngestionMode.SCHEDULED,
        )
    )
    assert result.ok is False
    assert "upstream PM API unavailable" in (result.error or "")
    row = conn.execute(
        "SELECT ingest_status, last_error, items_last_run, last_success_at FROM memory_source_state"
    ).fetchone()
    assert row[0] == INGEST_STATUS_ERROR
    assert "upstream PM API unavailable" in row[1]
    assert row[2] == 0
    # No prior success means last_success_at stays null.
    assert row[3] is None


def test_subsequent_success_keeps_prior_success_at_when_errored():
    """A success then a failure must NOT clobber last_success_at."""
    runner, conn, *_ = _build_runner(source=_FakeSource())
    _run(
        runner.run_ingestion(
            SourceDescriptor(source_kind="practice_management", source_id="none"),
            IngestionMode.SCHEDULED,
        )
    )
    # Now swap in a failing source on the same runner store.
    runner._source = PracticeManagementSourceAdapter(_FakeSource(fail=True))  # noqa: SLF001
    _run(
        runner.run_ingestion(
            SourceDescriptor(source_kind="practice_management", source_id="none"),
            IngestionMode.SCHEDULED,
        )
    )
    row = conn.execute(
        "SELECT ingest_status, last_success_at FROM memory_source_state"
    ).fetchone()
    assert row[0] == INGEST_STATUS_ERROR
    # last_success_at preserved across the failure — agent reads cached.
    assert row[1] == "2026-05-21T12:00:00.000Z"


# ---------------------------------------------------------------------------
# Decommission removes everything the runner persisted
# ---------------------------------------------------------------------------


def test_decommission_removes_runner_artifacts():
    matters = [
        IngestedMatter(
            external_id="m-99",
            client_name="X",
            matter_type="contract",
            status="open",
        )
    ]
    docs = {
        "m-99": [
            IngestedDocument(
                external_id="doc-99",
                matter_external_id="m-99",
                filename="doc.txt",
                mime_type="text/plain",
                body_text="Para one.\n\nPara two.\n\nPara three.",
            )
        ]
    }
    runner, conn, store, storage, _ = _build_runner(source=_FakeSource(matters, docs))
    result = _run(
        runner.run_ingestion(
            SourceDescriptor(source_kind="practice_management", source_id="filevine"),
            IngestionMode.SCHEDULED,
        )
    )
    assert result.ok

    manifest = _run(
        decommission_source(
            store,
            storage,
            source_kind="practice_management",
            source_id="filevine",
        )
    )
    # Both R2 objects (matter narrative + document body) are removed.
    assert manifest["r2_objects_removed"] == 2
    assert manifest["vectorize_vectors_removed"] >= 1
    # And the state row is gone.
    rows = conn.execute("SELECT * FROM memory_source_state").fetchall()
    assert rows == []


# ---------------------------------------------------------------------------
# Customer-slug invariants
# ---------------------------------------------------------------------------


def test_empty_customer_slug_rejected():
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_SQL)
    store = SourceStateStore(_DualExecutor(conn))
    with pytest.raises(ValueError, match="customer_slug"):
        MemoryIngestionRunner(
            customer_slug="",
            source_adapter=PracticeManagementSourceAdapter(NoPracticeManagementSource()),
            storage=_FakeStorage(),
            embeddings=_FakeEmbeddings(),
            chunker=DocumentChunker(),
            state_store=store,
        )


def test_r2_key_uses_customer_slug_prefix():
    matters = [
        IngestedMatter(
            external_id="m-1", client_name="X", matter_type="contract", status="open"
        )
    ]
    runner, conn, _, storage, _ = _build_runner(
        source=_FakeSource(matters), customer_slug="acme-firm"
    )
    _run(
        runner.run_ingestion(
            SourceDescriptor(source_kind="practice_management", source_id="filevine"),
            IngestionMode.SCHEDULED,
        )
    )
    # Every R2 key must start with the customer slug per r2-vectorize-naming.md.
    for key in storage.r2_objects:
        assert key.startswith("acme-firm/"), key
