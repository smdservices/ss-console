"""Tests for ai-employee/adapter/curator_interceptor.py (ADR 0017).

Covers the observer-only contract: every draft lands in `skill_drafts` with
source-evidence, every write emits the matching audit row, promotion and
dismissal stamp the row idempotently, draft-type-specific target-slug
requirements are enforced, and boot-time verification halts the Machine if
a competing Curator write surface is detected.

Run from ai-employee/ directory:

    cd ai-employee && python -m pytest adapter/tests/test_curator_interceptor.py -v
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # ai-employee/ on sys.path

from adapter.audit_log import (  # noqa: E402
    ACCEPTED_ACTION_TYPES,
    AuditLogWriter,
    SqliteExecutor,
)
from adapter.curator_interceptor import (  # noqa: E402
    CuratorDraftStateError,
    CuratorEvidenceRequired,
    CuratorInterceptor,
    CuratorNativeWriteBlocked,
    CuratorTargetRequired,
    DraftType,
    SkillDraft,
    verify_curator_intercepted,
)


# ---------------------------------------------------------------------------
# Schema helpers — mirror the migrations' tables for end-to-end tests
# ---------------------------------------------------------------------------


_AUDIT_LOG_SCHEMA = """
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


_SKILL_DRAFTS_SCHEMA = """
CREATE TABLE skill_drafts (
  draft_id              TEXT PRIMARY KEY,
  draft_type            TEXT NOT NULL,
  target_skill_slug     TEXT,
  draft_body            TEXT NOT NULL,
  source_evidence_json  TEXT NOT NULL,
  curator_score         REAL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  promoted_at           TEXT,
  promoted_by           TEXT,
  promoted_pr_url       TEXT,
  dismissed_at          TEXT,
  dismissed_by          TEXT,
  dismissed_reason      TEXT,
  CHECK (source_evidence_json IS NOT NULL AND length(source_evidence_json) > 0)
);
"""


def _make_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.executescript(_AUDIT_LOG_SCHEMA)
    conn.executescript(_SKILL_DRAFTS_SCHEMA)
    return conn


def _make_interceptor(customer: str = "test-firm") -> tuple[CuratorInterceptor, sqlite3.Connection]:
    conn = _make_conn()
    executor = SqliteExecutor(conn)
    writer = AuditLogWriter(executor)
    interceptor = CuratorInterceptor(
        executor=executor,
        audit_writer=writer,
        customer=customer,
    )
    return interceptor, conn


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _sample_new_skill(**overrides) -> SkillDraft:
    defaults = {
        "draft_type": DraftType.NEW_SKILL,
        "draft_body": "---\nname: intake-followup\n---\n\nWhen a lead goes quiet, send a check-in.",
        "source_evidence": ["trace-001", "trace-014", "trace-027"],
        "target_skill_slug": None,
        "curator_score": 0.82,
    }
    defaults.update(overrides)
    return SkillDraft(**defaults)


def _sample_consolidation(**overrides) -> SkillDraft:
    defaults = {
        "draft_type": DraftType.CONSOLIDATION,
        "draft_body": "Merge intake-followup into intake-orchestration; both fire on the same trigger.",
        "source_evidence": ["trace-101", "trace-102"],
        "target_skill_slug": "intake-orchestration",
        "curator_score": 0.71,
    }
    defaults.update(overrides)
    return SkillDraft(**defaults)


def _sample_prune(**overrides) -> SkillDraft:
    defaults = {
        "draft_type": DraftType.PRUNE_RECOMMENDATION,
        "draft_body": "Skill triggered 12 times; 11 produced dismissed drafts. Recommend removal.",
        "source_evidence": ["trace-201", "trace-202", "trace-203", "outcome-summary-w34"],
        "target_skill_slug": "lead-warming-v2",
        "curator_score": 0.18,
    }
    defaults.update(overrides)
    return SkillDraft(**defaults)


# ---------------------------------------------------------------------------
# Audit action_type registration (ADR 0017 §8)
# ---------------------------------------------------------------------------


def test_audit_action_types_registered_in_accepted_set():
    # Per ADR 0017 §8, the writer must accept the three Curator action_types.
    # If a future refactor renames or removes any of these from
    # ACCEPTED_ACTION_TYPES, the interceptor's audit-emit calls will start
    # raising ValueError and this test will catch the regression first.
    assert "CURATOR_DRAFT" in ACCEPTED_ACTION_TYPES
    assert "CURATOR_PROMOTION" in ACCEPTED_ACTION_TYPES
    assert "CURATOR_DISMISSAL" in ACCEPTED_ACTION_TYPES


# ---------------------------------------------------------------------------
# Draft creation
# ---------------------------------------------------------------------------


def test_record_new_skill_draft_inserts_row_and_returns_ulid():
    interceptor, conn = _make_interceptor()
    draft = _sample_new_skill()
    draft_id = _run(interceptor.record_draft(draft))

    assert isinstance(draft_id, str)
    assert len(draft_id) == 26  # ULID shape

    cur = conn.cursor()
    cur.execute(
        "SELECT draft_type, target_skill_slug, draft_body, source_evidence_json, "
        "curator_score FROM skill_drafts WHERE draft_id = ?",
        [draft_id],
    )
    row = cur.fetchone()
    assert row is not None
    dtype, target, body, evidence_json, score = row
    assert dtype == DraftType.NEW_SKILL.value
    assert target is None  # new_skill has no target
    assert body.startswith("---")
    assert json.loads(evidence_json) == ["trace-001", "trace-014", "trace-027"]
    assert abs(score - 0.82) < 1e-9


def test_record_consolidation_draft_stores_target_skill_slug():
    interceptor, conn = _make_interceptor()
    draft = _sample_consolidation()
    draft_id = _run(interceptor.record_draft(draft))

    cur = conn.cursor()
    cur.execute(
        "SELECT draft_type, target_skill_slug FROM skill_drafts WHERE draft_id = ?",
        [draft_id],
    )
    dtype, target = cur.fetchone()
    assert dtype == DraftType.CONSOLIDATION.value
    assert target == "intake-orchestration"


def test_record_draft_emits_audit_row():
    interceptor, conn = _make_interceptor(customer="acme-pi")
    draft = _sample_prune()
    draft_id = _run(interceptor.record_draft(draft))

    cur = conn.cursor()
    cur.execute(
        "SELECT action_type, actor, actor_role, skill_name, metadata FROM audit_log "
        "WHERE action_type = ?",
        ["CURATOR_DRAFT"],
    )
    row = cur.fetchone()
    assert row is not None
    action_type, actor, actor_role, skill_name, metadata_json = row
    assert action_type == "CURATOR_DRAFT"
    assert actor == "agent"
    assert actor_role == "agent"
    # skill_name on the audit row is the target_skill_slug, surfaced for
    # per-skill audit filtering.
    assert skill_name == "lead-warming-v2"
    metadata = json.loads(metadata_json)
    assert metadata["customer"] == "acme-pi"
    assert metadata["draft_id"] == draft_id
    assert metadata["draft_type"] == DraftType.PRUNE_RECOMMENDATION.value
    assert metadata["target_skill_slug"] == "lead-warming-v2"
    assert metadata["evidence_count"] == 4


# ---------------------------------------------------------------------------
# Draft-type / target-slug rules (ADR 0017 §1)
# ---------------------------------------------------------------------------


def test_consolidation_without_target_raises_before_sql():
    interceptor, conn = _make_interceptor()
    draft = _sample_consolidation(target_skill_slug=None)
    with pytest.raises(CuratorTargetRequired) as exc_info:
        _run(interceptor.record_draft(draft))
    assert "target_skill_slug" in str(exc_info.value)
    assert "ADR 0017" in str(exc_info.value)

    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM skill_drafts")
    assert cur.fetchone()[0] == 0


def test_prune_without_target_raises():
    interceptor, _ = _make_interceptor()
    draft = _sample_prune(target_skill_slug=None)
    with pytest.raises(CuratorTargetRequired):
        _run(interceptor.record_draft(draft))


def test_scope_adjustment_without_target_raises():
    interceptor, _ = _make_interceptor()
    draft = SkillDraft(
        draft_type=DraftType.SCOPE_ADJUSTMENT,
        draft_body="Narrow scope to PI matters only.",
        source_evidence=["trace-301"],
        target_skill_slug=None,
    )
    with pytest.raises(CuratorTargetRequired):
        _run(interceptor.record_draft(draft))


def test_new_skill_with_target_raises():
    interceptor, _ = _make_interceptor()
    draft = _sample_new_skill(target_skill_slug="existing-skill")
    with pytest.raises(CuratorTargetRequired) as exc_info:
        _run(interceptor.record_draft(draft))
    assert "new_skill" in str(exc_info.value)
    assert "must NOT" in str(exc_info.value)


def test_empty_draft_body_raises():
    interceptor, _ = _make_interceptor()
    draft = _sample_new_skill(draft_body="")
    with pytest.raises(ValueError) as exc_info:
        _run(interceptor.record_draft(draft))
    assert "draft_body" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Fabrication discipline (ADR 0017 §6)
# ---------------------------------------------------------------------------


def test_draft_without_evidence_raises_before_sql():
    interceptor, conn = _make_interceptor()
    draft = _sample_new_skill(source_evidence=[])
    with pytest.raises(CuratorEvidenceRequired) as exc_info:
        _run(interceptor.record_draft(draft))
    assert "source_evidence" in str(exc_info.value)
    assert "ADR 0017" in str(exc_info.value)

    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM skill_drafts")
    assert cur.fetchone()[0] == 0
    cur.execute("SELECT COUNT(*) FROM audit_log")
    assert cur.fetchone()[0] == 0


def test_check_constraint_rejects_empty_evidence_at_db_layer():
    # Belt-and-suspenders: even if a caller bypassed the runtime check
    # (e.g., by writing directly through the executor), the CHECK
    # constraint in migration 0008 rejects the row.
    conn = _make_conn()
    cur = conn.cursor()
    with pytest.raises(sqlite3.IntegrityError):
        cur.execute(
            "INSERT INTO skill_drafts "
            "(draft_id, draft_type, draft_body, source_evidence_json) "
            "VALUES (?, ?, ?, ?)",
            ["test-id", "new_skill", "body", ""],
        )


# ---------------------------------------------------------------------------
# Promotion (ADR 0017 §3, §10 — no self-promotion)
# ---------------------------------------------------------------------------


def test_promote_stamps_row_and_emits_audit_event():
    interceptor, conn = _make_interceptor()
    draft_id = _run(interceptor.record_draft(_sample_new_skill()))

    pr_url = "https://github.com/venturecrane/crane-console/pull/2042"
    _run(
        interceptor.promote(
            draft_id=draft_id,
            promoted_by="captain",
            pr_url=pr_url,
        )
    )

    cur = conn.cursor()
    cur.execute(
        "SELECT promoted_at, promoted_by, promoted_pr_url, dismissed_at "
        "FROM skill_drafts WHERE draft_id = ?",
        [draft_id],
    )
    promoted_at, promoted_by, promoted_pr_url, dismissed_at = cur.fetchone()
    assert promoted_at is not None
    assert promoted_by == "captain"
    assert promoted_pr_url == pr_url
    assert dismissed_at is None

    cur.execute(
        "SELECT actor, actor_role, metadata FROM audit_log "
        "WHERE action_type = ?",
        ["CURATOR_PROMOTION"],
    )
    actor, actor_role, metadata_json = cur.fetchone()
    assert actor == "captain"
    # Curator promotions use CAPTAIN role per ADR 0017 §10 — Captain reviews
    # the cross-customer catalog, not the per-customer principal.
    assert actor_role == "captain"
    metadata = json.loads(metadata_json)
    assert metadata["draft_id"] == draft_id
    assert metadata["promoted_pr_url"] == pr_url


def test_promote_requires_pr_url():
    interceptor, _ = _make_interceptor()
    draft_id = _run(interceptor.record_draft(_sample_new_skill()))
    with pytest.raises(ValueError) as exc_info:
        _run(
            interceptor.promote(
                draft_id=draft_id,
                promoted_by="captain",
                pr_url="",
            )
        )
    assert "pr_url" in str(exc_info.value)
    assert "ADR 0017 §3" in str(exc_info.value)


def test_promote_requires_promoted_by_per_no_self_promote_rule():
    # ADR 0017 §10: the Curator NEVER self-promotes. The structural
    # enforcement is that promoted_by must be a named human actor; the
    # signature rejects empty strings so no auto-promotion path can omit
    # the Captain identifier.
    interceptor, _ = _make_interceptor()
    draft_id = _run(interceptor.record_draft(_sample_new_skill()))
    with pytest.raises(ValueError) as exc_info:
        _run(
            interceptor.promote(
                draft_id=draft_id,
                promoted_by="",
                pr_url="https://x/y/z",
            )
        )
    assert "promoted_by" in str(exc_info.value)
    assert "NEVER self-promotes" in str(exc_info.value)


def test_promote_unknown_draft_raises_state_error():
    interceptor, _ = _make_interceptor()
    with pytest.raises(CuratorDraftStateError) as exc_info:
        _run(
            interceptor.promote(
                draft_id="01HX0000000000000000000000",
                promoted_by="captain",
                pr_url="https://x/y/z",
            )
        )
    assert "not found" in str(exc_info.value)


def test_promote_idempotency_second_call_raises():
    interceptor, _ = _make_interceptor()
    draft_id = _run(interceptor.record_draft(_sample_new_skill()))
    _run(
        interceptor.promote(
            draft_id=draft_id,
            promoted_by="captain",
            pr_url="https://x/y/first",
        )
    )
    with pytest.raises(CuratorDraftStateError) as exc_info:
        _run(
            interceptor.promote(
                draft_id=draft_id,
                promoted_by="captain",
                pr_url="https://x/y/second",
            )
        )
    assert "terminal state" in str(exc_info.value)


def test_promote_after_dismissal_raises():
    interceptor, _ = _make_interceptor()
    draft_id = _run(interceptor.record_draft(_sample_new_skill()))
    _run(
        interceptor.dismiss(
            draft_id=draft_id,
            dismissed_by="captain",
            reason="proposed slug collides with existing skill",
        )
    )
    with pytest.raises(CuratorDraftStateError):
        _run(
            interceptor.promote(
                draft_id=draft_id,
                promoted_by="captain",
                pr_url="https://x/y/z",
            )
        )


# ---------------------------------------------------------------------------
# Dismissal (ADR 0017 §4)
# ---------------------------------------------------------------------------


def test_dismiss_stamps_row_and_emits_audit_event():
    interceptor, conn = _make_interceptor()
    draft_id = _run(interceptor.record_draft(_sample_prune()))

    _run(
        interceptor.dismiss(
            draft_id=draft_id,
            dismissed_by="captain",
            reason="skill is essential for two other customers — outcome signal is local",
        )
    )

    cur = conn.cursor()
    cur.execute(
        "SELECT promoted_at, dismissed_at, dismissed_by, dismissed_reason "
        "FROM skill_drafts WHERE draft_id = ?",
        [draft_id],
    )
    promoted_at, dismissed_at, dismissed_by, dismissed_reason = cur.fetchone()
    assert promoted_at is None
    assert dismissed_at is not None
    assert dismissed_by == "captain"
    assert "essential for two other customers" in dismissed_reason

    cur.execute(
        "SELECT actor, metadata FROM audit_log WHERE action_type = ?",
        ["CURATOR_DISMISSAL"],
    )
    actor, metadata_json = cur.fetchone()
    assert actor == "captain"
    metadata = json.loads(metadata_json)
    assert metadata["draft_id"] == draft_id


def test_dismiss_requires_reason():
    interceptor, _ = _make_interceptor()
    draft_id = _run(interceptor.record_draft(_sample_new_skill()))
    with pytest.raises(ValueError) as exc_info:
        _run(
            interceptor.dismiss(
                draft_id=draft_id,
                dismissed_by="captain",
                reason="",
            )
        )
    assert "reason" in str(exc_info.value)
    assert "ADR 0017 §4" in str(exc_info.value)


def test_dismiss_after_promotion_raises_state_error():
    interceptor, _ = _make_interceptor()
    draft_id = _run(interceptor.record_draft(_sample_new_skill()))
    _run(
        interceptor.promote(
            draft_id=draft_id,
            promoted_by="captain",
            pr_url="https://x/y/z",
        )
    )
    with pytest.raises(CuratorDraftStateError):
        _run(
            interceptor.dismiss(
                draft_id=draft_id,
                dismissed_by="captain",
                reason="changed mind",
            )
        )


# ---------------------------------------------------------------------------
# Constructor validation
# ---------------------------------------------------------------------------


def test_interceptor_requires_customer_slug():
    conn = _make_conn()
    executor = SqliteExecutor(conn)
    writer = AuditLogWriter(executor)
    with pytest.raises(ValueError):
        CuratorInterceptor(executor=executor, audit_writer=writer, customer="")


# ---------------------------------------------------------------------------
# Boot-time verification (ADR 0017 §_Verification_ point 2)
# ---------------------------------------------------------------------------


def test_verify_curator_intercepted_passes_with_constructed_interceptor():
    interceptor, _ = _make_interceptor()
    verify_curator_intercepted(interceptor)


def test_verify_curator_intercepted_raises_when_interceptor_missing():
    with pytest.raises(CuratorNativeWriteBlocked) as exc_info:
        verify_curator_intercepted(None)
    assert "interceptor was not constructed" in str(exc_info.value)
    assert "ADR 0017 §1" in str(exc_info.value)


def test_verify_curator_intercepted_detects_forbidden_module():
    interceptor, _ = _make_interceptor()
    sentinel = "curator_interceptor_test__forbidden_marker"
    sys.modules[sentinel] = object()  # type: ignore[assignment]
    try:
        with pytest.raises(CuratorNativeWriteBlocked) as exc_info:
            verify_curator_intercepted(
                interceptor,
                forbidden_modules=(sentinel,),
            )
        assert sentinel in str(exc_info.value)
        assert "ADR 0017" in str(exc_info.value)
    finally:
        sys.modules.pop(sentinel, None)


def test_verify_curator_intercepted_default_forbidden_list_is_clean_today():
    # Sanity check: in this test environment, none of the default forbidden
    # module names are loaded. A failure here means either a real Curator
    # writer is loaded (genuine regression) or the default list collided
    # with an unrelated module — either way the failure surfaces loud.
    interceptor, _ = _make_interceptor()
    verify_curator_intercepted(interceptor)
