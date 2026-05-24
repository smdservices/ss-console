"""Tests for the namespace-assertion adoption factories (#861 follow-on).

Covers three in-tree migration entry points:

* `adapter.d1_env.namespaced_executor_from_env` — builds a
  `NamespacedD1Executor` from the per-customer env, with the audit
  writer wired in.
* `adapter.memory.build_namespaced_memory_runner` — returns a
  `MemoryIngestionRunner` whose `StorageClient` routes every R2 put +
  Vectorize upsert through the namespace assertion before reaching the
  raw client.
* `adapter.voice.build_namespaced_voice_runner` — returns a
  `VoiceIngestionRunner` whose `R2Client` routes every put + delete
  through the namespace assertion.

The headline test for each factory: a runner built with slug A is
asked to do an operation that names slug B; the call refuses with
`NamespaceAssertionError` AND emits an `INVARIANT_VIOLATION` audit
row. This is the same shape as the wrapper-level integration test in
`test_namespace_assertion.py`, lifted to the runner boundary.

Run from repo root:

    cd ai-employee && python -m pytest adapter/tests/test_namespace_adoption.py -v
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # ai-employee/ on sys.path

from adapter import namespaced_executor_from_env  # noqa: E402
from adapter.audit_log import (  # noqa: E402
    AuditLogWriter,
    SqliteExecutor,
)
from adapter.memory import (  # noqa: E402
    DocumentChunker,
    IngestionMode,
    NoPracticeManagementSource,
    PracticeManagementSourceAdapter,
    SourceDescriptor,
    SourceStateStore,
    build_namespaced_memory_runner,
)
from adapter.namespace_assertion import (  # noqa: E402
    NamespaceAssertionError,
    NamespacedD1Executor,
)


# ---------------------------------------------------------------------------
# Audit-log writer fixture
# ---------------------------------------------------------------------------


_SCHEMA_SQL = """
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


_MEMORY_STATE_SCHEMA_SQL = """
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


def _make_audit_writer() -> tuple[AuditLogWriter, sqlite3.Connection]:
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_SQL)
    return AuditLogWriter(SqliteExecutor(conn)), conn


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# Fakes for raw R2 / Vectorize that match the namespace wrapper's Protocols
# ---------------------------------------------------------------------------


class _FakeRawR2:
    def __init__(self) -> None:
        self.put_calls: list[tuple[str, bytes, str]] = []
        self.delete_calls: list[str] = []
        self.objects: dict[str, bytes] = {}

    async def put_object(self, key: str, body: bytes, *, content_type: str) -> None:
        self.put_calls.append((key, body, content_type))
        self.objects[key] = body

    async def get_object(self, key: str) -> bytes:
        return self.objects.get(key, b"")

    async def delete_object(self, key: str) -> None:
        self.delete_calls.append(key)
        self.objects.pop(key, None)


class _FakeRawVectorize:
    def __init__(self) -> None:
        self.upserts: list[tuple[str, list[dict]]] = []

    async def upsert_vectors(self, index_name: str, vectors: list[dict]) -> None:
        self.upserts.append((index_name, vectors))

    async def query_vectors(
        self, index_name: str, vector: list[float], *, top_k: int
    ):
        return []

    async def delete_vectors(self, index_name: str, ids: list[str]) -> None:
        pass


class _FakeEmbeddings:
    async def embed(self, texts: list[str]) -> list[list[float]]:
        return [[float(len(t))] for t in texts]


# ---------------------------------------------------------------------------
# `namespaced_executor_from_env` — D1 wiring
# ---------------------------------------------------------------------------


def test_namespaced_executor_from_env_requires_customer_slug(monkeypatch):
    # Unset both the slug AND the D1 env vars so the slug check fires first
    monkeypatch.delenv("CUSTOMER_SLUG", raising=False)
    monkeypatch.setenv("CF_ACCOUNT_ID", "acct")
    monkeypatch.setenv("CF_API_TOKEN", "tok")
    monkeypatch.setenv("AIE_D1_DATABASE_ID", "db")

    with pytest.raises(RuntimeError, match="CUSTOMER_SLUG"):
        namespaced_executor_from_env()


def test_namespaced_executor_from_env_requires_d1_env_vars(monkeypatch):
    monkeypatch.setenv("CUSTOMER_SLUG", "acme")
    monkeypatch.delenv("CF_ACCOUNT_ID", raising=False)
    monkeypatch.setenv("CF_API_TOKEN", "tok")
    monkeypatch.setenv("AIE_D1_DATABASE_ID", "db")

    # writer_from_env (called for the default audit writer) fails first
    # because it scans the same env. Either error path is acceptable.
    with pytest.raises(RuntimeError, match="CF_ACCOUNT_ID"):
        namespaced_executor_from_env()


def test_namespaced_executor_from_env_returns_slug_bound_wrapper(monkeypatch):
    monkeypatch.setenv("CUSTOMER_SLUG", "acme")
    monkeypatch.setenv("CF_ACCOUNT_ID", "acct")
    monkeypatch.setenv("CF_API_TOKEN", "tok")
    monkeypatch.setenv("AIE_D1_DATABASE_ID", "db")

    writer, _ = _make_audit_writer()
    executor = namespaced_executor_from_env(audit_writer=writer)

    assert isinstance(executor, NamespacedD1Executor)
    # Bound slug is read back via a refusal probe — exercising a foreign
    # token returns a NamespaceAssertionError whose expected_slug is "acme".
    with pytest.raises(NamespaceAssertionError) as excinfo:
        _run(executor.execute("INSERT INTO x (key) VALUES ('hermes-other-vault')", []))
    assert excinfo.value.expected_slug == "acme"


def test_namespaced_executor_from_env_accepts_explicit_slug(monkeypatch):
    monkeypatch.setenv("CF_ACCOUNT_ID", "acct")
    monkeypatch.setenv("CF_API_TOKEN", "tok")
    monkeypatch.setenv("AIE_D1_DATABASE_ID", "db")
    monkeypatch.delenv("CUSTOMER_SLUG", raising=False)

    writer, _ = _make_audit_writer()
    executor = namespaced_executor_from_env("operator-slug", audit_writer=writer)

    assert isinstance(executor, NamespacedD1Executor)
    with pytest.raises(NamespaceAssertionError) as excinfo:
        _run(executor.execute("SELECT 'hermes-other-vault'", []))
    assert excinfo.value.expected_slug == "operator-slug"


# ---------------------------------------------------------------------------
# `build_namespaced_memory_runner` — memory pipeline adoption
# ---------------------------------------------------------------------------


def _make_state_store() -> tuple[SourceStateStore, sqlite3.Connection]:
    conn = sqlite3.connect(":memory:")
    conn.executescript(_MEMORY_STATE_SCHEMA_SQL)

    # The memory state store needs a dual executor (writes via execute,
    # reads via query). The pattern is the same as test_memory_pipeline.py.
    class _DualExecutor:
        def __init__(self, c):
            self._c = c

        async def execute(self, sql: str, params: list) -> None:
            self._c.execute(sql, params)
            self._c.commit()

        async def query(self, sql: str, params: list) -> list[dict]:
            cur = self._c.execute(sql, params)
            cols = [d[0] for d in cur.description] if cur.description else []
            return [dict(zip(cols, row)) for row in cur.fetchall()]

    return SourceStateStore(_DualExecutor(conn)), conn


def test_build_namespaced_memory_runner_refuses_foreign_r2_key_at_runtime():
    """A runner built for slug 'acme' is given a raw R2 that would happily
    accept anything; the wrapper inserted by the factory refuses any key
    that doesn't match the acme slug AND lands an INVARIANT_VIOLATION row.

    The pipeline writes to `{slug}/vault/...`. We construct the runner
    with `customer_slug="acme"` but then poison the wrapper's bound slug
    indirectly: we tell the runner its slug is "acme" but then call the
    underlying storage method directly with a foreign-slug key, which is
    what would happen if a buggy code path constructed the wrong key.
    """
    writer, audit_conn = _make_audit_writer()
    state_store, _state_conn = _make_state_store()
    raw_r2 = _FakeRawR2()
    raw_vec = _FakeRawVectorize()

    runner = build_namespaced_memory_runner(
        customer_slug="acme",
        source_adapter=PracticeManagementSourceAdapter(NoPracticeManagementSource()),
        raw_r2=raw_r2,
        raw_vectorize=raw_vec,
        embeddings=_FakeEmbeddings(),
        chunker=DocumentChunker(target_chars=200, overlap_chars=20),
        state_store=state_store,
        audit_writer=writer,
    )

    # Reach the bridge (the runner's `storage`) and call it directly with
    # a foreign key. The bridge delegates to the namespace wrapper, so
    # this is exactly what the pipeline does at write time — minus the
    # full ingestion flow that this minimal test does not need to exercise.
    bridge = runner._storage  # noqa: SLF001 — intentional white-box probe
    with pytest.raises(NamespaceAssertionError) as excinfo:
        _run(bridge.put_r2_object("vaults/other/leak.json", b"x", content_type="application/json"))
    assert excinfo.value.expected_slug == "acme"
    assert raw_r2.put_calls == []

    rows = audit_conn.execute(
        "SELECT action_type, metadata FROM audit_log"
    ).fetchall()
    assert len(rows) == 1
    assert rows[0][0] == "INVARIANT_VIOLATION"
    meta = json.loads(rows[0][1])
    assert meta["invariant"] == "namespace_isolation"
    assert meta["violation_kind"] == "r2_key"
    assert meta["expected_slug"] == "acme"


def test_build_namespaced_memory_runner_refuses_foreign_vectorize_index():
    writer, audit_conn = _make_audit_writer()
    state_store, _state_conn = _make_state_store()
    raw_r2 = _FakeRawR2()
    raw_vec = _FakeRawVectorize()

    runner = build_namespaced_memory_runner(
        customer_slug="acme",
        source_adapter=PracticeManagementSourceAdapter(NoPracticeManagementSource()),
        raw_r2=raw_r2,
        raw_vectorize=raw_vec,
        embeddings=_FakeEmbeddings(),
        chunker=DocumentChunker(target_chars=200, overlap_chars=20),
        state_store=state_store,
        audit_writer=writer,
    )

    bridge = runner._storage  # noqa: SLF001
    with pytest.raises(NamespaceAssertionError) as excinfo:
        _run(bridge.upsert_vectors("hermes-other-vault", []))
    assert excinfo.value.expected_slug == "acme"
    assert raw_vec.upserts == []

    rows = audit_conn.execute(
        "SELECT action_type, metadata FROM audit_log"
    ).fetchall()
    assert len(rows) == 1
    meta = json.loads(rows[0][1])
    assert meta["violation_kind"] == "vectorize_index"


def test_build_namespaced_memory_runner_passes_through_own_namespace():
    writer, _audit_conn = _make_audit_writer()
    state_store, _state_conn = _make_state_store()
    raw_r2 = _FakeRawR2()
    raw_vec = _FakeRawVectorize()

    runner = build_namespaced_memory_runner(
        customer_slug="acme",
        source_adapter=PracticeManagementSourceAdapter(NoPracticeManagementSource()),
        raw_r2=raw_r2,
        raw_vectorize=raw_vec,
        embeddings=_FakeEmbeddings(),
        chunker=DocumentChunker(target_chars=200, overlap_chars=20),
        state_store=state_store,
        audit_writer=writer,
    )

    bridge = runner._storage  # noqa: SLF001
    _run(bridge.put_r2_object("acme/vault/narrative/foo.json", b"x", content_type="application/json"))
    _run(bridge.upsert_vectors("hermes-acme-vault", [{"id": "v-1", "values": [0.1]}]))

    assert raw_r2.put_calls == [
        ("acme/vault/narrative/foo.json", b"x", "application/json")
    ]
    assert raw_vec.upserts == [("hermes-acme-vault", [{"id": "v-1", "values": [0.1]}])]


def test_build_namespaced_memory_runner_no_op_ingestion_still_works():
    """End-to-end smoke: a runner with the no-PM source completes one run
    cleanly through the wrapped storage path. Nothing touches storage
    (no matters/documents/recipients), so the run is a pure state-write —
    the test confirms the factory's wiring doesn't break the happy path.
    """
    writer, _ = _make_audit_writer()
    state_store, _state_conn = _make_state_store()

    runner = build_namespaced_memory_runner(
        customer_slug="acme",
        source_adapter=PracticeManagementSourceAdapter(NoPracticeManagementSource()),
        raw_r2=_FakeRawR2(),
        raw_vectorize=_FakeRawVectorize(),
        embeddings=_FakeEmbeddings(),
        chunker=DocumentChunker(target_chars=200, overlap_chars=20),
        state_store=state_store,
        audit_writer=writer,
    )

    result = _run(
        runner.run_ingestion(
            SourceDescriptor(source_kind="practice_management", source_id="none"),
            IngestionMode.SCHEDULED,
        )
    )
    assert result.ok is True
    assert result.items_ingested == 0


# ---------------------------------------------------------------------------
# `build_namespaced_voice_runner` — voice pipeline adoption
# ---------------------------------------------------------------------------


def test_build_namespaced_voice_runner_refuses_foreign_r2_key_at_runtime():
    """Same shape as the memory test: the bridge inserted by the voice
    factory refuses a foreign-slug R2 key at the wrapper boundary and
    audits the violation.
    """
    from adapter.voice import (
        NoEmailSource,
        StaticCohortResolver,
        build_namespaced_voice_runner,
    )

    writer, audit_conn = _make_audit_writer()
    raw_r2 = _FakeRawR2()

    # The voice pipeline needs an AuditDigestLookup; we stub it.
    class _StubAuditLookup:
        async def has_digest(self, _digest: str) -> bool:
            return False

    # The state store + cursor store are protocols; pass trivial stubs.
    class _StubStateStore:
        async def upsert_state(self, _update): pass
        async def record_items(self, _items, *, ingested_at): return []

    class _StubCursor:
        async def get(self): return None
        async def set(self, _c): pass

    runner = build_namespaced_voice_runner(
        customer_slug="acme",
        source=NoEmailSource(),
        cohort_resolver=StaticCohortResolver(),
        raw_r2=raw_r2,
        state_store=_StubStateStore(),  # type: ignore[arg-type]
        cursor_store=_StubCursor(),  # type: ignore[arg-type]
        audit_lookup=_StubAuditLookup(),  # type: ignore[arg-type]
        audit_writer=writer,
    )

    bridge = runner.r2_client  # bridge implements the voice R2Client protocol
    assert bridge.customer_slug == "acme"
    with pytest.raises(NamespaceAssertionError) as excinfo:
        _run(bridge.put("vaults/other/leak.json", b"x", "application/json"))
    assert excinfo.value.expected_slug == "acme"
    assert raw_r2.put_calls == []

    rows = audit_conn.execute(
        "SELECT action_type, metadata FROM audit_log"
    ).fetchall()
    assert len(rows) == 1
    meta = json.loads(rows[0][1])
    assert meta["violation_kind"] == "r2_key"


def test_build_namespaced_voice_runner_passes_through_own_namespace():
    from adapter.voice import (
        NoEmailSource,
        StaticCohortResolver,
        build_namespaced_voice_runner,
    )

    writer, _ = _make_audit_writer()
    raw_r2 = _FakeRawR2()

    class _StubAuditLookup:
        async def has_digest(self, _digest: str) -> bool:
            return False

    class _StubStateStore:
        async def upsert_state(self, _update): pass
        async def record_items(self, _items, *, ingested_at): return []

    class _StubCursor:
        async def get(self): return None
        async def set(self, _c): pass

    runner = build_namespaced_voice_runner(
        customer_slug="acme",
        source=NoEmailSource(),
        cohort_resolver=StaticCohortResolver(),
        raw_r2=raw_r2,
        state_store=_StubStateStore(),  # type: ignore[arg-type]
        cursor_store=_StubCursor(),  # type: ignore[arg-type]
        audit_lookup=_StubAuditLookup(),  # type: ignore[arg-type]
        audit_writer=writer,
    )

    bridge = runner.r2_client
    _run(bridge.put("acme/voice/cohort/x/abc.json", b"x", "application/json"))
    _run(bridge.delete("acme/voice/cohort/x/abc.json"))

    assert raw_r2.put_calls == [("acme/voice/cohort/x/abc.json", b"x", "application/json")]
    assert raw_r2.delete_calls == ["acme/voice/cohort/x/abc.json"]
