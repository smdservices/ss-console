"""Memory ingestion pipeline runner — vendor-neutral orchestrator.

The pipeline consumes capability-adapter outputs and writes to the
per-customer memory store. It runs in two modes (scheduled daily,
on-demand sync) through one entrypoint, :meth:`MemoryIngestionRunner.run_ingestion`.

Design rules (issue #860):

* ADR 0006 (capability-adapter pattern): the pipeline calls the
  ``PracticeManagement`` capability interface. Filevine, Clio, and "no PM
  system" all implement that interface; the pipeline does not know which.
  The :class:`PracticeManagementSourceAdapter` wraps any capability impl;
  the :class:`NoPracticeManagementSource` is the empty-result fallback.

* ADR 0008 (customer-owned memory): every artifact the pipeline persists
  is recorded in ``memory_ingested_items`` so decommission can remove it
  (see :mod:`.state`).

* ADR 0009 (cross-machine query prohibition): no tenant ID is passed in
  by the pipeline; isolation is the D1/R2/Vectorize binding.

* No autonomous send paths. The pipeline reads from the source system and
  writes to local memory storage; it never sends anything outward.

* Failure handling: every run upserts memory_source_state regardless of
  outcome. On error, ``ingest_status`` is set to ``"error"`` and
  ``last_error`` is populated; the skill layer reads cached items
  (memory_ingested_items rows with ``deleted_at IS NULL``) when reads
  must not block on a failed ingestion.

The pipeline is NOT responsible for:

* Implementing the Filevine or Clio capability adapters. Those are
  separate vendor adapters tracked by their own issues.
* Deciding per-matter ACLs. The source's ACL is propagated through
  ``IngestedItemRecord.access_scope``.
* Calling the dashboard query endpoint. The pipeline writes state; a
  separate dashboard endpoint reads it.
"""

from __future__ import annotations

import enum
import hashlib
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Protocol, Sequence

from .chunking import Chunk, DocumentChunker
from .state import (
    INGEST_STATUS_ERROR,
    INGEST_STATUS_OK,
    IngestedItemRecord,
    IngestionStateUpdate,
    SourceStateStore,
)

log = logging.getLogger("aie.memory.pipeline")


# ---------------------------------------------------------------------------
# Domain types — vendor-neutral
# ---------------------------------------------------------------------------


class IngestionMode(str, enum.Enum):
    """Ingestion is either scheduled (cron) or on-demand (synchronous call).

    Both modes share the same entrypoint and the same write path. The mode
    string is recorded in metadata so the dashboard can render which kind of
    run produced the last state row.
    """

    SCHEDULED = "scheduled"
    ON_DEMAND = "on_demand"


@dataclass(frozen=True)
class SourceDescriptor:
    """Identifies one ingestion source for the pipeline.

    ``source_kind`` is the capability name lowercased
    (e.g. ``"practice_management"``).
    ``source_id`` is the adapter vendor slug (``"filevine"``, ``"clio"``)
    or ``"none"`` for the no-PM-system fallback.
    """

    source_kind: str
    source_id: str


@dataclass
class IngestionResult:
    """Outcome of one ingestion run.

    ``ok`` is true iff the run completed without raising. ``items_ingested``
    is the count of memory_ingested_items rows written. ``error`` carries
    the human-readable message persisted to ``memory_source_state.last_error``
    when ``ok`` is false.
    """

    descriptor: SourceDescriptor
    mode: IngestionMode
    started_at: str
    finished_at: str
    ok: bool
    items_ingested: int
    matters_seen: int = 0
    documents_seen: int = 0
    recipients_seen: int = 0
    error: Optional[str] = None
    item_ulids: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class IngestedMatter:
    """Normalized matter shape used inside the pipeline.

    Adapters return capability-typed Matter objects; the pipeline maps them
    onto this internal shape to decouple from any one vendor's field set.
    """

    external_id: str
    client_name: str
    matter_type: str
    status: str
    access_scope: str = "firm-wide"
    access_scope_detail: Optional[dict] = None
    custom_fields: dict = field(default_factory=dict)


@dataclass(frozen=True)
class IngestedDocument:
    """Normalized document shape, with the body resolved by the source adapter."""

    external_id: str
    matter_external_id: str
    filename: str
    mime_type: str
    body_text: str
    access_scope: str = "firm-wide"
    access_scope_detail: Optional[dict] = None


@dataclass(frozen=True)
class IngestedRecipient:
    """Normalized recipient relationship for the graph."""

    external_id: str
    name: str
    role: Optional[str]
    email: Optional[str]
    matter_external_ids: tuple[str, ...] = ()


# ---------------------------------------------------------------------------
# Source adapter — vendor-neutral wrapper over PracticeManagement
# ---------------------------------------------------------------------------


class PracticeManagementSource(Protocol):
    """The minimal source contract the pipeline depends on.

    This protocol is intentionally smaller than the full
    ``PracticeManagement`` capability interface (which lives in TypeScript
    under ``src/lib/operator/capabilities/practice-management.ts``).
    The Python pipeline only reads; it does not create matters, post time
    entries, or upload documents.

    Production wiring constructs a ``PracticeManagementSourceAdapter``
    around the real vendor adapter (Filevine, Clio) that calls the
    JavaScript adapter via the Hermes runtime bridge. That bridge is
    out of scope for this PR (tracked under capability-adapter issues).
    """

    async def list_matters(self) -> list[IngestedMatter]: ...

    async def list_matter_documents(
        self, matter_external_id: str
    ) -> list[IngestedDocument]: ...

    async def list_recipients(self) -> list[IngestedRecipient]: ...


class PracticeManagementSourceAdapter:
    """Thin trampoline around any :class:`PracticeManagementSource` impl.

    Exists so production code can swap real vendor adapters in/out via
    configuration without the pipeline knowing. Tests use a fake
    implementation directly.
    """

    def __init__(self, impl: PracticeManagementSource) -> None:
        self._impl = impl

    async def list_matters(self) -> list[IngestedMatter]:
        return await self._impl.list_matters()

    async def list_matter_documents(
        self, matter_external_id: str
    ) -> list[IngestedDocument]:
        return await self._impl.list_matter_documents(matter_external_id)

    async def list_recipients(self) -> list[IngestedRecipient]:
        return await self._impl.list_recipients()


class NoPracticeManagementSource:
    """No-PM-system fallback — empty result set.

    The Captain dashboard sees the source as healthy (``ingest_status``
    cycles ``"ok"``) so the demo customer with no PM system still has a
    green row. This satisfies the AC: ``"No PM system" fallback: a no-op
    source that returns an empty result set and last_ingestion_at = now()``.
    """

    async def list_matters(self) -> list[IngestedMatter]:
        return []

    async def list_matter_documents(
        self, matter_external_id: str
    ) -> list[IngestedDocument]:
        return []

    async def list_recipients(self) -> list[IngestedRecipient]:
        return []


# ---------------------------------------------------------------------------
# Storage protocols (R2 + Vectorize)
# ---------------------------------------------------------------------------


class StorageError(RuntimeError):
    """Raised when an R2 or Vectorize write fails.

    Wraps the underlying vendor exception so the pipeline can flag the
    source as errored without exposing vendor SDK exception types to the
    skill layer.
    """


class StorageClient(Protocol):
    """R2 + Vectorize write surface used by the pipeline.

    Production wires this to per-customer R2 bucket and per-customer
    Vectorize index bindings (see ``r2-vectorize-naming.md``). Tests pass
    an in-memory fake that records calls.
    """

    async def put_r2_object(self, key: str, body: bytes, *, content_type: str) -> None: ...

    async def upsert_vectors(
        self,
        index_name: str,
        vectors: list[dict],
    ) -> None: ...


class EmbeddingClient(Protocol):
    """Embedding model client.

    Production uses the standard embedding model wired through the Hermes
    runtime. Tests pass a deterministic fake that returns a fixed vector
    per chunk text. The pipeline does not depend on a specific embedding
    dimension; the storage client validates against the index's dim.
    """

    async def embed(self, texts: list[str]) -> list[list[float]]: ...


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _iso_utc(now: Optional[datetime] = None) -> str:
    dt = now if now is not None else datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _matter_r2_key(customer_slug: str, source_id: str, external_id: str) -> str:
    """Returns the R2 key for a matter's narrative content.

    Per r2-vectorize-naming.md, narrative knowledge lives under
    ``{customer-slug}/vault/narrative/``. The pipeline writes a JSON
    payload there per ingested matter so the retrieval layer can pull
    the structured fields back without re-querying the source system.
    """
    return f"{customer_slug}/vault/narrative/pm-{source_id}-matter-{external_id}.json"


def _document_r2_key(
    customer_slug: str, source_id: str, document_external_id: str
) -> str:
    """Returns the R2 key for a document body.

    Documents land under ``{customer-slug}/vault/process/`` per
    r2-vectorize-naming.md (treated as process knowledge for the vault).
    The retrieval layer reads R2 by key when a chunk citation resolves.
    """
    return f"{customer_slug}/vault/process/pm-{source_id}-doc-{document_external_id}.txt"


def _vault_index_name(customer_slug: str) -> str:
    return f"hermes-{customer_slug}-vault"


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


class MemoryIngestionRunner:
    """Orchestrates one ingestion run.

    Construction takes the source adapter, the storage clients, the
    embedding client, the chunker, and the D1-backed state store. The
    runner itself holds no per-run state — it is safe to share a single
    instance across scheduled and on-demand calls.
    """

    def __init__(
        self,
        *,
        customer_slug: str,
        source_adapter: PracticeManagementSourceAdapter,
        storage: StorageClient,
        embeddings: EmbeddingClient,
        chunker: DocumentChunker,
        state_store: SourceStateStore,
        clock: Optional[callable] = None,
    ) -> None:
        if not customer_slug:
            raise ValueError("customer_slug must be a non-empty string")
        self._customer_slug = customer_slug
        self._source = source_adapter
        self._storage = storage
        self._embeddings = embeddings
        self._chunker = chunker
        self._state = state_store
        self._clock = clock

    def _now(self) -> str:
        if self._clock:
            return _iso_utc(self._clock())
        return _iso_utc()

    async def run_ingestion(
        self, descriptor: SourceDescriptor, mode: IngestionMode
    ) -> IngestionResult:
        """Run one ingestion pass against one source.

        On success, persists matters / documents / recipients into the
        per-customer memory store and writes a green
        ``memory_source_state`` row.

        On failure, writes a red ``memory_source_state`` row with
        ``last_error`` populated. The exception is NOT re-raised — the
        scheduled runner must continue to the next source, and the
        on-demand caller surfaces the error to the dashboard through the
        returned :class:`IngestionResult`. Per AC: "agent operates on
        cached"; the cached path is the existing memory_ingested_items
        rows that were not deleted.
        """
        started_at = self._now()
        result = IngestionResult(
            descriptor=descriptor,
            mode=mode,
            started_at=started_at,
            finished_at=started_at,
            ok=False,
            items_ingested=0,
        )

        try:
            matters = await self._source.list_matters()
            recipients = await self._source.list_recipients()

            documents: list[IngestedDocument] = []
            for matter in matters:
                docs = await self._source.list_matter_documents(matter.external_id)
                documents.extend(docs)

            result.matters_seen = len(matters)
            result.documents_seen = len(documents)
            result.recipients_seen = len(recipients)

            item_records: list[IngestedItemRecord] = []

            # Matters → narrative R2 object, no chunking.
            for matter in matters:
                key = _matter_r2_key(
                    self._customer_slug, descriptor.source_id, matter.external_id
                )
                payload = _matter_payload(matter)
                await self._storage.put_r2_object(
                    key, payload, content_type="application/json"
                )
                item_records.append(
                    IngestedItemRecord(
                        source_kind=descriptor.source_kind,
                        source_id=descriptor.source_id,
                        external_id=matter.external_id,
                        item_type="matter",
                        access_scope=matter.access_scope,
                        access_scope_detail=matter.access_scope_detail,
                        r2_key=key,
                        vectorize_chunk_ids=None,
                        content_digest=_digest(payload),
                        metadata={
                            "client_name": matter.client_name,
                            "matter_type": matter.matter_type,
                            "status": matter.status,
                        },
                    )
                )

            # Documents → R2 body + chunked Vectorize index.
            for doc in documents:
                key = _document_r2_key(
                    self._customer_slug, descriptor.source_id, doc.external_id
                )
                body_bytes = doc.body_text.encode("utf-8")
                await self._storage.put_r2_object(
                    key, body_bytes, content_type=doc.mime_type or "text/plain"
                )
                chunks = self._chunker.chunk(
                    document_external_id=doc.external_id, text=doc.body_text
                )
                vector_ids = [c.id for c in chunks]
                if chunks:
                    embeds = await self._embeddings.embed([c.text for c in chunks])
                    if len(embeds) != len(chunks):
                        raise StorageError(
                            f"embedding count {len(embeds)} != chunk count {len(chunks)}"
                        )
                    vectors = [
                        _build_vector_record(self._customer_slug, doc, chunk, vec)
                        for chunk, vec in zip(chunks, embeds)
                    ]
                    await self._storage.upsert_vectors(
                        _vault_index_name(self._customer_slug), vectors
                    )
                item_records.append(
                    IngestedItemRecord(
                        source_kind=descriptor.source_kind,
                        source_id=descriptor.source_id,
                        external_id=doc.external_id,
                        item_type="document",
                        access_scope=doc.access_scope,
                        access_scope_detail=doc.access_scope_detail,
                        r2_key=key,
                        vectorize_chunk_ids=vector_ids if vector_ids else None,
                        content_digest=_digest(body_bytes),
                        metadata={
                            "filename": doc.filename,
                            "matter_external_id": doc.matter_external_id,
                            "mime_type": doc.mime_type,
                            "chunk_count": len(chunks),
                        },
                    )
                )

            # Recipients → relationship rows only; no R2, no Vectorize.
            for recipient in recipients:
                item_records.append(
                    IngestedItemRecord(
                        source_kind=descriptor.source_kind,
                        source_id=descriptor.source_id,
                        external_id=recipient.external_id,
                        item_type="recipient",
                        access_scope="firm-wide",
                        r2_key=None,
                        vectorize_chunk_ids=None,
                        content_digest=None,
                        metadata={
                            "name": recipient.name,
                            "role": recipient.role,
                            "email": recipient.email,
                            "matter_external_ids": list(recipient.matter_external_ids),
                        },
                    )
                )

            finished_at = self._now()
            ulids = await self._state.record_items(item_records, ingested_at=finished_at)
            result.item_ulids = ulids
            result.items_ingested = len(item_records)
            result.finished_at = finished_at
            result.ok = True

            await self._state.upsert_state(
                IngestionStateUpdate(
                    source_kind=descriptor.source_kind,
                    source_id=descriptor.source_id,
                    ingested_at=finished_at,
                    status=INGEST_STATUS_OK,
                    items_last_run=len(item_records),
                    error=None,
                )
            )
            log.info(
                "memory_ingestion.run ok customer=%s source=%s/%s mode=%s items=%d",
                self._customer_slug,
                descriptor.source_kind,
                descriptor.source_id,
                mode.value,
                len(item_records),
            )
            return result

        except Exception as exc:  # noqa: BLE001 — pipeline must not crash the runner
            finished_at = self._now()
            result.finished_at = finished_at
            result.ok = False
            result.error = f"{type(exc).__name__}: {exc}"
            try:
                await self._state.upsert_state(
                    IngestionStateUpdate(
                        source_kind=descriptor.source_kind,
                        source_id=descriptor.source_id,
                        ingested_at=finished_at,
                        status=INGEST_STATUS_ERROR,
                        items_last_run=0,
                        error=result.error,
                    )
                )
            except Exception:  # noqa: BLE001
                # If the state write itself fails we cannot do better than log.
                # The caller (scheduler or dashboard) will see the missing
                # update and surface a degraded indicator.
                log.exception(
                    "memory_ingestion.state_write_failed source=%s/%s",
                    descriptor.source_kind,
                    descriptor.source_id,
                )
            log.exception(
                "memory_ingestion.run failed customer=%s source=%s/%s mode=%s",
                self._customer_slug,
                descriptor.source_kind,
                descriptor.source_id,
                mode.value,
            )
            return result


# ---------------------------------------------------------------------------
# Payload helpers
# ---------------------------------------------------------------------------


def _matter_payload(matter: IngestedMatter) -> bytes:
    """Serialize an :class:`IngestedMatter` to a stable JSON payload for R2."""
    import json

    body = {
        "external_id": matter.external_id,
        "client_name": matter.client_name,
        "matter_type": matter.matter_type,
        "status": matter.status,
        "access_scope": matter.access_scope,
        "custom_fields": matter.custom_fields,
    }
    return json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _build_vector_record(
    customer_slug: str, doc: IngestedDocument, chunk: Chunk, vector: list[float]
) -> dict:
    """Shape one Vectorize upsert record.

    Metadata is intentionally small — the retrieval layer reads the
    full document body from R2 once a chunk citation resolves. Putting the
    text in metadata duplicates storage and inflates the index.
    """
    return {
        "id": chunk.id,
        "values": vector,
        "metadata": {
            "customer_slug": customer_slug,
            "document_external_id": doc.external_id,
            "matter_external_id": doc.matter_external_id,
            "chunk_index": chunk.index,
            "filename": doc.filename,
            "access_scope": doc.access_scope,
        },
    }


# Public surface (`from adapter.memory.pipeline import *`) excludes the
# raw `StorageClient` Protocol as of issue #861's TOCTOU hardening:
# external callers MUST go through
# `adapter.memory.build_namespaced_memory_runner(...)`, which wraps a
# raw R2 + Vectorize pair in the namespace-asserting bridge before
# handing it to the runner. The Protocol remains importable by explicit
# name for the bridge in `namespaced.py` and for tests.
__all__ = [
    "DocumentChunker",
    "EmbeddingClient",
    "IngestedDocument",
    "IngestedMatter",
    "IngestedRecipient",
    "IngestionMode",
    "IngestionResult",
    "MemoryIngestionRunner",
    "NoPracticeManagementSource",
    "PracticeManagementSource",
    "PracticeManagementSourceAdapter",
    "SourceDescriptor",
    "StorageError",
]
