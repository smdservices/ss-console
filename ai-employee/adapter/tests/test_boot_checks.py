"""Tests for ai-employee/adapter/boot_checks.py (ADR 0018).

Covers the GEPA boot-time disable verification: the check passes when no
forbidden GEPA module is loaded, emits the documented audit row, raises
GepaEnabledError when any forbidden module is detected, and rejects an
audit_writer call without a customer slug.

Run from ai-employee/ directory:

    cd ai-employee && python -m pytest adapter/tests/test_boot_checks.py -v
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
from adapter.boot_checks import (  # noqa: E402
    GepaEnabledError,
    verify_gepa_disabled,
)


# ---------------------------------------------------------------------------
# Schema + writer helpers
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


def _make_writer() -> tuple[AuditLogWriter, sqlite3.Connection]:
    conn = sqlite3.connect(":memory:")
    conn.executescript(_AUDIT_LOG_SCHEMA)
    writer = AuditLogWriter(SqliteExecutor(conn))
    return writer, conn


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# Audit action_type registration (ADR 0018 §4)
# ---------------------------------------------------------------------------


def test_audit_action_type_registered_in_accepted_set():
    # Per ADR 0018 §4, the writer must accept GEPA_DISABLED_VERIFIED.
    # If a future refactor renames or removes it from ACCEPTED_ACTION_TYPES,
    # verify_gepa_disabled's audit-emit call will start raising ValueError
    # and this test catches the regression first.
    assert "GEPA_DISABLED_VERIFIED" in ACCEPTED_ACTION_TYPES


# ---------------------------------------------------------------------------
# Default-path passes (no GEPA loaded in the test environment)
# ---------------------------------------------------------------------------


def test_verify_gepa_disabled_passes_when_no_forbidden_module_loaded():
    # In this test environment, none of the default _FORBIDDEN_GEPA_MODULES
    # are loaded, so verify_gepa_disabled is a no-op (no audit_writer
    # supplied → no audit row emitted; returns None).
    result = _run(verify_gepa_disabled())
    assert result is None


def test_verify_gepa_disabled_emits_audit_row_on_success():
    writer, conn = _make_writer()
    _run(verify_gepa_disabled(audit_writer=writer, customer="acme-pi"))

    cur = conn.cursor()
    cur.execute(
        "SELECT action_type, actor, actor_role, metadata FROM audit_log "
        "WHERE action_type = ?",
        ["GEPA_DISABLED_VERIFIED"],
    )
    row = cur.fetchone()
    assert row is not None
    action_type, actor, actor_role, metadata_json = row
    assert action_type == "GEPA_DISABLED_VERIFIED"
    assert actor == "agent"
    assert actor_role == "agent"
    metadata = json.loads(metadata_json)
    assert metadata["customer"] == "acme-pi"
    assert metadata["loaded_forbidden_count"] == 0
    # forbidden_modules_checked is recorded for audit-trail introspection —
    # operators can confirm WHICH names the check covered at boot time.
    assert isinstance(metadata["forbidden_modules_checked"], list)
    assert len(metadata["forbidden_modules_checked"]) > 0


def test_verify_gepa_disabled_default_forbidden_list_is_clean_today():
    # Belt-and-suspenders: the default _FORBIDDEN_GEPA_MODULES list does
    # not collide with any module loaded in the test environment. A failure
    # here is either a real regression (a GEPA module landed) or the
    # default list collided with an unrelated module — either way the
    # failure surfaces loud.
    _run(verify_gepa_disabled())


# ---------------------------------------------------------------------------
# Failure path: forbidden module detected
# ---------------------------------------------------------------------------


def test_verify_gepa_disabled_raises_when_forbidden_module_loaded():
    # Inject a sentinel forbidden module name into sys.modules; the verify
    # call should raise. We use a name that cannot collide with a real
    # module to keep the test hermetic.
    sentinel = "boot_checks_test__gepa_forbidden_marker"
    sys.modules[sentinel] = object()  # type: ignore[assignment]
    try:
        with pytest.raises(GepaEnabledError) as exc_info:
            _run(verify_gepa_disabled(forbidden_modules=(sentinel,)))
        assert sentinel in str(exc_info.value)
        assert "ADR 0018" in str(exc_info.value)
        assert "disabled in the SMD overlay" in str(exc_info.value)
    finally:
        sys.modules.pop(sentinel, None)


def test_verify_gepa_disabled_lists_all_offending_modules_in_error():
    # When multiple forbidden modules are loaded, the error message names
    # all of them so the operator can triage the full scope at once.
    sentinels = (
        "boot_checks_test__gepa_marker_a",
        "boot_checks_test__gepa_marker_b",
        "boot_checks_test__gepa_marker_c",
    )
    for s in sentinels:
        sys.modules[s] = object()  # type: ignore[assignment]
    try:
        with pytest.raises(GepaEnabledError) as exc_info:
            _run(verify_gepa_disabled(forbidden_modules=sentinels))
        msg = str(exc_info.value)
        for s in sentinels:
            assert s in msg
    finally:
        for s in sentinels:
            sys.modules.pop(s, None)


def test_verify_gepa_disabled_does_not_emit_audit_row_on_failure():
    # A failed disable check halts Machine boot per ADR 0018 §1 — it does
    # not write an audit row. Sticky-stop is the operational notification
    # surface for the halt per ADR 0018 §4.
    writer, conn = _make_writer()
    sentinel = "boot_checks_test__gepa_no_audit_marker"
    sys.modules[sentinel] = object()  # type: ignore[assignment]
    try:
        with pytest.raises(GepaEnabledError):
            _run(
                verify_gepa_disabled(
                    audit_writer=writer,
                    customer="acme-pi",
                    forbidden_modules=(sentinel,),
                )
            )

        # The audit_log table should be empty: the failure path raises
        # before any audit emission.
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM audit_log")
        assert cur.fetchone()[0] == 0
    finally:
        sys.modules.pop(sentinel, None)


# ---------------------------------------------------------------------------
# Argument validation
# ---------------------------------------------------------------------------


def test_audit_writer_without_customer_raises_value_error():
    writer, _ = _make_writer()
    with pytest.raises(ValueError) as exc_info:
        _run(verify_gepa_disabled(audit_writer=writer, customer=None))
    assert "customer" in str(exc_info.value)


def test_audit_writer_with_empty_customer_raises_value_error():
    writer, _ = _make_writer()
    with pytest.raises(ValueError):
        _run(verify_gepa_disabled(audit_writer=writer, customer=""))


def test_no_audit_writer_no_customer_is_legal_unit_test_path():
    # The unit-test path: caller has no writer wired yet. The check still
    # runs and returns None on success — only the audit-emission step is
    # skipped. This is the shape `bootstrap.sh` would use during a dry-run
    # or self-test.
    _run(verify_gepa_disabled())


# ---------------------------------------------------------------------------
# ADR 0018 §1 surface coverage — sanity check the default list shape
# ---------------------------------------------------------------------------


def test_default_forbidden_list_covers_three_subsystems_named_in_adr():
    # ADR 0018 §1 enumerates three GEPA subsystems the overlay must confirm
    # inactive: trace-analysis loop, constraint-gate checking, PR-generation
    # path. The default forbidden module list names all three plus the
    # umbrella module and the hermes-namespaced variants.
    from adapter.boot_checks import _FORBIDDEN_GEPA_MODULES

    joined = " ".join(_FORBIDDEN_GEPA_MODULES)
    assert "trace_analysis" in joined  # ADR 0018 §1 item 1
    assert "constraint_gates" in joined  # ADR 0018 §1 item 2
    assert "pr_generation" in joined or "pr_emitter" in joined  # ADR 0018 §1 item 3
    assert "gepa" in joined  # umbrella name
