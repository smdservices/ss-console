"""Tests for ai-employee/adapter/honcho_interceptor.py (ADR 0016).

Covers the proposer-only contract: every observation lands in
`persona_observations` with source-evidence, every write emits the
matching audit row, promotion and dismissal stamp the row idempotently,
and boot-time verification halts the Machine if a competing Honcho
write surface is detected.

Run from ai-employee/ directory:

    cd ai-employee && python -m pytest adapter/tests/test_honcho_interceptor.py -v
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
from adapter.honcho_interceptor import (  # noqa: E402
    HonchoEvidenceRequired,
    HonchoInterceptor,
    HonchoNativeWriteBlocked,
    HonchoObservation,
    HonchoObservationStateError,
    ObservationType,
    verify_honcho_intercepted,
)


# ---------------------------------------------------------------------------
# Schema helpers — mirror the migration's tables for end-to-end tests
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


_PERSONA_OBSERVATIONS_SCHEMA = """
CREATE TABLE persona_observations (
  observation_id        TEXT PRIMARY KEY,
  persona_slug          TEXT,
  observation_type      TEXT NOT NULL,
  observation_body      TEXT NOT NULL,
  source_evidence_json  TEXT NOT NULL,
  confidence            REAL,
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
    conn.executescript(_PERSONA_OBSERVATIONS_SCHEMA)
    return conn


def _make_interceptor(customer: str = "test-firm") -> tuple[HonchoInterceptor, sqlite3.Connection]:
    conn = _make_conn()
    executor = SqliteExecutor(conn)
    writer = AuditLogWriter(executor)
    interceptor = HonchoInterceptor(
        executor=executor,
        audit_writer=writer,
        customer=customer,
    )
    return interceptor, conn


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _sample_observation(**overrides) -> HonchoObservation:
    defaults = {
        "observation_type": ObservationType.PREFERENCE_SIGNAL,
        "observation_body": {"pattern": "short intro paragraphs", "samples_n": 4},
        "source_evidence": ["msg-abc", "msg-def", "audit-log-ulid-xyz"],
        "persona_slug": "marcus",
        "confidence": 0.78,
    }
    defaults.update(overrides)
    return HonchoObservation(**defaults)


# ---------------------------------------------------------------------------
# Audit action_type registration (ADR 0016 §7)
# ---------------------------------------------------------------------------


def test_audit_action_types_registered_in_accepted_set():
    # Per ADR 0016 §7, the writer must accept the three Honcho action_types.
    # If a future refactor renames or removes any of these from
    # ACCEPTED_ACTION_TYPES, the interceptor's audit-emit calls will start
    # raising ValueError and this test will catch the regression first.
    assert "HONCHO_OBSERVATION" in ACCEPTED_ACTION_TYPES
    assert "HONCHO_PROMOTION" in ACCEPTED_ACTION_TYPES
    assert "HONCHO_DISMISSAL" in ACCEPTED_ACTION_TYPES


# ---------------------------------------------------------------------------
# Observation creation
# ---------------------------------------------------------------------------


def test_record_observation_inserts_row_and_returns_ulid():
    interceptor, conn = _make_interceptor()
    obs = _sample_observation()
    observation_id = _run(interceptor.record_observation(obs))

    # ULID shape: 26 chars, Crockford-base32
    assert isinstance(observation_id, str)
    assert len(observation_id) == 26

    cur = conn.cursor()
    cur.execute(
        "SELECT persona_slug, observation_type, observation_body, "
        "source_evidence_json, confidence FROM persona_observations "
        "WHERE observation_id = ?",
        [observation_id],
    )
    row = cur.fetchone()
    assert row is not None
    persona_slug, obs_type, body_json, evidence_json, confidence = row
    assert persona_slug == "marcus"
    assert obs_type == ObservationType.PREFERENCE_SIGNAL.value
    assert json.loads(body_json) == {"pattern": "short intro paragraphs", "samples_n": 4}
    # List ordering preserved — json.dumps sort_keys=True only orders dict keys.
    assert json.loads(evidence_json) == ["msg-abc", "msg-def", "audit-log-ulid-xyz"]
    assert abs(confidence - 0.78) < 1e-9


def test_record_observation_emits_audit_row():
    interceptor, conn = _make_interceptor(customer="acme-pi")
    obs = _sample_observation()
    observation_id = _run(interceptor.record_observation(obs))

    cur = conn.cursor()
    cur.execute(
        "SELECT action_type, actor, actor_role, metadata FROM audit_log "
        "WHERE action_type = ?",
        ["HONCHO_OBSERVATION"],
    )
    row = cur.fetchone()
    assert row is not None
    action_type, actor, actor_role, metadata_json = row
    assert action_type == "HONCHO_OBSERVATION"
    assert actor == "agent"
    assert actor_role == "agent"
    metadata = json.loads(metadata_json)
    assert metadata["customer"] == "acme-pi"
    assert metadata["observation_id"] == observation_id
    assert metadata["observation_type"] == ObservationType.PREFERENCE_SIGNAL.value
    assert metadata["persona_slug"] == "marcus"
    assert metadata["evidence_count"] == 3


def test_record_observation_accepts_null_persona_slug_for_customer_scope():
    interceptor, conn = _make_interceptor()
    obs = _sample_observation(persona_slug=None)
    observation_id = _run(interceptor.record_observation(obs))

    cur = conn.cursor()
    cur.execute(
        "SELECT persona_slug FROM persona_observations WHERE observation_id = ?",
        [observation_id],
    )
    assert cur.fetchone()[0] is None


# ---------------------------------------------------------------------------
# Fabrication discipline (ADR 0016 §5)
# ---------------------------------------------------------------------------


def test_observation_without_evidence_raises_before_sql():
    interceptor, conn = _make_interceptor()
    obs = _sample_observation(source_evidence=[])
    with pytest.raises(HonchoEvidenceRequired) as exc_info:
        _run(interceptor.record_observation(obs))
    assert "source_evidence" in str(exc_info.value)
    assert "ADR 0016" in str(exc_info.value)

    # And no rows landed in either table.
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM persona_observations")
    assert cur.fetchone()[0] == 0
    cur.execute("SELECT COUNT(*) FROM audit_log")
    assert cur.fetchone()[0] == 0


def test_check_constraint_rejects_empty_evidence_at_db_layer():
    # Belt-and-suspenders: even if a caller bypassed the runtime check
    # (e.g., by writing directly through the executor), the CHECK constraint
    # in migration 0007 rejects the row. We exercise the DB layer directly
    # to confirm the constraint is present in the schema mirror.
    conn = _make_conn()
    cur = conn.cursor()
    with pytest.raises(sqlite3.IntegrityError):
        cur.execute(
            "INSERT INTO persona_observations "
            "(observation_id, observation_type, observation_body, source_evidence_json) "
            "VALUES (?, ?, ?, ?)",
            ["test-id", "preference_signal", "{}", ""],
        )


# ---------------------------------------------------------------------------
# Promotion (ADR 0016 §3)
# ---------------------------------------------------------------------------


def test_promote_stamps_row_and_emits_audit_event():
    interceptor, conn = _make_interceptor()
    observation_id = _run(interceptor.record_observation(_sample_observation()))

    pr_url = "https://github.com/venturecrane/customer-configs/pull/42"
    _run(
        interceptor.promote(
            observation_id=observation_id,
            promoted_by="partner-jdoe",
            pr_url=pr_url,
        )
    )

    cur = conn.cursor()
    cur.execute(
        "SELECT promoted_at, promoted_by, promoted_pr_url, dismissed_at "
        "FROM persona_observations WHERE observation_id = ?",
        [observation_id],
    )
    promoted_at, promoted_by, promoted_pr_url, dismissed_at = cur.fetchone()
    assert promoted_at is not None
    assert promoted_by == "partner-jdoe"
    assert promoted_pr_url == pr_url
    assert dismissed_at is None

    cur.execute(
        "SELECT actor, actor_role, metadata FROM audit_log "
        "WHERE action_type = ?",
        ["HONCHO_PROMOTION"],
    )
    actor, actor_role, metadata_json = cur.fetchone()
    assert actor == "partner-jdoe"
    assert actor_role == "principal"
    metadata = json.loads(metadata_json)
    assert metadata["observation_id"] == observation_id
    assert metadata["promoted_pr_url"] == pr_url


def test_promote_requires_pr_url():
    interceptor, _ = _make_interceptor()
    observation_id = _run(interceptor.record_observation(_sample_observation()))
    with pytest.raises(ValueError) as exc_info:
        _run(
            interceptor.promote(
                observation_id=observation_id,
                promoted_by="partner-jdoe",
                pr_url="",
            )
        )
    assert "pr_url" in str(exc_info.value)
    assert "ADR 0016 §3" in str(exc_info.value)


def test_promote_requires_promoted_by():
    interceptor, _ = _make_interceptor()
    observation_id = _run(interceptor.record_observation(_sample_observation()))
    with pytest.raises(ValueError):
        _run(
            interceptor.promote(
                observation_id=observation_id,
                promoted_by="",
                pr_url="https://x/y/z",
            )
        )


def test_promote_unknown_observation_raises_state_error():
    interceptor, _ = _make_interceptor()
    with pytest.raises(HonchoObservationStateError) as exc_info:
        _run(
            interceptor.promote(
                observation_id="01HX0000000000000000000000",
                promoted_by="partner-jdoe",
                pr_url="https://x/y/z",
            )
        )
    assert "not found" in str(exc_info.value)


def test_promote_idempotency_second_call_raises():
    interceptor, _ = _make_interceptor()
    observation_id = _run(interceptor.record_observation(_sample_observation()))
    _run(
        interceptor.promote(
            observation_id=observation_id,
            promoted_by="partner-jdoe",
            pr_url="https://x/y/first",
        )
    )
    with pytest.raises(HonchoObservationStateError) as exc_info:
        _run(
            interceptor.promote(
                observation_id=observation_id,
                promoted_by="partner-jdoe",
                pr_url="https://x/y/second",
            )
        )
    assert "terminal state" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Dismissal (ADR 0016 §4)
# ---------------------------------------------------------------------------


def test_dismiss_stamps_row_and_emits_audit_event():
    interceptor, conn = _make_interceptor()
    observation_id = _run(interceptor.record_observation(_sample_observation()))

    _run(
        interceptor.dismiss(
            observation_id=observation_id,
            dismissed_by="captain",
            reason="duplicate of earlier observation; will roll up at next calibration",
        )
    )

    cur = conn.cursor()
    cur.execute(
        "SELECT promoted_at, dismissed_at, dismissed_by, dismissed_reason "
        "FROM persona_observations WHERE observation_id = ?",
        [observation_id],
    )
    promoted_at, dismissed_at, dismissed_by, dismissed_reason = cur.fetchone()
    assert promoted_at is None
    assert dismissed_at is not None
    assert dismissed_by == "captain"
    assert "duplicate" in dismissed_reason

    cur.execute(
        "SELECT actor, metadata FROM audit_log WHERE action_type = ?",
        ["HONCHO_DISMISSAL"],
    )
    actor, metadata_json = cur.fetchone()
    assert actor == "captain"
    metadata = json.loads(metadata_json)
    assert metadata["observation_id"] == observation_id


def test_dismiss_requires_reason():
    interceptor, _ = _make_interceptor()
    observation_id = _run(interceptor.record_observation(_sample_observation()))
    with pytest.raises(ValueError) as exc_info:
        _run(
            interceptor.dismiss(
                observation_id=observation_id,
                dismissed_by="captain",
                reason="",
            )
        )
    assert "reason" in str(exc_info.value)
    assert "ADR 0016 §4" in str(exc_info.value)


def test_dismiss_after_promotion_raises_state_error():
    interceptor, _ = _make_interceptor()
    observation_id = _run(interceptor.record_observation(_sample_observation()))
    _run(
        interceptor.promote(
            observation_id=observation_id,
            promoted_by="partner-jdoe",
            pr_url="https://x/y/z",
        )
    )
    with pytest.raises(HonchoObservationStateError):
        _run(
            interceptor.dismiss(
                observation_id=observation_id,
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
        HonchoInterceptor(executor=executor, audit_writer=writer, customer="")


# ---------------------------------------------------------------------------
# Boot-time verification (ADR 0016 §_Verification_ point 2)
# ---------------------------------------------------------------------------


def test_verify_honcho_intercepted_passes_with_constructed_interceptor():
    interceptor, _ = _make_interceptor()
    # No forbidden modules loaded → returns None (passes)
    verify_honcho_intercepted(interceptor)


def test_verify_honcho_intercepted_raises_when_interceptor_missing():
    with pytest.raises(HonchoNativeWriteBlocked) as exc_info:
        verify_honcho_intercepted(None)
    assert "interceptor was not constructed" in str(exc_info.value)
    assert "ADR 0016 §1" in str(exc_info.value)


def test_verify_honcho_intercepted_detects_forbidden_module():
    # Inject a sentinel forbidden module name into sys.modules; the verify
    # call should raise. We use a name that cannot collide with a real
    # module to keep the test hermetic.
    interceptor, _ = _make_interceptor()
    sentinel = "honcho_interceptor_test__forbidden_marker"
    sys.modules[sentinel] = object()  # type: ignore[assignment]
    try:
        with pytest.raises(HonchoNativeWriteBlocked) as exc_info:
            verify_honcho_intercepted(
                interceptor,
                forbidden_modules=(sentinel,),
            )
        assert sentinel in str(exc_info.value)
        assert "ADR 0016" in str(exc_info.value)
    finally:
        sys.modules.pop(sentinel, None)


def test_verify_honcho_intercepted_default_forbidden_list_is_clean_today():
    # Sanity check: in this test environment, none of the default
    # forbidden module names are loaded. A failure here means either a
    # real Honcho writer is loaded (genuine regression) or the default
    # list collided with an unrelated module — either way the failure
    # surfaces loud.
    interceptor, _ = _make_interceptor()
    verify_honcho_intercepted(interceptor)
