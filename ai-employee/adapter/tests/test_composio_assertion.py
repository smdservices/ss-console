"""Tests for ai-employee/adapter/connectors/composio_assertion.py (issue #850).

Covers `ComposioConnectionGuard`, the refusal contract (structured
exception + INVARIANT_VIOLATION audit row), the slug-validation guard
at construction, and the headline integration test that exercises a
cross-customer Composio call refusal + audit emission end-to-end.

Run from repo root:

    cd ai-employee && python -m pytest adapter/tests/test_composio_assertion.py -v
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
    AuditLogWriter,
    AuditWriteError,
    SqliteExecutor,
)
from adapter.connectors.composio_assertion import (  # noqa: E402
    ComposioConnectionGuard,
    ComposioIsolationError,
    classify_composio_connection_id,
    composio_connection_id_for_slug_prefix,
)


# ---------------------------------------------------------------------------
# Shared fixtures (mirror test_namespace_assertion.py so the audit
# substrate setup is identical across both safety-floor tests)
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


def _make_audit_writer() -> tuple[AuditLogWriter, sqlite3.Connection]:
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_SQL)
    return AuditLogWriter(SqliteExecutor(conn)), conn


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# Slug validation at construction
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_slug",
    [
        "",
        "A",
        "ABC",
        "-leading-dash",
        "trailing-dash-",
        "has space",
        "has_underscore",
        "way-too-long-" + ("x" * 50),
        "x",
    ],
)
def test_slug_validation_rejects_invalid_slugs(bad_slug):
    with pytest.raises(ValueError, match="composio guard slug"):
        ComposioConnectionGuard(expected_slug=bad_slug)


@pytest.mark.parametrize(
    "good_slug",
    ["ab", "smd", "acme", "client-1", "client-1-prod", "a0", "0a", "a-b-c"],
)
def test_slug_validation_accepts_valid_slugs(good_slug):
    ComposioConnectionGuard(expected_slug=good_slug)


def test_prefix_helper_returns_expected_shape():
    assert composio_connection_id_for_slug_prefix("acme") == "conn_acme_"
    assert composio_connection_id_for_slug_prefix("smith-pi-firm") == "conn_smith-pi-firm_"


def test_prefix_helper_rejects_invalid_slug():
    with pytest.raises(ValueError, match="composio guard slug"):
        composio_connection_id_for_slug_prefix("BAD-SLUG")


# ---------------------------------------------------------------------------
# Connection-ID shape classification (pure function)
# ---------------------------------------------------------------------------


def test_classify_accepts_well_formed_own_slug_connection_id():
    d = classify_composio_connection_id("conn_acme_xyz-1234", "acme")
    assert d.ok is True
    assert d.found_slug == "acme"


def test_classify_accepts_long_dashed_slug():
    d = classify_composio_connection_id("conn_smith-pi-firm_abcd", "smith-pi-firm")
    assert d.ok is True
    assert d.found_slug == "smith-pi-firm"


def test_classify_rejects_empty_connection_id():
    d = classify_composio_connection_id("", "acme")
    assert d.ok is False
    assert d.found_slug is None
    assert "empty connection id" in d.reason


def test_classify_rejects_non_string_connection_id():
    d = classify_composio_connection_id(None, "acme")  # type: ignore[arg-type]
    assert d.ok is False
    assert "empty connection id" in d.reason


def test_classify_rejects_unprefixed_connection_id():
    d = classify_composio_connection_id("xyz-1234", "acme")
    assert d.ok is False
    assert "does not match" in d.reason


def test_classify_rejects_conn_prefix_without_slug_segment():
    d = classify_composio_connection_id("conn_xyz", "acme")
    assert d.ok is False
    assert "does not match" in d.reason


def test_classify_rejects_too_short_suffix():
    d = classify_composio_connection_id("conn_acme_abc", "acme")
    assert d.ok is False
    assert "does not match" in d.reason


def test_classify_rejects_foreign_slug():
    d = classify_composio_connection_id("conn_other_xyz-1234", "acme")
    assert d.ok is False
    assert d.found_slug == "other"
    assert "foreign customer slug" in d.reason


def test_classify_rejects_uppercase_slug_segment():
    d = classify_composio_connection_id("conn_ACME_xyz-1234", "acme")
    assert d.ok is False
    assert "does not match" in d.reason


# ---------------------------------------------------------------------------
# Guard — happy path
# ---------------------------------------------------------------------------


def test_guard_passes_through_own_slug_connection_id():
    guard = ComposioConnectionGuard(expected_slug="acme")
    _run(guard.assert_belongs("conn_acme_xyz-1234"))


def test_guard_exposes_expected_slug_property():
    guard = ComposioConnectionGuard(expected_slug="acme")
    assert guard.expected_slug == "acme"


# ---------------------------------------------------------------------------
# Guard — refusal paths
# ---------------------------------------------------------------------------


def test_guard_refuses_foreign_slug_connection_id():
    guard = ComposioConnectionGuard(expected_slug="acme")
    with pytest.raises(ComposioIsolationError) as excinfo:
        _run(guard.assert_belongs("conn_other_xyz-1234"))
    err = excinfo.value
    assert err.violation_kind == "composio_connection_id"
    assert err.expected_slug == "acme"
    assert err.attempted_connection_id == "conn_other_xyz-1234"
    assert "foreign customer slug" in err.detail


def test_guard_refuses_malformed_connection_id():
    guard = ComposioConnectionGuard(expected_slug="acme")
    with pytest.raises(ComposioIsolationError) as excinfo:
        _run(guard.assert_belongs("not-a-real-composio-id"))
    assert excinfo.value.violation_kind == "composio_connection_id"
    assert excinfo.value.attempted_connection_id == "not-a-real-composio-id"


def test_guard_refuses_empty_connection_id():
    guard = ComposioConnectionGuard(expected_slug="acme")
    with pytest.raises(ComposioIsolationError, match="empty connection id"):
        _run(guard.assert_belongs(""))


def test_guard_refuses_non_string_connection_id():
    guard = ComposioConnectionGuard(expected_slug="acme")
    with pytest.raises(ComposioIsolationError, match="empty connection id"):
        _run(guard.assert_belongs(None))  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Audit emission — both shape and call-site context
# ---------------------------------------------------------------------------


def test_guard_writes_audit_row_on_refusal_with_capability_and_operation():
    writer, audit_conn = _make_audit_writer()
    guard = ComposioConnectionGuard(expected_slug="acme", audit_writer=writer)

    with pytest.raises(ComposioIsolationError):
        _run(
            guard.assert_belongs(
                "conn_other_xyz-1234",
                capability="Email",
                operation="messages.send",
            )
        )

    rows = audit_conn.execute(
        "SELECT action_type, actor, metadata FROM audit_log"
    ).fetchall()
    assert len(rows) == 1
    action_type, actor, metadata_json = rows[0]
    assert action_type == "INVARIANT_VIOLATION"
    assert actor == "agent"
    meta = json.loads(metadata_json)
    assert meta["invariant"] == "composio_connection_isolation"
    assert meta["violation_kind"] == "composio_connection_id"
    assert meta["expected_slug"] == "acme"
    assert meta["attempted_connection_id"] == "conn_other_xyz-1234"
    assert meta["capability"] == "Email"
    assert meta["operation"] == "messages.send"
    assert meta["source"].endswith("composio_assertion.py")


def test_guard_emits_one_row_per_refusal_even_without_capability():
    writer, audit_conn = _make_audit_writer()
    guard = ComposioConnectionGuard(expected_slug="acme", audit_writer=writer)
    with pytest.raises(ComposioIsolationError):
        _run(guard.assert_belongs("conn_other_xyz-1234"))
    rows = audit_conn.execute("SELECT metadata FROM audit_log").fetchall()
    assert len(rows) == 1
    meta = json.loads(rows[0][0])
    assert meta["capability"] is None
    assert meta["operation"] is None


def test_guard_works_without_audit_writer():
    guard = ComposioConnectionGuard(expected_slug="acme")
    # Happy path still passes
    _run(guard.assert_belongs("conn_acme_xyz-1234"))
    # Refusal still raises (logged-only audit path)
    with pytest.raises(ComposioIsolationError):
        _run(guard.assert_belongs("conn_other_xyz-1234"))


# ---------------------------------------------------------------------------
# Audit-channel failure does not mask the refusal
# ---------------------------------------------------------------------------


class _AlwaysFailsAuditWriter:
    """Synthetic AuditLogWriter that always raises on write."""

    async def write(self, event):
        raise AuditWriteError("synthetic transport failure")


def test_refusal_still_raises_when_audit_fails():
    bad_writer = _AlwaysFailsAuditWriter()
    guard = ComposioConnectionGuard(
        expected_slug="acme",
        audit_writer=bad_writer,  # type: ignore[arg-type]
    )
    with pytest.raises(ComposioIsolationError):
        _run(guard.assert_belongs("conn_other_xyz-1234"))


# ---------------------------------------------------------------------------
# Headline AC for issue #850
# ---------------------------------------------------------------------------


def test_cross_customer_composio_attempt_refused_and_audited():
    """Issue #850 AC: integration test attempts a cross-customer Composio
    read and verifies refusal AND audit log entry.

    The scenario mirrors the threat model: customer A's Hermes Machine
    is bound to slug `acme`; a misconfigured tool call passes customer
    B's Composio connection ID. The guard must refuse and the
    per-customer audit log must carry the `INVARIANT_VIOLATION` row.
    """
    writer, audit_conn = _make_audit_writer()
    guard = ComposioConnectionGuard(expected_slug="acme", audit_writer=writer)

    foreign_connection_id = "conn_other-customer_zzzz-1111"

    with pytest.raises(ComposioIsolationError) as excinfo:
        _run(
            guard.assert_belongs(
                foreign_connection_id,
                capability="Email",
                operation="messages.list",
            )
        )

    assert excinfo.value.expected_slug == "acme"
    assert excinfo.value.attempted_connection_id == foreign_connection_id
    assert excinfo.value.violation_kind == "composio_connection_id"

    rows = audit_conn.execute(
        "SELECT action_type, actor, metadata FROM audit_log"
    ).fetchall()
    assert len(rows) == 1
    action_type, actor, metadata_json = rows[0]
    assert action_type == "INVARIANT_VIOLATION"
    assert actor == "agent"
    meta = json.loads(metadata_json)
    assert meta == {
        "invariant": "composio_connection_isolation",
        "violation_kind": "composio_connection_id",
        "expected_slug": "acme",
        "attempted_connection_id": foreign_connection_id,
        "capability": "Email",
        "operation": "messages.list",
        "source": "ai-employee/adapter/connectors/composio_assertion.py",
    }
