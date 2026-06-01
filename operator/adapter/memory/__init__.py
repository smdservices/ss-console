"""Memory ingestion pipeline (issue #860).

Consumes capability-adapter results and writes to the per-customer memory
store (D1 + R2 + Vectorize). Vendor-neutral: depends on the
PracticeManagement capability contract, never on Filevine/Clio specifics.

Public surface:

* :class:`MemoryIngestionRunner` — the orchestrator. Construct with the
  capability adapter, the storage clients, the embedding client, and the
  D1 executor; call :meth:`run_ingestion` with a source descriptor and a
  mode (``"scheduled"`` or ``"on_demand"``).
* :class:`MemorySourceState` — read model for the dashboard, surfaced
  via :func:`read_source_states`.
* :func:`decommission_source` — removes every artifact the pipeline
  persisted for one source. Used by ``bin/decommission-customer.sh``.

See ADR 0006, 0008, 0009 and ``docs/specs/operator/memory-ingestion.md``.
"""

from __future__ import annotations

from .namespaced import (
    RawR2Client,
    RawVectorizeClient,
    build_namespaced_memory_runner,
)
from .pipeline import (
    DocumentChunker,
    EmbeddingClient,
    IngestionMode,
    IngestionResult,
    MemoryIngestionRunner,
    NoPracticeManagementSource,
    PracticeManagementSourceAdapter,
    SourceDescriptor,
    StorageError,
)
from .state import (
    MemorySourceState,
    SourceStateStore,
    decommission_source,
    read_source_states,
)

__all__ = [
    "DocumentChunker",
    "EmbeddingClient",
    "IngestionMode",
    "IngestionResult",
    "MemoryIngestionRunner",
    "MemorySourceState",
    "NoPracticeManagementSource",
    "PracticeManagementSourceAdapter",
    "RawR2Client",
    "RawVectorizeClient",
    "SourceDescriptor",
    "SourceStateStore",
    "StorageError",
    "build_namespaced_memory_runner",
    "decommission_source",
    "read_source_states",
]
