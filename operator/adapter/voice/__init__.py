"""Voice corpus toolchain (structural diff, partner filter, transform).

What survives here after the #1355 data-plane rip is the console-side voice
TOOLCHAIN: the structural-diff privacy primitive, the partner-authored
filter, corrections, and the draft transformer — consumed by
``bin/lib/voice_corpus.py`` (corpus seeding), ``bin/voice-ingest-corpus.py``,
and the voice gate.

The ADR-0008 voice INGESTION plane (``pipeline.py`` — VoiceIngestionRunner,
``enforce_retention``, ``decommission_source`` — plus ``namespaced.py``,
``state.py``, ``export.py``) was removed by #1355: it wrote/read
``voice_ingestion_items`` / ``voice_source_state`` on a per-customer
control-plane Cloudflare D1 that was never provisioned, and nothing ever
scheduled it. The live voice path is the overlay's ``hermes-smd-voice``
plugin reading the R2 corpus that ``voice_corpus.py`` seeds.

Public surface:

* :func:`extract_structural_diff` — the privacy primitive.
* :class:`PartnerAuthoredFilter` — three-pass AI-vs-partner detector.
* :class:`DraftTransformer` / :func:`transform_draft` — voice application.

See ADR 0005, 0006, 0009 and ``docs/specs/operator/voice-ingestion.md``.
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
    "CandidateMessage",
    "DraftTransformer",
    "FilterResult",
    "GENERAL_VOICE_COHORT",
    "GENERAL_VOICE_USER_ID",
    "GreetingStyle",
    "MAX_TRANSFORM_PASSES",
    "MIN_PROFILE_SAMPLE_COUNT",
    "MIN_WORD_COUNT_FOR_SAMPLE",
    "PartnerAuthoredFilter",
    "REASON_ADAPTER_AGENT_DRAFTED",
    "REASON_AUDIT_LOG_DIGEST_MATCH",
    "REASON_EMPTY_BODY",
    "REASON_SHAPE_HEURISTIC",
    "REASON_TOO_SHORT",
    "STRUCTURAL_DIFF_SCHEMA_VERSION",
    "SignoffStyle",
    "StructuralDiff",
    "TransformResult",
    "TransformStatus",
    "VoiceProfile",
    "VoiceProfileBundle",
    "build_voice_profile",
    "compute_body_digest",
    "extract_structural_diff",
    "structural_diff_digest",
    "transform_draft",
]
