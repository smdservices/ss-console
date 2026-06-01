"""Factory helper that wires `MemoryIngestionRunner` against namespaced storage.

The memory pipeline's `StorageClient` is a Protocol with two methods —
`put_r2_object(key, body, *, content_type)` and
`upsert_vectors(index_name, vectors)`. The namespace-assertion wrappers
shipped in `adapter/namespace_assertion.py` use slightly different method
names (`put_object` for R2; the Vectorize one matches), so a thin bridge
adapter is needed to glue them onto the pipeline's expected shape.

`build_namespaced_memory_runner` is the public entry point. The Hermes
fork's per-customer Machine boot path calls this instead of constructing
`MemoryIngestionRunner` directly with raw storage — every R2 / Vectorize
call from the runner then routes through the namespace assertion before
hitting the raw client.

Filed as the recommended migration entry point against
[#1009](https://github.com/venturecrane/ss-console/issues/1009)
(fork-side adoption tracker; do not implement there).
"""

from __future__ import annotations

from typing import Any, Optional, Protocol

from ..audit_log import AuditLogWriter
from ..namespace_assertion import (
    NamespacedR2Client,
    NamespacedVectorizeClient,
)
from .chunking import DocumentChunker
from .pipeline import (
    MemoryIngestionRunner,
    PracticeManagementSourceAdapter,
    EmbeddingClient,
    StorageClient,
)
from .state import SourceStateStore


# ---------------------------------------------------------------------------
# Raw storage interface the fork's overlay already constructs
#
# The fork's overlay holds two raw clients per customer Machine: an R2
# binding and a Vectorize binding. They map onto the wrappers exactly:
#
#     raw_r2.put_object(key, body, *, content_type)
#     raw_r2.get_object(key) / raw_r2.delete_object(key)
#     raw_vectorize.upsert_vectors(index_name, vectors)
#     raw_vectorize.query_vectors(index_name, vector, *, top_k)
#     raw_vectorize.delete_vectors(index_name, ids)
#
# These are the shapes `NamespacedR2Client` and `NamespacedVectorizeClient`
# wrap directly, so no extra translation is needed at the raw layer.
# ---------------------------------------------------------------------------


class RawR2Client(Protocol):
    """The raw R2 client interface — exactly what `NamespacedR2Client` wraps."""

    async def put_object(self, key: str, body: bytes, *, content_type: str) -> None: ...
    async def get_object(self, key: str) -> bytes: ...
    async def delete_object(self, key: str) -> None: ...


class RawVectorizeClient(Protocol):
    """The raw Vectorize client interface — exactly what `NamespacedVectorizeClient` wraps."""

    async def upsert_vectors(self, index_name: str, vectors: list[dict]) -> None: ...
    async def query_vectors(
        self, index_name: str, vector: list[float], *, top_k: int
    ) -> Any: ...
    async def delete_vectors(self, index_name: str, ids: list[str]) -> None: ...


# ---------------------------------------------------------------------------
# Pipeline-shaped bridge
#
# The memory pipeline's `StorageClient` Protocol declares two methods:
#
#     put_r2_object(key, body, *, content_type)
#     upsert_vectors(index_name, vectors)
#
# `NamespacedR2Client.put_object` is the assertion-bearing equivalent of
# `put_r2_object`; `NamespacedVectorizeClient.upsert_vectors` matches the
# pipeline's vectorize method directly. This bridge owns the method-name
# adaptation so the pipeline stays untouched.
# ---------------------------------------------------------------------------


class _NamespacedStorageBridge:
    """Implements `StorageClient` by delegating through the namespace wrappers."""

    def __init__(
        self,
        *,
        r2: NamespacedR2Client,
        vectorize: NamespacedVectorizeClient,
    ) -> None:
        self._r2 = r2
        self._vectorize = vectorize

    async def put_r2_object(
        self, key: str, body: bytes, *, content_type: str
    ) -> None:
        await self._r2.put_object(key, body, content_type=content_type)

    async def upsert_vectors(
        self, index_name: str, vectors: list[dict]
    ) -> None:
        await self._vectorize.upsert_vectors(index_name, vectors)


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def build_namespaced_memory_runner(
    *,
    customer_slug: str,
    source_adapter: PracticeManagementSourceAdapter,
    raw_r2: RawR2Client,
    raw_vectorize: RawVectorizeClient,
    embeddings: EmbeddingClient,
    chunker: DocumentChunker,
    state_store: SourceStateStore,
    audit_writer: Optional[AuditLogWriter] = None,
    clock: Optional[callable] = None,
) -> MemoryIngestionRunner:
    """Return a `MemoryIngestionRunner` wired through namespace-asserting storage.

    The Hermes fork's per-customer Machine boot path should call this
    factory instead of `MemoryIngestionRunner(...)` directly. Every R2
    put and Vectorize upsert from the runner is routed through the
    namespace assertion before it hits the raw client, so a foreign-slug
    key or index name refuses + audits at the boundary.

    `audit_writer` is recommended in production so every refusal lands
    one `INVARIANT_VIOLATION` audit row. It may be omitted in tests; the
    refusal still raises `NamespaceAssertionError`.
    """
    r2 = NamespacedR2Client(
        expected_slug=customer_slug,
        inner=raw_r2,
        audit_writer=audit_writer,
    )
    vectorize = NamespacedVectorizeClient(
        expected_slug=customer_slug,
        inner=raw_vectorize,
        audit_writer=audit_writer,
    )
    bridge = _NamespacedStorageBridge(r2=r2, vectorize=vectorize)
    return MemoryIngestionRunner(
        customer_slug=customer_slug,
        source_adapter=source_adapter,
        storage=bridge,  # type: ignore[arg-type]  # bridge implements StorageClient
        embeddings=embeddings,
        chunker=chunker,
        state_store=state_store,
        clock=clock,
    )


__all__ = [
    "RawR2Client",
    "RawVectorizeClient",
    "build_namespaced_memory_runner",
]
