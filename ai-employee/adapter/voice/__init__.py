"""Voice sample ingestion pipeline (issue #856).

Consumes the Email capability's sent folder, filters AI-drafted
messages out, extracts structural-diff representations (never raw
bodies), and writes them to the per-customer R2 vault at
``{customer-slug}/voice/cohort/{cohort-id}/{sample-id}.json``.

Sibling to the memory ingestion pipeline (PR #944) — same shape,
distinct concern. Voice anchors Layer 2 of the voice gate; memory
holds matter and document context.

Public surface:

* :class:`VoiceIngestionRunner` — the orchestrator. Construct with
  the Email source, cohort resolver, R2 client, state store, cursor
  store, and audit-log lookup; call
  :meth:`VoiceIngestionRunner.run_ingestion` with a mode.
* :func:`enforce_retention` — deletes samples older than the
  ``voice_retention_days`` window from customer.yaml.
* :func:`decommission_source` — removes every voice artifact the
  pipeline persisted for one source. Called by
  ``bin/decommission-customer.sh``.
* :class:`PartnerAuthoredFilter` — three-pass AI-vs-partner detector.
* :func:`extract_structural_diff` — the privacy primitive.

See ADR 0005, 0006, 0008, 0009 and
``docs/specs/ai-employee/voice-ingestion.md``.
"""

from __future__ import annotations

from .diff import (
    SCHEMA_VERSION as STRUCTURAL_DIFF_SCHEMA_VERSION,
    GreetingStyle,
    SignoffStyle,
    StructuralDiff,
    extract_structural_diff,
    structural_diff_digest,
)
from .filter import (
    ACCEPT_REASON,
    AuditDigestLookup,
    CandidateMessage,
    FilterResult,
    MIN_WORD_COUNT_FOR_SAMPLE,
    PartnerAuthoredFilter,
    REASON_ADAPTER_AGENT_DRAFTED,
    REASON_AUDIT_LOG_DIGEST_MATCH,
    REASON_EMPTY_BODY,
    REASON_SHAPE_HEURISTIC,
    REASON_TOO_SHORT,
    compute_body_digest,
)
from .namespaced import (
    RawR2Client as NamespacedRawR2Client,
    build_namespaced_voice_runner,
)
from .pipeline import (
    CohortResolver,
    CursorStore,
    EmailSource,
    IngestionMode,
    IngestionResult,
    NoEmailSource,
    R2Client,
    SentMessage,
    StaticCohortResolver,
    StorageError,
    VoiceIngestionRunner,
    decommission_source,
    enforce_retention,
)
from .state import (
    COHORT_UNASSIGNED,
    INGEST_STATUS_ERROR,
    INGEST_STATUS_NEVER_RUN,
    INGEST_STATUS_OK,
    INGEST_STATUS_STALE,
    IngestionItemRecord,
    IngestionStateUpdate,
    QueryExecutor,
    VALID_STATUSES,
    VoiceIngestionItem,
    VoiceSourceState,
    VoiceSourceStateStore,
    WriteExecutor,
)
from .transform import (
    DraftTransformer,
    GENERAL_VOICE_COHORT,
    GENERAL_VOICE_USER_ID,
    MAX_TRANSFORM_PASSES,
    MIN_PROFILE_SAMPLE_COUNT,
    TransformResult,
    TransformStatus,
    VoiceProfile,
    VoiceProfileBundle,
    build_voice_profile,
    transform_draft,
)

__all__ = [
    "ACCEPT_REASON",
    "AuditDigestLookup",
    "COHORT_UNASSIGNED",
    "CandidateMessage",
    "CohortResolver",
    "CursorStore",
    "DraftTransformer",
    "EmailSource",
    "GENERAL_VOICE_COHORT",
    "GENERAL_VOICE_USER_ID",
    "FilterResult",
    "GreetingStyle",
    "INGEST_STATUS_ERROR",
    "INGEST_STATUS_NEVER_RUN",
    "INGEST_STATUS_OK",
    "INGEST_STATUS_STALE",
    "IngestionItemRecord",
    "IngestionMode",
    "IngestionResult",
    "IngestionStateUpdate",
    "MAX_TRANSFORM_PASSES",
    "MIN_PROFILE_SAMPLE_COUNT",
    "MIN_WORD_COUNT_FOR_SAMPLE",
    "NamespacedRawR2Client",
    "NoEmailSource",
    "PartnerAuthoredFilter",
    "QueryExecutor",
    "R2Client",
    "REASON_ADAPTER_AGENT_DRAFTED",
    "REASON_AUDIT_LOG_DIGEST_MATCH",
    "REASON_EMPTY_BODY",
    "REASON_SHAPE_HEURISTIC",
    "REASON_TOO_SHORT",
    "STRUCTURAL_DIFF_SCHEMA_VERSION",
    "SentMessage",
    "SignoffStyle",
    "StaticCohortResolver",
    "StorageError",
    "StorageError",
    "StructuralDiff",
    "TransformResult",
    "TransformStatus",
    "VALID_STATUSES",
    "VoiceIngestionItem",
    "VoiceIngestionRunner",
    "VoiceProfile",
    "VoiceProfileBundle",
    "VoiceSourceState",
    "VoiceSourceStateStore",
    "WriteExecutor",
    "build_namespaced_voice_runner",
    "build_voice_profile",
    "compute_body_digest",
    "decommission_source",
    "enforce_retention",
    "extract_structural_diff",
    "structural_diff_digest",
    "transform_draft",
]
