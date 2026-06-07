"""Per-source ingestion state — D1 reads and writes.

The dashboard reads ``memory_source_state`` to render the
``last-ingestion-at`` health indicator per source (AC: Captain dashboard
shows last-ingestion-at per source).

The pipeline upserts on every run regardless of outcome so that even a
failure produces a fresh row the dashboard can light up red. Reads never
block on ingestion failure — skill code consults the cached
``memory_ingested_items`` rows when ``ingest_status`` is ``"stale"`` or
``"error"`` (AC: failure handling — stale data flagged, agent operates on
cached).

Decommission (ADR 0008) walks ``memory_ingested_items`` and removes every
artifact the pipeline persisted, then deletes the state rows.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Optional, Protocol, Sequence

log = logging.getLogger("aie.memory.state")


# Ingestion status vocabulary. The dashboard maps these onto health colors.
INGEST_STATUS_OK = "ok"
INGEST_STATUS_STALE = "stale"
INGEST_STATUS_ERROR = "error"
INGEST_STATUS_NEVER_RUN = "never_run"

VALID_STATUSES = frozenset(
    {INGEST_STATUS_OK, INGEST_STATUS_STALE, INGEST_STATUS_ERROR, INGEST_STATUS_NEVER_RUN}
)

VALID_ACCESS_SCOPES = frozenset({"firm-wide", "partner-only", "attorney-list"})


def _iso_utc(now: Optional[datetime] = None) -> str:
    dt = now if now is not None else datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _ulid(now_ms: Optional[int] = None) -> str:
    """Return a 26-char ULID. Local re-implementation to avoid coupling to
    audit_log internals — see audit_log._ulid for the canonical spec."""
    import secrets

    crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

    def _encode(value: int, length: int) -> str:
        out = []
        for _ in range(length):
            value, rem = divmod(value, 32)
            out.append(crockford[rem])
        return "".join(reversed(out))

    ts = now_ms if now_ms is not None else int(time.time() * 1000)
    rand = secrets.randbits(80)
    return _encode(ts, 10) + _encode(rand, 16)


# ---------------------------------------------------------------------------
# Read model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MemorySourceState:
    """Dashboard read model for one (source_kind, source_id) pair.

    The Captain dashboard renders a row per source, lighting up green when
    ``ingest_status == "ok"`` and the last run was within the freshness
    threshold; yellow on ``"stale"``; red on ``"error"``.
    """

    source_kind: str
    source_id: str
    last_ingestion_at: str
    last_success_at: Optional[str]
    last_error: Optional[str]
    ingest_status: str
    items_last_run: int
    schema_version: int


# ---------------------------------------------------------------------------
# Executor protocols
# ---------------------------------------------------------------------------


class WriteExecutor(Protocol):
    """A write executor matches the shape of ``audit_log.Executor``."""

    async def execute(self, sql: str, params: list) -> None: ...


class QueryExecutor(Protocol):
    """A query executor returns rows for SELECT statements.

    Production wires this to the Cloudflare D1 HTTP API's ``query`` endpoint
    in result mode; tests pass a sqlite-backed executor that returns
    ``list[dict[str, object]]``.
    """

    async def query(self, sql: str, params: list) -> list[dict]: ...


# ---------------------------------------------------------------------------
# Source state store
# ---------------------------------------------------------------------------


_UPSERT_STATE_SQL = (
    "INSERT INTO memory_source_state "
    "(source_kind, source_id, last_ingestion_at, last_success_at, last_error, "
    "ingest_status, items_last_run, schema_version) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?) "
    "ON CONFLICT(source_kind, source_id) DO UPDATE SET "
    "last_ingestion_at = excluded.last_ingestion_at, "
    "last_success_at   = COALESCE(excluded.last_success_at, memory_source_state.last_success_at), "
    "last_error        = excluded.last_error, "
    "ingest_status     = excluded.ingest_status, "
    "items_last_run    = excluded.items_last_run, "
    "schema_version    = excluded.schema_version"
)


_INSERT_ITEM_SQL = (
    "INSERT INTO memory_ingested_items "
    "(id, source_kind, source_id, external_id, item_type, ingested_at, "
    "access_scope, access_scope_detail, r2_key, vectorize_chunk_ids, "
    "content_digest, metadata) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)


_SELECT_STATES_SQL = (
    "SELECT source_kind, source_id, last_ingestion_at, last_success_at, "
    "last_error, ingest_status, items_last_run, schema_version "
    "FROM memory_source_state "
    "ORDER BY last_ingestion_at DESC"
)


_SELECT_ITEMS_FOR_DECOMMISSION_SQL = (
    "SELECT id, r2_key, vectorize_chunk_ids "
    "FROM memory_ingested_items "
    "WHERE source_kind = ? AND source_id = ? AND deleted_at IS NULL"
)


_MARK_ITEMS_DELETED_SQL = (
    "UPDATE memory_ingested_items "
    "SET deleted_at = ? "
    "WHERE source_kind = ? AND source_id = ? AND deleted_at IS NULL"
)


_DELETE_STATE_SQL = (
    "DELETE FROM memory_source_state WHERE source_kind = ? AND source_id = ?"
)


@dataclass
class IngestionStateUpdate:
    """One ingestion-run outcome destined for memory_source_state."""

    source_kind: str
    source_id: str
    ingested_at: str
    status: str
    items_last_run: int
    error: Optional[str] = None

    def __post_init__(self) -> None:
        if self.status not in VALID_STATUSES:
            raise ValueError(
                f"ingest_status {self.status!r} not in {sorted(VALID_STATUSES)}"
            )


@dataclass
class IngestedItemRecord:
    """One provenance row destined for memory_ingested_items.

    ``access_scope`` is propagated from the connector's per-matter ACL
    (AC: privacy — respects per-matter access controls). The pipeline
    never decides ACLs; it copies them forward so the retrieval layer can
    enforce them.
    """

    source_kind: str
    source_id: str
    external_id: str
    item_type: str
    access_scope: str = "firm-wide"
    access_scope_detail: Optional[dict] = None
    r2_key: Optional[str] = None
    vectorize_chunk_ids: Optional[Sequence[str]] = None
    content_digest: Optional[str] = None
    metadata: Optional[dict] = None

    def __post_init__(self) -> None:
        if self.access_scope not in VALID_ACCESS_SCOPES:
            raise ValueError(
                f"access_scope {self.access_scope!r} not in {sorted(VALID_ACCESS_SCOPES)}"
            )
        if self.item_type not in {"matter", "document", "recipient"}:
            raise ValueError(
                f"item_type {self.item_type!r} not one of matter|document|recipient"
            )


class SourceStateStore:
    """D1-backed store for memory_source_state + memory_ingested_items rows.

    Construction takes a single executor that satisfies both
    :class:`WriteExecutor` and :class:`QueryExecutor`. The production
    Cloudflare D1 HTTP executor implements both; the sqlite test executor
    does as well.
    """

    def __init__(self, executor: object) -> None:
        # We accept any object that satisfies the runtime calls. Static
        # callers should pass a single object that has both ``execute`` and
        # ``query`` methods. See tests/test_memory_state.py for the sqlite
        # implementation used in tests.
        self._executor = executor

    async def upsert_state(self, update: IngestionStateUpdate) -> None:
        await self._executor.execute(  # type: ignore[attr-defined]
            _UPSERT_STATE_SQL,
            [
                update.source_kind,
                update.source_id,
                update.ingested_at,
                update.ingested_at if update.status == INGEST_STATUS_OK else None,
                update.error,
                update.status,
                update.items_last_run,
                1,
            ],
        )

    async def record_items(
        self, items: Iterable[IngestedItemRecord], ingested_at: Optional[str] = None
    ) -> list[str]:
        ts = ingested_at if ingested_at is not None else _iso_utc()
        ulids: list[str] = []
        for item in items:
            ulid = _ulid()
            ulids.append(ulid)
            await self._executor.execute(  # type: ignore[attr-defined]
                _INSERT_ITEM_SQL,
                [
                    ulid,
                    item.source_kind,
                    item.source_id,
                    item.external_id,
                    item.item_type,
                    ts,
                    item.access_scope,
                    json.dumps(item.access_scope_detail, sort_keys=True, separators=(",", ":"))
                    if item.access_scope_detail
                    else None,
                    item.r2_key,
                    json.dumps(list(item.vectorize_chunk_ids), separators=(",", ":"))
                    if item.vectorize_chunk_ids
                    else None,
                    item.content_digest,
                    json.dumps(item.metadata, sort_keys=True, separators=(",", ":"))
                    if item.metadata
                    else None,
                ],
            )
        return ulids

    async def list_states(self) -> list[MemorySourceState]:
        rows = await self._executor.query(_SELECT_STATES_SQL, [])  # type: ignore[attr-defined]
        out: list[MemorySourceState] = []
        for r in rows:
            out.append(
                MemorySourceState(
                    source_kind=r["source_kind"],
                    source_id=r["source_id"],
                    last_ingestion_at=r["last_ingestion_at"],
                    last_success_at=r["last_success_at"],
                    last_error=r["last_error"],
                    ingest_status=r["ingest_status"],
                    items_last_run=int(r["items_last_run"] or 0),
                    schema_version=int(r["schema_version"] or 1),
                )
            )
        return out

    async def list_items_for_decommission(
        self, source_kind: str, source_id: str
    ) -> list[dict]:
        return await self._executor.query(  # type: ignore[attr-defined]
            _SELECT_ITEMS_FOR_DECOMMISSION_SQL, [source_kind, source_id]
        )

    async def mark_items_deleted(self, source_kind: str, source_id: str) -> None:
        await self._executor.execute(  # type: ignore[attr-defined]
            _MARK_ITEMS_DELETED_SQL,
            [_iso_utc(), source_kind, source_id],
        )

    async def delete_state(self, source_kind: str, source_id: str) -> None:
        await self._executor.execute(  # type: ignore[attr-defined]
            _DELETE_STATE_SQL, [source_kind, source_id]
        )


# ---------------------------------------------------------------------------
# Dashboard read helper
# ---------------------------------------------------------------------------


async def read_source_states(store: SourceStateStore) -> list[MemorySourceState]:
    """Public read entrypoint for the Captain dashboard query.

    The dashboard endpoint is filed separately; this function is the
    contract the endpoint will call. Filed alongside the table writes so
    one reviewer sees both halves of the surface.
    """
    return await store.list_states()


# ---------------------------------------------------------------------------
# Decommission hook
# ---------------------------------------------------------------------------


class StorageRemovalClient(Protocol):
    """Removes an R2 object by key.

    Production wires this to the per-customer R2 bucket. Tests pass a
    fake that records the calls so assertions can verify every persisted
    key was removed.
    """

    async def delete_r2_object(self, key: str) -> None: ...

    async def delete_vectorize_vectors(self, vector_ids: list[str]) -> None: ...


async def decommission_source(
    store: SourceStateStore,
    storage: StorageRemovalClient,
    *,
    source_kind: str,
    source_id: str,
) -> dict:
    """Remove every artifact the ingestion pipeline persisted for one source.

    Returns a manifest with counts so ``bin/decommission-customer.sh`` can
    write a DECOMMISSION_DRAIN_COMPLETE audit entry. Per ADR 0008 the
    customer-owned memory artifact MUST be removable on decommission.

    Order of operations:
      1. enumerate every memory_ingested_items row for the source
      2. remove R2 objects
      3. remove Vectorize vectors
      4. mark items deleted (soft delete keeps the provenance row for the
         audit trail; the substrate is gone)
      5. delete the memory_source_state row

    The caller writes the DECOMMISSION_DRAIN_COMPLETE audit row; this
    function reports counts.
    """
    items = await store.list_items_for_decommission(source_kind, source_id)
    r2_removed = 0
    vec_removed = 0
    for row in items:
        if row.get("r2_key"):
            await storage.delete_r2_object(row["r2_key"])
            r2_removed += 1
        if row.get("vectorize_chunk_ids"):
            vec_ids = json.loads(row["vectorize_chunk_ids"])
            if vec_ids:
                await storage.delete_vectorize_vectors(vec_ids)
                vec_removed += len(vec_ids)
    await store.mark_items_deleted(source_kind, source_id)
    await store.delete_state(source_kind, source_id)
    return {
        "source_kind": source_kind,
        "source_id": source_id,
        "items_removed": len(items),
        "r2_objects_removed": r2_removed,
        "vectorize_vectors_removed": vec_removed,
    }


__all__ = [
    "INGEST_STATUS_OK",
    "INGEST_STATUS_STALE",
    "INGEST_STATUS_ERROR",
    "INGEST_STATUS_NEVER_RUN",
    "VALID_ACCESS_SCOPES",
    "VALID_STATUSES",
    "IngestedItemRecord",
    "IngestionStateUpdate",
    "MemorySourceState",
    "SourceStateStore",
    "StorageRemovalClient",
    "decommission_source",
    "read_source_states",
]
