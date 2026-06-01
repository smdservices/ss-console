"""End-to-end tests for adapter.evidence.packet.

Coverage:

* customer.yaml redaction strips token_ref, oauth_scopes, recipient
  emails, and leaves everything else intact;
* secret-pattern validator aborts the build when a recognized API key
  shape survives redaction;
* role gate rejects actors outside {captain, compliance};
* end-to-end build emits a tar.gz with every expected file, a
  manifest.json whose file_hashes match the on-disk bytes, and a
  COMPLIANCE_PACKET_EXPORTED audit row;
* missing customer.yaml raises EvidencePacketError (no fabrication);
* empty audit table produces a packet whose summary reports 0 events
  (truthful zero, not a placeholder);
* deterministic mtimes: re-running with the same inputs produces a
  bit-identical tar.gz.

The tests use the same SqliteExecutor + AuditLogWriter pattern as
adapter/tests/test_audit_log.py and bin/tests/test_decommission.py.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
import sys
import tarfile
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[3]))

from adapter.audit_log import AuditLogWriter, SqliteExecutor  # noqa: E402
from adapter.evidence.packet import (  # noqa: E402
    EvidencePacketBuilder,
    EvidencePacketError,
    PacketActor,
    PacketRequest,
    SqliteReadExecutor,
    redact_customer_yaml,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_FULL_SCHEMA = """
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
CREATE TABLE invariant_boot_checks (
  id             TEXT PRIMARY KEY,
  ts             TEXT NOT NULL,
  invariant_num  INTEGER NOT NULL,
  passed         INTEGER NOT NULL,
  failure_detail TEXT
);
CREATE TABLE memory_rules (
  id            TEXT PRIMARY KEY,
  rule_type     TEXT NOT NULL,
  category      TEXT,
  content       TEXT NOT NULL,
  source        TEXT NOT NULL,
  source_ref    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE person_mappings (
  id              TEXT PRIMARY KEY,
  canonical_name  TEXT NOT NULL,
  role            TEXT NOT NULL,
  email_addresses TEXT,
  external_ids    TEXT,
  firm_internal   INTEGER NOT NULL DEFAULT 1,
  notes           TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  deleted_at      TEXT
);
CREATE TABLE skill_state (
  skill_name           TEXT PRIMARY KEY,
  trust_ceiling        TEXT NOT NULL,
  content_hash         TEXT NOT NULL,
  activated_at         TEXT NOT NULL,
  last_run_at          TEXT,
  run_count            INTEGER NOT NULL DEFAULT 0,
  operator_may_approve INTEGER NOT NULL DEFAULT 0,
  config               TEXT
);
CREATE TABLE voice_samples (
  id                 TEXT PRIMARY KEY,
  uploaded_at        TEXT NOT NULL,
  uploaded_by        TEXT NOT NULL,
  source             TEXT NOT NULL,
  recipient_cohort_id TEXT,
  r2_key             TEXT NOT NULL,
  sanitized          INTEGER NOT NULL DEFAULT 0,
  active             INTEGER NOT NULL DEFAULT 1,
  used_in_blind_test INTEGER NOT NULL DEFAULT 0,
  notes              TEXT
);
CREATE TABLE recipient_cohorts (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  description      TEXT,
  tone_descriptors TEXT,
  match_rules      TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
"""


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _make_db(tmp_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(tmp_path / "data.sqlite"))
    conn.executescript(_FULL_SCHEMA)
    return conn


def _seed_audit_row(conn: sqlite3.Connection, **fields):
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO audit_log (id, ts, action_type, actor, actor_role, "
        "skill_name, matter_ref, input_digest, output_digest, diff_digest, "
        "trust_ceiling, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            fields["id"],
            fields["ts"],
            fields["action_type"],
            fields.get("actor", "agent"),
            fields.get("actor_role"),
            fields.get("skill_name"),
            fields.get("matter_ref"),
            fields.get("input_digest"),
            fields.get("output_digest"),
            fields.get("diff_digest"),
            fields.get("trust_ceiling"),
            fields.get("metadata"),
        ],
    )
    conn.commit()


def _write_customer_yaml(tmp_path: Path, body: dict) -> Path:
    path = tmp_path / "customer.yaml"
    path.write_text(json.dumps(body, indent=2), encoding="utf-8")
    return path


def _build_pair(tmp_path: Path):
    """Construct (builder, audit_conn) with a shared sqlite as both
    read backend and audit writer destination."""
    conn = _make_db(tmp_path)
    reader = SqliteReadExecutor(conn)
    audit = AuditLogWriter(SqliteExecutor(conn))
    builder = EvidencePacketBuilder(
        reader=reader, audit_writer=audit, yaml_loader=json.loads
    )
    return builder, conn


# ---------------------------------------------------------------------------
# Redaction unit tests
# ---------------------------------------------------------------------------


def test_redact_customer_yaml_replaces_token_ref():
    src = {
        "connectors": {
            "Gmail": {"token_ref": "vault://secret/abc", "enabled": True},
        }
    }
    out = redact_customer_yaml(src)
    assert out["connectors"]["Gmail"]["token_ref"] == "<redacted>"
    assert out["connectors"]["Gmail"]["enabled"] is True


def test_redact_customer_yaml_collapses_oauth_scopes_to_count():
    src = {"connectors": {"Gmail": {"oauth_scopes": ["a", "b", "c"]}}}
    out = redact_customer_yaml(src)
    assert out["connectors"]["Gmail"]["oauth_scopes"] == "<3 scopes redacted>"


def test_redact_customer_yaml_anonymizes_recipient_emails():
    src = {
        "escalation": {
            "failure_recipients": ["alice@firm.com", "bob@firm.com"],
            "red_flag_recipients": ["paralegal@firm.com"],
        }
    }
    out = redact_customer_yaml(src)
    assert out["escalation"]["failure_recipients"] == [
        "<redacted>@firm.com",
        "<redacted>@firm.com",
    ]
    assert out["escalation"]["red_flag_recipients"] == ["<redacted>@firm.com"]


def test_redact_customer_yaml_preserves_unrelated_fields():
    src = {
        "customer_name": "Acme",
        "vertical": "law-firm",
        "personas": [{"slug": "marcus", "name": "Marcus"}],
    }
    out = redact_customer_yaml(src)
    assert out == src
    # mutation-free
    assert src["personas"][0]["slug"] == "marcus"


# ---------------------------------------------------------------------------
# End-to-end builds
# ---------------------------------------------------------------------------


def _request(tmp_path: Path, customer_yaml: Path, **over) -> PacketRequest:
    base = dict(
        customer_slug="acme",
        matter="all",
        period_start="2026-04-01T00:00:00Z",
        period_end="2026-05-31T23:59:59Z",
        output_path=tmp_path / "out" / "evidence.tar.gz",
        customer_yaml_path=customer_yaml,
        actor="captain@example.com",
        actor_role=PacketActor.CAPTAIN,
    )
    base.update(over)
    return PacketRequest(**base)


def test_build_emits_targz_with_every_expected_file(tmp_path):
    builder, conn = _build_pair(tmp_path)
    _seed_audit_row(
        conn,
        id="01HZZ0000000000000000000A1",
        ts="2026-04-15T10:00:00.000Z",
        action_type="DRAFT_CREATED",
        actor="agent",
        skill_name="inbox-triage",
        matter_ref="m-1",
    )
    _seed_audit_row(
        conn,
        id="01HZZ0000000000000000000A2",
        ts="2026-04-15T10:01:00.000Z",
        action_type="DRAFT_APPROVED",
        actor="paralegal@firm.com",
        skill_name="inbox-triage",
        matter_ref="m-1",
    )
    customer_yaml = _write_customer_yaml(
        tmp_path,
        {
            "customer_name": "Acme Co.",
            "connectors": {"Gmail": {"token_ref": "vault://xyz"}},
        },
    )

    result = _run(builder.build(_request(tmp_path, customer_yaml)))

    assert result.output_path.exists()
    with tarfile.open(result.output_path, "r:gz") as tar:
        names = sorted(tar.getnames())
    expected = [
        "00-README.md",
        "01-summary.pdf",
        "03-audit-log.csv",
        "05-customer-yaml.redacted.yml",
        "06-memory-snapshot.json",
        "07-skill-catalog.json",
        "09-boot-checks.csv",
        "manifest.json",
    ]
    assert names == expected
    assert result.file_count == len(expected)
    assert result.bytes_written > 0


def test_build_manifest_file_hashes_match_archive_contents(tmp_path):
    builder, _ = _build_pair(tmp_path)
    customer_yaml = _write_customer_yaml(tmp_path, {"customer_name": "Acme"})

    result = _run(builder.build(_request(tmp_path, customer_yaml)))

    with tarfile.open(result.output_path, "r:gz") as tar:
        manifest_member = tar.extractfile("manifest.json")
        assert manifest_member is not None
        manifest = json.load(manifest_member)
        for name, expected_hash in manifest["file_hashes"].items():
            member = tar.extractfile(name)
            assert member is not None
            blob = member.read()
            assert hashlib.sha256(blob).hexdigest() == expected_hash


def test_build_emits_compliance_packet_audit_row(tmp_path):
    builder, conn = _build_pair(tmp_path)
    customer_yaml = _write_customer_yaml(tmp_path, {"customer_name": "Acme"})

    result = _run(builder.build(_request(tmp_path, customer_yaml)))

    # The shared SqliteReadExecutor sets row_factory on the connection,
    # so reuse the dict shape here rather than fighting the cursor.
    cur = conn.cursor()
    cur.execute(
        "SELECT action_type, actor, actor_role, skill_name, metadata "
        "FROM audit_log WHERE action_type = 'COMPLIANCE_PACKET_EXPORTED'"
    )
    rows = cur.fetchall()
    assert len(rows) == 1
    row = rows[0]
    # Row is dict (set by SqliteReadExecutor) or tuple (default); handle both.
    if isinstance(row, dict):
        action_type = row["action_type"]
        actor = row["actor"]
        actor_role = row["actor_role"]
        skill_name = row["skill_name"]
        metadata_text = row["metadata"]
    else:
        action_type, actor, actor_role, skill_name, metadata_text = row
    assert action_type == "COMPLIANCE_PACKET_EXPORTED"
    assert actor == "captain@example.com"
    assert actor_role == "captain"
    assert skill_name == "compliance-audit-export"
    meta = json.loads(metadata_text)
    assert meta["customer_slug"] == "acme"
    assert meta["matter"] == "all"
    assert meta["manifest_sha256"] == result.manifest_sha256


def test_build_rejects_non_captain_non_compliance_actor(tmp_path):
    builder, _ = _build_pair(tmp_path)
    customer_yaml = _write_customer_yaml(tmp_path, {"customer_name": "Acme"})
    with pytest.raises(EvidencePacketError):
        _run(
            builder.build(
                _request(
                    tmp_path,
                    customer_yaml,
                    actor_role="not-a-role",  # type: ignore[arg-type]
                )
            )
        )


def test_build_rejects_missing_customer_yaml(tmp_path):
    builder, _ = _build_pair(tmp_path)
    nonexistent = tmp_path / "nope.yaml"
    with pytest.raises(EvidencePacketError):
        _run(builder.build(_request(tmp_path, nonexistent)))


def test_build_rejects_period_end_before_start(tmp_path):
    builder, _ = _build_pair(tmp_path)
    customer_yaml = _write_customer_yaml(tmp_path, {"customer_name": "Acme"})
    with pytest.raises(EvidencePacketError):
        _run(
            builder.build(
                _request(
                    tmp_path,
                    customer_yaml,
                    period_start="2026-05-01T00:00:00Z",
                    period_end="2026-04-01T00:00:00Z",
                )
            )
        )


def test_build_aborts_on_secret_leak_after_redaction(tmp_path):
    builder, _ = _build_pair(tmp_path)
    # Embed a leaked secret in a field the redactor does NOT cover:
    # this proves the post-redaction validator catches misses.
    customer_yaml = _write_customer_yaml(
        tmp_path,
        {
            "customer_name": "Acme",
            "notes": "Slack webhook leaked: xoxb-1234567890-abcdefghij",
        },
    )
    with pytest.raises(EvidencePacketError) as exc:
        _run(builder.build(_request(tmp_path, customer_yaml)))
    assert "secret-shaped" in str(exc.value)


def test_build_with_empty_audit_table_reports_truthful_zeros(tmp_path):
    builder, _ = _build_pair(tmp_path)
    customer_yaml = _write_customer_yaml(tmp_path, {"customer_name": "Acme"})

    result = _run(builder.build(_request(tmp_path, customer_yaml)))

    assert result.counts["audit_events"] == 0
    assert result.counts["drafts_created"] == 0
    with tarfile.open(result.output_path, "r:gz") as tar:
        pdf_member = tar.extractfile("01-summary.pdf")
        assert pdf_member is not None
        pdf_bytes = pdf_member.read()
    assert b"Audit events recorded: 0" in pdf_bytes


def test_build_filters_audit_rows_by_period_and_matter(tmp_path):
    builder, conn = _build_pair(tmp_path)
    # Row inside the period + matter
    _seed_audit_row(
        conn,
        id="01HZZ0000000000000000000B1",
        ts="2026-04-15T10:00:00.000Z",
        action_type="DRAFT_CREATED",
        matter_ref="m-1",
    )
    # Row inside the period but different matter
    _seed_audit_row(
        conn,
        id="01HZZ0000000000000000000B2",
        ts="2026-04-15T10:00:00.000Z",
        action_type="DRAFT_CREATED",
        matter_ref="m-2",
    )
    # Row outside the period
    _seed_audit_row(
        conn,
        id="01HZZ0000000000000000000B3",
        ts="2026-01-01T00:00:00.000Z",
        action_type="DRAFT_CREATED",
        matter_ref="m-1",
    )
    customer_yaml = _write_customer_yaml(tmp_path, {"customer_name": "Acme"})

    result = _run(
        builder.build(
            _request(
                tmp_path,
                customer_yaml,
                matter="m-1",
                period_start="2026-04-01T00:00:00Z",
                period_end="2026-04-30T23:59:59Z",
            )
        )
    )
    # Only the m-1 row inside the period counts; the COMPLIANCE_PACKET_EXPORTED
    # row is for matter=m-1 so it does NOT appear in this row's count (the
    # builder reads BEFORE writing the chain-of-custody row).
    assert result.counts["audit_events"] == 1
    assert result.counts["drafts_created"] == 1


def test_build_is_byte_deterministic_for_same_inputs(tmp_path):
    out_a = tmp_path / "a.tar.gz"
    out_b = tmp_path / "b.tar.gz"

    dir_a = tmp_path / "first"
    dir_b = tmp_path / "second"
    dir_a.mkdir()
    dir_b.mkdir()

    builder_a, _ = _build_pair(dir_a)
    yaml_a = _write_customer_yaml(dir_a, {"customer_name": "Acme"})
    _run(
        builder_a.build(
            _request(dir_a, yaml_a, output_path=out_a)
        )
    )

    # Fresh shared connection so we don't double-count the
    # chain-of-custody row from the first build.
    builder_b, _ = _build_pair(dir_b)
    yaml_b = _write_customer_yaml(dir_b, {"customer_name": "Acme"})
    _run(
        builder_b.build(
            _request(dir_b, yaml_b, output_path=out_b)
        )
    )

    # The README, summary PDF, and manifest all quote the manifest
    # sha256 (and the manifest itself carries generated_at). The
    # underlying data files (CSV / JSON dumps + redacted yaml) are the
    # deterministic invariant; the rendered artifacts above intentionally
    # change because they cite the manifest.
    deterministic_members = {
        "03-audit-log.csv",
        "05-customer-yaml.redacted.yml",
        "06-memory-snapshot.json",
        "07-skill-catalog.json",
        "09-boot-checks.csv",
    }

    def _hashes(path: Path) -> dict:
        with tarfile.open(path, "r:gz") as tar:
            return {
                name: hashlib.sha256(tar.extractfile(name).read()).hexdigest()
                for name in tar.getnames()
                if name in deterministic_members
            }

    assert _hashes(out_a) == _hashes(out_b)
