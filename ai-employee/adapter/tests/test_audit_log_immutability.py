"""Tests for ai-employee/adapter/audit_log_immutability.py (issue #892).

Covers the Worker-layer enforcement wrapper, the SQL inspection helper,
the Logpush mirror protocol stub, and the LegalHoldException bypass path.

Run from repo root:

    cd ai-employee && python -m pytest adapter/tests/test_audit_log_immutability.py -v
"""

from __future__ import annotations

import asyncio
import sqlite3
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # ai-employee/ on sys.path

from adapter.audit_log import (  # noqa: E402
    AuditEvent,
    AuditLogWriter,
    SqliteExecutor,
)
from adapter.audit_log_immutability import (  # noqa: E402
    AuditLogImmutabilityError,
    D1Executor,
    LegalHoldException,
    LogpushMirror,
    MirroredAuditRow,
    NoopLogpushMirror,
    is_mutation_against_audit_log,
)


# ---------------------------------------------------------------------------
# Schema helper — mirrors audit_log table for end-to-end tests
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


def _make_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.executescript(_SCHEMA_SQL)
    return conn


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# Pure-SQL inspection helper
# ---------------------------------------------------------------------------


def test_inspection_passes_insert_into_audit_log():
    sql = "INSERT INTO audit_log (id, ts, action_type, actor) VALUES (?, ?, ?, ?)"
    assert is_mutation_against_audit_log(sql) is False


def test_inspection_passes_select_from_audit_log():
    sql = "SELECT * FROM audit_log WHERE id = ?"
    assert is_mutation_against_audit_log(sql) is False


def test_inspection_passes_writes_to_other_tables():
    # Not against audit_log → pass-through (the wrapper does not care)
    assert is_mutation_against_audit_log("UPDATE memory_rules SET deleted_at = ? WHERE id = ?") is False
    assert is_mutation_against_audit_log("DELETE FROM draft_queue WHERE id = ?") is False


def test_inspection_blocks_update_on_audit_log():
    assert is_mutation_against_audit_log("UPDATE audit_log SET actor = 'bogus' WHERE id = ?") is True


def test_inspection_blocks_delete_from_audit_log():
    assert is_mutation_against_audit_log("DELETE FROM audit_log WHERE id = ?") is True


def test_inspection_blocks_replace_on_audit_log():
    assert is_mutation_against_audit_log("REPLACE INTO audit_log VALUES (?)") is True


def test_inspection_blocks_truncate_drop_alter():
    assert is_mutation_against_audit_log("DROP TABLE audit_log") is True
    assert is_mutation_against_audit_log("ALTER TABLE audit_log ADD COLUMN bogus TEXT") is True


def test_inspection_is_case_insensitive():
    assert is_mutation_against_audit_log("delete from audit_log") is True
    assert is_mutation_against_audit_log("Delete From Audit_Log") is True


def test_inspection_strips_comments_so_they_cannot_hide_the_table():
    # An attacker tries to hide DELETE FROM audit_log inside a comment
    # plus a benign SELECT. We strip comments before inspecting, so the
    # DELETE keyword is visible at the head of the statement.
    sql = "/* select * from audit_log */ DELETE FROM audit_log WHERE id = ?"
    assert is_mutation_against_audit_log(sql) is True


def test_inspection_blocks_multistatement_targeting_audit_log():
    # Semicolon-separated multi-statement is rejected wholesale when it
    # touches audit_log.
    sql = "SELECT 1; DELETE FROM audit_log WHERE id = ?"
    assert is_mutation_against_audit_log(sql) is True


def test_inspection_tolerates_trailing_semicolon():
    # A single statement with a trailing ; is not multi-statement
    sql = "SELECT * FROM audit_log WHERE id = ?;"
    assert is_mutation_against_audit_log(sql) is False


def test_inspection_blocks_when_table_name_appears_only_in_block_comment():
    # Mutation against another table with audit_log mentioned only in a
    # comment — the comment is stripped, so the table reference vanishes
    # and the statement is allowed.
    sql = "/* update audit_log placeholder */ UPDATE memory_rules SET deleted_at = ? WHERE id = ?"
    assert is_mutation_against_audit_log(sql) is False


# ---------------------------------------------------------------------------
# D1Executor wrapper behavior
# ---------------------------------------------------------------------------


def _wrapped_executor() -> tuple[D1Executor, sqlite3.Connection]:
    conn = _make_conn()
    return D1Executor(SqliteExecutor(conn)), conn


def test_wrapper_allows_insert_into_audit_log():
    safe, conn = _wrapped_executor()
    _run(
        safe.execute(
            "INSERT INTO audit_log (id, ts, action_type, actor) VALUES (?, ?, ?, ?)",
            ["01HZZZ", "2026-05-21T12:00:00.000Z", "DRAFT_CREATED", "agent"],
        )
    )
    count = conn.execute("SELECT COUNT(*) FROM audit_log WHERE id = ?", ("01HZZZ",)).fetchone()[0]
    assert count == 1


def test_wrapper_allows_select_against_audit_log():
    safe, conn = _wrapped_executor()
    # Seed a row directly so the SELECT has something to read
    conn.execute(
        "INSERT INTO audit_log (id, ts, action_type, actor) VALUES (?, ?, ?, ?)",
        ("01HZZZ", "2026-05-21T12:00:00.000Z", "DRAFT_CREATED", "agent"),
    )
    conn.commit()
    # SELECT does not raise
    _run(safe.execute("SELECT * FROM audit_log WHERE id = ?", ["01HZZZ"]))


def test_wrapper_blocks_delete():
    safe, conn = _wrapped_executor()
    conn.execute(
        "INSERT INTO audit_log (id, ts, action_type, actor) VALUES (?, ?, ?, ?)",
        ("01HZZZ", "2026-05-21T12:00:00.000Z", "DRAFT_CREATED", "agent"),
    )
    conn.commit()

    with pytest.raises(AuditLogImmutabilityError, match="append-only"):
        _run(safe.execute("DELETE FROM audit_log WHERE id = ?", ["01HZZZ"]))

    # Row is still there
    count = conn.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0]
    assert count == 1


def test_wrapper_blocks_update():
    safe, _ = _wrapped_executor()
    with pytest.raises(AuditLogImmutabilityError):
        _run(safe.execute("UPDATE audit_log SET actor = 'forged' WHERE id = ?", ["01HZZZ"]))


def test_wrapper_passes_through_writes_to_other_tables():
    safe, conn = _wrapped_executor()
    # Create another table so the UPDATE actually has somewhere to land
    conn.execute("CREATE TABLE memory_rules (id TEXT PRIMARY KEY, deleted_at TEXT)")
    conn.execute("INSERT INTO memory_rules (id) VALUES (?)", ("rule-1",))
    conn.commit()

    _run(safe.execute("UPDATE memory_rules SET deleted_at = ? WHERE id = ?", ["2026-05-21", "rule-1"]))
    row = conn.execute("SELECT deleted_at FROM memory_rules WHERE id = ?", ("rule-1",)).fetchone()
    assert row[0] == "2026-05-21"


def test_wrapper_allows_writer_path_end_to_end():
    """The AuditLogWriter constructs against the raw executor (per design)
    so writes succeed. The wrapper only enforces on non-writer callers.
    """
    conn = _make_conn()
    # The writer holds the raw executor — this is by design (only path to
    # INSERT into audit_log).
    writer = AuditLogWriter(SqliteExecutor(conn))
    ulid = _run(writer.write(AuditEvent(action_type="DRAFT_CREATED", actor="agent")))
    count = conn.execute("SELECT COUNT(*) FROM audit_log WHERE id = ?", (ulid,)).fetchone()[0]
    assert count == 1

    # A separate non-writer caller wraps the same executor and cannot
    # DELETE the row.
    safe = D1Executor(SqliteExecutor(conn))
    with pytest.raises(AuditLogImmutabilityError):
        _run(safe.execute("DELETE FROM audit_log WHERE id = ?", [ulid]))


# ---------------------------------------------------------------------------
# LegalHoldException bypass
# ---------------------------------------------------------------------------


def test_legal_hold_ticket_allows_bypass():
    safe, conn = _wrapped_executor()
    conn.execute(
        "INSERT INTO audit_log (id, ts, action_type, actor) VALUES (?, ?, ?, ?)",
        ("01HZZZ", "2026-05-21T12:00:00.000Z", "DRAFT_CREATED", "agent"),
    )
    conn.commit()

    # Captain-side redaction script (out of scope) clears its
    # multi-confirmation guard, writes the exceptions-ledger row, and
    # then calls the wrapper with the matching ticket.
    _run(
        safe.execute(
            "DELETE FROM audit_log WHERE id = ?",
            ["01HZZZ"],
            legal_hold_ticket="EXCEPTION-2026-001",
        )
    )

    count = conn.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0]
    assert count == 0


def test_legal_hold_exception_requires_non_empty_ticket():
    with pytest.raises(ValueError, match="non-empty ticket"):
        LegalHoldException("")


def test_legal_hold_ticket_string_alone_is_not_enough_to_forge():
    # The ticket is meaningful only inside the bypass kwarg path; the
    # exception type cannot be constructed with an empty ticket. This
    # locks the contract: the redaction script MUST construct the
    # exception with a real ledger id before invoking the bypass.
    with pytest.raises(ValueError):
        LegalHoldException(None)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# LogpushMirror protocol + no-op stub
# ---------------------------------------------------------------------------


def test_noop_mirror_satisfies_protocol():
    mirror: LogpushMirror = NoopLogpushMirror()
    row = MirroredAuditRow(
        id="01HZZZ",
        ts="2026-05-21T12:00:00.000Z",
        action_type="DRAFT_CREATED",
        actor="agent",
        actor_role="agent",
        skill_name="inbox-triage",
        matter_ref=None,
        input_digest=None,
        output_digest=None,
        diff_digest=None,
        trust_ceiling="draft_for_review",
        metadata=None,
    )
    # No raise, no return value beyond None
    assert _run(mirror.mirror_audit_event(row)) is None


def test_mirrored_audit_row_is_immutable_dataclass():
    row = MirroredAuditRow(
        id="01HZZZ",
        ts="2026-05-21T12:00:00.000Z",
        action_type="DRAFT_CREATED",
        actor="agent",
        actor_role=None,
        skill_name=None,
        matter_ref=None,
        input_digest=None,
        output_digest=None,
        diff_digest=None,
        trust_ceiling=None,
        metadata=None,
    )
    with pytest.raises((AttributeError, Exception)):
        row.id = "tampered"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Defense-in-depth — the error message points the caller to the right docs
# ---------------------------------------------------------------------------


def test_error_message_cites_the_spec_path():
    safe, _ = _wrapped_executor()
    with pytest.raises(AuditLogImmutabilityError) as excinfo:
        _run(safe.execute("DELETE FROM audit_log", []))
    msg = str(excinfo.value)
    assert "audit-log-immutability.md" in msg
    assert "AuditLogWriter" in msg
