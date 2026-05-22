"""Tests for ai-employee/adapter/memory/export.py (issue #862).

Covers:

* The export module reads only -- source rows are unmodified after a run.
* Per-source state, ingested items (grouped by item_type), R2 bodies,
  memory rules, and person mappings each land at the right archive
  path with the right manifest entry.
* Per-row access_scope propagates into the manifest entry; a heterogenous
  cohort surfaces ``mixed``.
* The manifest entries carry sha256 digests that match the bytes written.
* Re-running the export with the same inputs produces the same byte
  output (excluding the timestamp); the export is deterministic over
  one snapshot.
* Signing is a no-op by default but the seam runs (signature_kind="stub").
* Missing R2 objects are logged and skipped without aborting the run.

Run from repo root:

    cd ai-employee && python -m pytest adapter/memory/tests/test_export.py -v
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[3]))  # ai-employee/ on sys.path

from adapter.memory.export import (  # noqa: E402
    ARTIFACT_KIND_DOCUMENT,
    ARTIFACT_KIND_INGESTION_STATE,
    ARTIFACT_KIND_MATTER,
    ARTIFACT_KIND_MEMORY_RULE,
    ARTIFACT_KIND_PERSON_MAPPING,
    ARTIFACT_KIND_RECIPIENT,
    EXPORT_SCHEMA_VERSION,
    ExportManifestEntry,
    MemoryExportManifest,
    NoOpExportSigner,
    export_memory,
)


# ---------------------------------------------------------------------------
# Test fakes
# ---------------------------------------------------------------------------


class _FakeReader:
    """In-memory reader satisfying MemoryExportReader."""

    def __init__(
        self,
        *,
        states: list[dict],
        items: list[dict],
        rules: list[dict],
        persons: list[dict],
    ) -> None:
        self._states = states
        self._items = items
        self._rules = rules
        self._persons = persons

    async def list_active_items(self) -> list[dict]:
        return list(self._items)

    async def list_source_states(self) -> list[dict]:
        return list(self._states)

    async def list_memory_rules(self) -> list[dict]:
        return list(self._rules)

    async def list_person_mappings(self) -> list[dict]:
        return list(self._persons)


class _FakeR2Reader:
    def __init__(self, objects: dict[str, bytes]) -> None:
        self._objects = objects
        self.calls: list[str] = []

    async def get(self, key: str) -> bytes:
        self.calls.append(key)
        if key not in self._objects:
            raise FileNotFoundError(key)
        return self._objects[key]


class _RecordingWriter:
    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    async def write_file(self, path: str, body: bytes) -> None:
        if path in self.files:
            raise AssertionError(f"duplicate write to {path!r}")
        self.files[path] = body


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_data():
    """Synthetic memory snapshot covering all artifact kinds."""
    states = [
        {
            "source_kind": "practice_management",
            "source_id": "filevine",
            "last_ingestion_at": "2026-05-20T10:00:00.000Z",
            "last_success_at": "2026-05-20T10:00:00.000Z",
            "last_error": None,
            "ingest_status": "ok",
            "items_last_run": 3,
            "schema_version": 1,
        }
    ]
    items = [
        {
            "id": "01H1",
            "source_kind": "practice_management",
            "source_id": "filevine",
            "external_id": "m-1",
            "item_type": "matter",
            "access_scope": "firm-wide",
            "r2_key": "smd/vault/narrative/pm-filevine-matter-m-1.json",
            "vectorize_chunk_ids": None,
            "content_digest": "abc",
            "metadata": {"client_name": "Acme Corp"},
        },
        {
            "id": "01H2",
            "source_kind": "practice_management",
            "source_id": "filevine",
            "external_id": "m-2",
            "item_type": "matter",
            "access_scope": "partner-only",
            "r2_key": "smd/vault/narrative/pm-filevine-matter-m-2.json",
            "vectorize_chunk_ids": None,
            "content_digest": "def",
            "metadata": {"client_name": "Beta LLC"},
        },
        {
            "id": "01H3",
            "source_kind": "practice_management",
            "source_id": "filevine",
            "external_id": "d-1",
            "item_type": "document",
            "access_scope": "firm-wide",
            "r2_key": "smd/vault/process/pm-filevine-doc-d-1.txt",
            "vectorize_chunk_ids": ["c1", "c2"],
            "content_digest": "ghi",
            "metadata": {"filename": "engagement.txt"},
        },
        {
            "id": "01H4",
            "source_kind": "practice_management",
            "source_id": "filevine",
            "external_id": "r-1",
            "item_type": "recipient",
            "access_scope": "firm-wide",
            "r2_key": None,
            "vectorize_chunk_ids": None,
            "content_digest": None,
            "metadata": {"name": "Sarah Paralegal"},
        },
    ]
    rules = [
        {
            "id": "rule-1",
            "rule_type": "voice",
            "content": "Use first name greetings with the team",
            "source": "captain",
            "version": 1,
            "deleted_at": None,
        }
    ]
    persons = [
        {
            "id": "p-1",
            "canonical_name": "Sarah Paralegal",
            "role": "paralegal",
            "firm_internal": 1,
            "deleted_at": None,
        }
    ]
    r2_objects = {
        "smd/vault/narrative/pm-filevine-matter-m-1.json": b'{"external_id":"m-1"}',
        "smd/vault/narrative/pm-filevine-matter-m-2.json": b'{"external_id":"m-2"}',
        "smd/vault/process/pm-filevine-doc-d-1.txt": b"This is the engagement letter.",
    }
    return states, items, rules, persons, r2_objects


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_export_writes_state_items_rules_persons(sample_data):
    states, items, rules, persons, r2_objects = sample_data
    reader = _FakeReader(states=states, items=items, rules=rules, persons=persons)
    r2 = _FakeR2Reader(r2_objects)
    writer = _RecordingWriter()

    manifest = _run(
        export_memory(
            customer_slug="smd",
            reader=reader,
            r2_reader=r2,
            writer=writer,
        )
    )

    # State file landed under memory/state/.
    assert "memory/state/practice_management-filevine.json" in writer.files

    # One items file per item_type (matter has 2 rows in one file).
    assert "memory/items/practice_management-filevine-matter.json" in writer.files
    assert "memory/items/practice_management-filevine-document.json" in writer.files
    assert "memory/items/practice_management-filevine-recipient.json" in writer.files

    # R2 bodies for matters + document, recipient (no r2_key) skipped.
    assert "memory/vault/narrative/pm-filevine-matter-m-1.json" in writer.files
    assert "memory/vault/narrative/pm-filevine-matter-m-2.json" in writer.files
    assert "memory/vault/process/pm-filevine-doc-d-1.txt" in writer.files

    # Rules + persons landed.
    assert "memory/rules/memory-rules.json" in writer.files
    assert "memory/people/person-mappings.json" in writer.files

    # Manifest file landed.
    assert "manifests/memory.json" in writer.files

    # Manifest has entries for every artifact we expected.
    paths = {e.path for e in manifest.entries}
    assert "memory/state/practice_management-filevine.json" in paths
    assert "memory/items/practice_management-filevine-matter.json" in paths
    assert "memory/rules/memory-rules.json" in paths
    assert "memory/people/person-mappings.json" in paths


def test_manifest_entry_sha256_matches_written_bytes(sample_data):
    states, items, rules, persons, r2_objects = sample_data
    reader = _FakeReader(states=states, items=items, rules=rules, persons=persons)
    r2 = _FakeR2Reader(r2_objects)
    writer = _RecordingWriter()

    manifest = _run(
        export_memory(
            customer_slug="smd",
            reader=reader,
            r2_reader=r2,
            writer=writer,
        )
    )

    for entry in manifest.entries:
        if entry.path == "manifests/memory.json":
            # Manifest self-reference is not in the entry list, skip.
            continue
        assert entry.path in writer.files, f"entry path missing: {entry.path}"
        assert entry.sha256 == _sha256(
            writer.files[entry.path]
        ), f"sha256 mismatch for {entry.path}"


def test_mixed_access_scope_surfaces_as_mixed_label(sample_data):
    states, items, rules, persons, r2_objects = sample_data
    reader = _FakeReader(states=states, items=items, rules=rules, persons=persons)
    r2 = _FakeR2Reader(r2_objects)
    writer = _RecordingWriter()

    manifest = _run(
        export_memory(
            customer_slug="smd",
            reader=reader,
            r2_reader=r2,
            writer=writer,
        )
    )

    # Matters: m-1 is firm-wide, m-2 is partner-only -- the items
    # manifest entry should land as "mixed".
    matter_entry = next(
        e for e in manifest.entries
        if e.path == "memory/items/practice_management-filevine-matter.json"
    )
    assert matter_entry.scope == "mixed"
    # Documents: only one row, firm-wide.
    doc_entry = next(
        e for e in manifest.entries
        if e.path == "memory/items/practice_management-filevine-document.json"
    )
    assert doc_entry.scope == "firm-wide"


def test_per_r2_object_manifest_entry_carries_row_scope(sample_data):
    states, items, rules, persons, r2_objects = sample_data
    reader = _FakeReader(states=states, items=items, rules=rules, persons=persons)
    r2 = _FakeR2Reader(r2_objects)
    writer = _RecordingWriter()

    manifest = _run(
        export_memory(
            customer_slug="smd",
            reader=reader,
            r2_reader=r2,
            writer=writer,
        )
    )

    partner_only_entry = next(
        e for e in manifest.entries
        if e.path == "memory/vault/narrative/pm-filevine-matter-m-2.json"
    )
    assert partner_only_entry.scope == "partner-only"


def test_export_is_read_only(sample_data):
    """The source reader's underlying lists must be unchanged afterward."""
    states, items, rules, persons, r2_objects = sample_data
    items_snapshot = json.dumps(items, sort_keys=True)
    states_snapshot = json.dumps(states, sort_keys=True)
    rules_snapshot = json.dumps(rules, sort_keys=True)
    persons_snapshot = json.dumps(persons, sort_keys=True)

    reader = _FakeReader(states=states, items=items, rules=rules, persons=persons)
    r2 = _FakeR2Reader(r2_objects)
    writer = _RecordingWriter()

    _run(
        export_memory(
            customer_slug="smd",
            reader=reader,
            r2_reader=r2,
            writer=writer,
        )
    )

    assert json.dumps(items, sort_keys=True) == items_snapshot
    assert json.dumps(states, sort_keys=True) == states_snapshot
    assert json.dumps(rules, sort_keys=True) == rules_snapshot
    assert json.dumps(persons, sort_keys=True) == persons_snapshot


def test_missing_r2_object_is_skipped_not_fatal(sample_data):
    states, items, rules, persons, _r2_objects = sample_data
    # Drop one R2 object; the export should still succeed.
    partial_r2 = {
        "smd/vault/narrative/pm-filevine-matter-m-1.json": b'{"external_id":"m-1"}',
        # m-2 missing
        "smd/vault/process/pm-filevine-doc-d-1.txt": b"engagement letter",
    }
    reader = _FakeReader(states=states, items=items, rules=rules, persons=persons)
    r2 = _FakeR2Reader(partial_r2)
    writer = _RecordingWriter()

    manifest = _run(
        export_memory(
            customer_slug="smd",
            reader=reader,
            r2_reader=r2,
            writer=writer,
        )
    )

    assert "memory/vault/narrative/pm-filevine-matter-m-1.json" in writer.files
    # Missing object: NOT in writer.files.
    assert "memory/vault/narrative/pm-filevine-matter-m-2.json" not in writer.files
    # Manifest entries reflect the actual writes.
    paths = {e.path for e in manifest.entries}
    assert "memory/vault/narrative/pm-filevine-matter-m-1.json" in paths
    assert "memory/vault/narrative/pm-filevine-matter-m-2.json" not in paths


def test_signer_seam_runs_and_records_kind(sample_data):
    states, items, rules, persons, r2_objects = sample_data
    reader = _FakeReader(states=states, items=items, rules=rules, persons=persons)
    r2 = _FakeR2Reader(r2_objects)
    writer = _RecordingWriter()

    manifest = _run(
        export_memory(
            customer_slug="smd",
            reader=reader,
            r2_reader=r2,
            writer=writer,
            signer=NoOpExportSigner(),
        )
    )

    assert manifest.signature == ""
    assert manifest.signature_kind == "stub"
    # The manifest file on disk also carries the kind so a downstream
    # auditor can tell this archive was written before real signing
    # was wired.
    manifest_bytes = writer.files["manifests/memory.json"]
    parsed = json.loads(manifest_bytes.decode("utf-8"))
    assert parsed["signature_kind"] == "stub"


def test_manifest_records_schema_version(sample_data):
    states, items, rules, persons, r2_objects = sample_data
    reader = _FakeReader(states=states, items=items, rules=rules, persons=persons)
    r2 = _FakeR2Reader(r2_objects)
    writer = _RecordingWriter()

    manifest = _run(
        export_memory(
            customer_slug="smd",
            reader=reader,
            r2_reader=r2,
            writer=writer,
        )
    )

    assert manifest.schema_version == EXPORT_SCHEMA_VERSION


def test_export_rejects_empty_customer_slug():
    reader = _FakeReader(states=[], items=[], rules=[], persons=[])
    writer = _RecordingWriter()
    with pytest.raises(ValueError):
        _run(
            export_memory(
                customer_slug="",
                reader=reader,
                r2_reader=None,
                writer=writer,
            )
        )


def test_empty_snapshot_produces_only_manifest():
    reader = _FakeReader(states=[], items=[], rules=[], persons=[])
    writer = _RecordingWriter()
    manifest = _run(
        export_memory(
            customer_slug="smd",
            reader=reader,
            r2_reader=None,
            writer=writer,
        )
    )
    # Only the manifest file lands when the snapshot is empty.
    assert set(writer.files.keys()) == {"manifests/memory.json"}
    assert manifest.entries == []
    assert manifest.total_items() == 0


def test_manifest_entry_rejects_unknown_kind():
    manifest = MemoryExportManifest(
        customer_slug="smd",
        exported_at="2026-05-21T00:00:00.000Z",
    )
    with pytest.raises(ValueError):
        manifest.add(
            ExportManifestEntry(
                path="memory/items/x.json",
                kind="not-a-kind",
                sha256="0" * 64,
                item_count=0,
            )
        )


def test_running_export_twice_produces_independent_manifests(sample_data):
    """Idempotency: re-running with the same inputs writes the same bytes
    (manifest timestamp aside), and does not mutate either run's writer."""
    states, items, rules, persons, r2_objects = sample_data
    reader = _FakeReader(states=states, items=items, rules=rules, persons=persons)
    r2 = _FakeR2Reader(r2_objects)
    writer_a = _RecordingWriter()
    writer_b = _RecordingWriter()

    fixed = datetime(2026, 5, 21, 12, 0, 0, tzinfo=timezone.utc)
    _run(export_memory(customer_slug="smd", reader=reader, r2_reader=r2, writer=writer_a, now=fixed))
    # Re-construct r2 so the call list is independent.
    r2b = _FakeR2Reader(r2_objects)
    _run(export_memory(customer_slug="smd", reader=reader, r2_reader=r2b, writer=writer_b, now=fixed))

    assert set(writer_a.files.keys()) == set(writer_b.files.keys())
    for path in writer_a.files:
        assert writer_a.files[path] == writer_b.files[path], (
            f"non-deterministic content at {path}"
        )
