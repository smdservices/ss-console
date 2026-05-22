"""End-to-end tests for bin/lib/export.py (issue #862).

Covers:

* The orchestrator composes memory + voice exports into one tar.gz
  archive on disk.
* The archive contains every artifact the per-domain exports wrote,
  in the same paths.
* Two ``COMPLIANCE_PACKET_EXPORTED`` audit rows land: one
  ``memory_export.initiated`` before, one ``memory_export.completed``
  after, with the full :class:`ExportRunSummary` in metadata.
* On export-module failure the orchestrator raises
  :class:`ExportFailed` and writes a ``memory_export.failed`` audit row.
* ``run_export_for_decommission`` is a thin wrapper that surfaces the
  same exceptions so the decommission CLI can treat the failure as a
  halt condition.
* Re-running produces a new timestamped archive without conflicting
  with the prior one.

Run:

    cd ai-employee && python -m pytest bin/tests/test_export.py -v
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # ai-employee/ on sys.path

from adapter.audit_log import (  # noqa: E402
    AuditLogWriter,
    SqliteExecutor,
)
from bin.lib.export import (  # noqa: E402
    ExportFailed,
    ExportRunSummary,
    InMemoryExportWriter,
    run_export,
    run_export_for_decommission,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_AUDIT_SCHEMA = """
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


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _make_audit(tmp_path: Path) -> tuple[AuditLogWriter, sqlite3.Connection]:
    conn = sqlite3.connect(str(tmp_path / "audit.sqlite"))
    conn.executescript(_AUDIT_SCHEMA)
    return AuditLogWriter(SqliteExecutor(conn)), conn


def _audit_rows(conn: sqlite3.Connection, action_type: str) -> list[dict]:
    cur = conn.execute(
        "SELECT action_type, actor, metadata FROM audit_log WHERE action_type = ?"
        " ORDER BY id",
        [action_type],
    )
    out = []
    for row in cur.fetchall():
        meta = json.loads(row[2]) if row[2] else {}
        out.append({"action_type": row[0], "actor": row[1], "metadata": meta})
    return out


# ---------------------------------------------------------------------------
# Test fakes
# ---------------------------------------------------------------------------


class _FakeMemoryReader:
    async def list_active_items(self) -> list[dict]:
        return [
            {
                "id": "01H1",
                "source_kind": "practice_management",
                "source_id": "filevine",
                "external_id": "m-1",
                "item_type": "matter",
                "access_scope": "firm-wide",
                "r2_key": "smd/vault/narrative/pm-filevine-matter-m-1.json",
            }
        ]

    async def list_source_states(self) -> list[dict]:
        return [
            {
                "source_kind": "practice_management",
                "source_id": "filevine",
                "last_ingestion_at": "2026-05-20T10:00:00.000Z",
                "last_success_at": "2026-05-20T10:00:00.000Z",
                "last_error": None,
                "ingest_status": "ok",
                "items_last_run": 1,
                "schema_version": 1,
            }
        ]

    async def list_memory_rules(self) -> list[dict]:
        return [{"id": "rule-1", "rule_type": "voice", "content": "first names"}]

    async def list_person_mappings(self) -> list[dict]:
        return [{"id": "p-1", "canonical_name": "Sarah"}]


class _FakeVoiceReader:
    async def list_active_voice_items(self) -> list[dict]:
        return [
            {
                "id": "01H1",
                "source_kind": "email",
                "source_id": "gmail",
                "source_message_digest": "a" * 64,
                "recipient_cohort_id": "partners",
                "partner_authored": 1,
                "filter_reason": "accept",
                "ingested_at": "2026-05-20T10:00:00.000Z",
                "sent_at": "2026-05-19T15:00:00.000Z",
                "r2_key": "smd/voice/cohort/partners/01H1.json",
            }
        ]

    async def list_voice_source_states(self) -> list[dict]:
        return [
            {
                "source_kind": "email",
                "source_id": "gmail",
                "last_ingestion_at": "2026-05-20T10:00:00.000Z",
                "last_success_at": "2026-05-20T10:00:00.000Z",
                "last_error": None,
                "ingest_status": "ok",
                "items_last_run": 1,
                "samples_by_cohort_json": '{"partners":1}',
                "schema_version": 1,
            }
        ]


class _FakeR2Reader:
    def __init__(self, objects: dict[str, bytes]) -> None:
        self._objects = objects

    async def get(self, key: str) -> bytes:
        if key not in self._objects:
            raise FileNotFoundError(key)
        return self._objects[key]


class _RaisingMemoryReader(_FakeMemoryReader):
    async def list_active_items(self) -> list[dict]:
        raise RuntimeError("synthetic D1 failure")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_run_export_produces_targz_with_memory_and_voice(tmp_path):
    audit_writer, audit_conn = _make_audit(tmp_path)
    memory_r2 = _FakeR2Reader(
        {"smd/vault/narrative/pm-filevine-matter-m-1.json": b'{"external_id":"m-1"}'}
    )
    voice_sample = json.dumps(
        {
            "word_count": 47,
            "greeting_style": "first_name",
            "signoff_style": "best",
            "recipient_cohort": "partners",
        },
        sort_keys=True,
    ).encode("utf-8")
    voice_r2 = _FakeR2Reader({"smd/voice/cohort/partners/01H1.json": voice_sample})

    summary = _run(
        run_export(
            customer_slug="smd",
            memory_reader=_FakeMemoryReader(),
            memory_r2_reader=memory_r2,
            voice_reader=_FakeVoiceReader(),
            voice_r2_reader=voice_r2,
            voice_config={"voice_retention_days": 365},
            archive_dir=tmp_path / "exports",
            audit_writer=audit_writer,
        )
    )

    assert summary.customer_slug == "smd"
    assert summary.archive_path is not None
    archive_path = Path(summary.archive_path)
    assert archive_path.exists()
    assert archive_path.suffix == ".gz"
    assert summary.memory_entry_count > 0
    assert summary.voice_entry_count > 0

    with tarfile.open(archive_path, mode="r:gz") as tar:
        names = set(tar.getnames())

    assert "manifests/memory.json" in names
    assert "manifests/voice.json" in names
    assert "memory/state/practice_management-filevine.json" in names
    assert "memory/items/practice_management-filevine-matter.json" in names
    assert "memory/rules/memory-rules.json" in names
    assert "memory/people/person-mappings.json" in names
    assert "voice/state/email-gmail.json" in names
    assert "voice/provenance/items.json" in names
    assert "voice/samples/cohort/partners/01H1.json" in names
    assert "voice/library/config.json" in names

    # Two audit rows: initiated + completed.
    rows = _audit_rows(audit_conn, "COMPLIANCE_PACKET_EXPORTED")
    kinds = [r["metadata"].get("kind") for r in rows]
    assert "memory_export.initiated" in kinds
    assert "memory_export.completed" in kinds


def test_run_export_initial_audit_row_lands_before_completion(tmp_path):
    audit_writer, audit_conn = _make_audit(tmp_path)
    _run(
        run_export(
            customer_slug="smd",
            memory_reader=_FakeMemoryReader(),
            memory_r2_reader=None,
            voice_reader=_FakeVoiceReader(),
            voice_r2_reader=None,
            archive_dir=tmp_path / "exports",
            audit_writer=audit_writer,
        )
    )

    rows = _audit_rows(audit_conn, "COMPLIANCE_PACKET_EXPORTED")
    # Both rows lands; initiated comes first.
    assert len(rows) == 2
    assert rows[0]["metadata"]["kind"] == "memory_export.initiated"
    assert rows[1]["metadata"]["kind"] == "memory_export.completed"
    # The completed row carries the summary structure.
    summary_meta = rows[1]["metadata"]["summary"]
    assert summary_meta["customer_slug"] == "smd"
    assert summary_meta["archive_path"].endswith(".tar.gz")


def test_run_export_failure_raises_and_writes_failed_audit_row(tmp_path):
    audit_writer, audit_conn = _make_audit(tmp_path)
    with pytest.raises(ExportFailed):
        _run(
            run_export(
                customer_slug="smd",
                memory_reader=_RaisingMemoryReader(),
                memory_r2_reader=None,
                voice_reader=_FakeVoiceReader(),
                voice_r2_reader=None,
                archive_dir=tmp_path / "exports",
                audit_writer=audit_writer,
            )
        )

    rows = _audit_rows(audit_conn, "COMPLIANCE_PACKET_EXPORTED")
    kinds = [r["metadata"].get("kind") for r in rows]
    assert "memory_export.initiated" in kinds
    assert "memory_export.failed" in kinds


def test_run_export_rejects_empty_slug(tmp_path):
    audit_writer, _conn = _make_audit(tmp_path)
    with pytest.raises(ExportFailed):
        _run(
            run_export(
                customer_slug="",
                memory_reader=_FakeMemoryReader(),
                memory_r2_reader=None,
                voice_reader=_FakeVoiceReader(),
                voice_r2_reader=None,
                archive_dir=tmp_path / "exports",
                audit_writer=audit_writer,
            )
        )


def test_re_running_export_produces_distinct_archives(tmp_path):
    """Two consecutive runs land in two timestamped archives."""
    audit_writer, _conn = _make_audit(tmp_path)
    archive_dir = tmp_path / "exports"

    # First run with fixed t0.
    t0 = datetime(2026, 5, 21, 12, 0, 0, tzinfo=timezone.utc)
    summary_a = _run(
        run_export(
            customer_slug="smd",
            memory_reader=_FakeMemoryReader(),
            memory_r2_reader=None,
            voice_reader=_FakeVoiceReader(),
            voice_r2_reader=None,
            archive_dir=archive_dir,
            audit_writer=audit_writer,
            now=t0,
        )
    )

    # Second run with fixed t1 (later) -- distinct archive name.
    t1 = datetime(2026, 5, 21, 12, 0, 5, tzinfo=timezone.utc)
    summary_b = _run(
        run_export(
            customer_slug="smd",
            memory_reader=_FakeMemoryReader(),
            memory_r2_reader=None,
            voice_reader=_FakeVoiceReader(),
            voice_r2_reader=None,
            archive_dir=archive_dir,
            audit_writer=audit_writer,
            now=t1,
        )
    )

    assert summary_a.archive_path != summary_b.archive_path
    assert Path(summary_a.archive_path).exists()
    assert Path(summary_b.archive_path).exists()


def test_run_export_for_decommission_is_a_thin_wrapper(tmp_path):
    audit_writer, _conn = _make_audit(tmp_path)
    summary = _run(
        run_export_for_decommission(
            customer_slug="smd",
            memory_reader=_FakeMemoryReader(),
            memory_r2_reader=None,
            voice_reader=_FakeVoiceReader(),
            voice_r2_reader=None,
            archive_dir=tmp_path / "exports",
            audit_writer=audit_writer,
        )
    )
    assert isinstance(summary, ExportRunSummary)
    assert summary.customer_slug == "smd"


def test_run_export_for_decommission_propagates_failure(tmp_path):
    audit_writer, _conn = _make_audit(tmp_path)
    with pytest.raises(ExportFailed):
        _run(
            run_export_for_decommission(
                customer_slug="smd",
                memory_reader=_RaisingMemoryReader(),
                memory_r2_reader=None,
                voice_reader=_FakeVoiceReader(),
                voice_r2_reader=None,
                archive_dir=tmp_path / "exports",
                audit_writer=audit_writer,
            )
        )


def test_in_memory_writer_rejects_duplicate_path():
    """The recording writer surfaces duplicate-path bugs in export modules."""

    async def _exercise():
        w = InMemoryExportWriter()
        await w.write_file("x.json", b"first")
        with pytest.raises(ExportFailed):
            await w.write_file("x.json", b"second")

    _run(_exercise())
