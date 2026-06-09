"""Migration 0010 — voice_corrections table (A2 preference capture).

Verifies the table, its CHECK constraints, the `active` generated column
(driven by superseded_by), the two indexes, and the version bump, applied
against a clean SQLite database that ran migrations 0001..0009 first.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = REPO_ROOT / "operator" / "migrations"


def _connect_with_migrations(through: int) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    for n in range(1, through + 1):
        path = next(MIGRATIONS_DIR.glob(f"{n:04d}_*.sql"))
        conn.executescript(path.read_text(encoding="utf-8"))
    conn.commit()
    return conn


def _columns(conn: sqlite3.Connection) -> dict[str, dict]:
    rows = conn.execute("PRAGMA table_info(voice_corrections)").fetchall()
    return {r[1]: {"type": r[2], "notnull": bool(r[3]), "dflt": r[4]} for r in rows}


def _indexes(conn: sqlite3.Connection) -> set[str]:
    rows = conn.execute("PRAGMA index_list(voice_corrections)").fetchall()
    return {r[1] for r in rows}


def _insert(conn: sqlite3.Connection, **over) -> None:
    row = {
        "id": "01HVOICE0000000000000000AA",
        "customer_slug": "pilot-law",
        "correction_kind": "lexical",
        "pattern_kind": "literal_ci",
        "before_pattern": "pursuant to",
        "after_text": "under",
        "reviewer_user_id": None,
        "recipient_cohort": None,
        "priority": 0,
        "source": "calibration_session",
        "source_ref": None,
        "superseded_by": None,
    }
    row.update(over)
    conn.execute(
        """
        INSERT INTO voice_corrections
          (id, customer_slug, correction_kind, pattern_kind, before_pattern,
           after_text, reviewer_user_id, recipient_cohort, priority, source,
           source_ref, superseded_by)
        VALUES (:id, :customer_slug, :correction_kind, :pattern_kind,
                :before_pattern, :after_text, :reviewer_user_id,
                :recipient_cohort, :priority, :source, :source_ref,
                :superseded_by)
        """,
        row,
    )


def test_table_and_columns_present() -> None:
    conn = _connect_with_migrations(10)
    cols = _columns(conn)
    for name in (
        "id",
        "customer_slug",
        "correction_kind",
        "pattern_kind",
        "before_pattern",
        "after_text",
        "reviewer_user_id",
        "recipient_cohort",
        "priority",
        "source",
        "source_ref",
        "created_at",
        "superseded_by",
        # `active` is a VIRTUAL generated column — not listed by table_info on
        # this SQLite; its behavior is locked by
        # test_active_generated_column_tracks_superseded_by below.
    ):
        assert name in cols, name
    assert cols["after_text"]["notnull"] is True
    assert cols["reviewer_user_id"]["notnull"] is False  # NULL = firm-wide
    assert cols["recipient_cohort"]["notnull"] is False  # NULL = all cohorts


def test_indexes_added() -> None:
    idx = _indexes(_connect_with_migrations(10))
    assert "voice_corrections_active_scope" in idx
    assert "voice_corrections_by_created" in idx


def test_active_generated_column_tracks_superseded_by() -> None:
    conn = _connect_with_migrations(10)
    _insert(conn, id="a", superseded_by=None)
    _insert(conn, id="b", before_pattern="hereinafter", after_text="from now on", superseded_by="a")
    conn.commit()
    rows = dict(conn.execute("SELECT id, active FROM voice_corrections").fetchall())
    assert rows["a"] == 1  # not superseded → active
    assert rows["b"] == 0  # superseded → inactive


def test_check_rejects_bad_correction_kind() -> None:
    conn = _connect_with_migrations(10)
    try:
        _insert(conn, correction_kind="semantic")  # not in the closed set
        conn.commit()
        raise AssertionError("expected CHECK violation for correction_kind")
    except sqlite3.IntegrityError as e:
        assert "constraint" in str(e).lower() or "CHECK" in str(e)


def test_check_rejects_bad_pattern_kind() -> None:
    conn = _connect_with_migrations(10)
    try:
        _insert(conn, pattern_kind="glob")
        conn.commit()
        raise AssertionError("expected CHECK violation for pattern_kind")
    except sqlite3.IntegrityError as e:
        assert "constraint" in str(e).lower() or "CHECK" in str(e)


def test_check_rejects_bad_source() -> None:
    conn = _connect_with_migrations(10)
    try:
        _insert(conn, source="model_guess")
        conn.commit()
        raise AssertionError("expected CHECK violation for source")
    except sqlite3.IntegrityError as e:
        assert "constraint" in str(e).lower() or "CHECK" in str(e)


def test_each_valid_kind_accepted() -> None:
    conn = _connect_with_migrations(10)
    for i, kind in enumerate(("greeting", "signoff", "honorific", "lexical")):
        _insert(conn, id=f"k{i}", correction_kind=kind, before_pattern=f"p{i}", after_text=f"a{i}")
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM voice_corrections").fetchone()[0]
    assert n == 4


def test_schema_version_bumped_to_10() -> None:
    v = _connect_with_migrations(10).execute("PRAGMA user_version").fetchone()[0]
    assert v == 10
