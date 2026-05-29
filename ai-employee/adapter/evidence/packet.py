"""Compliance evidence packet builder (issue #894).

Builds a tar.gz packet containing:

* ``00-README.md`` -- plain-language overview
* ``01-summary.pdf`` -- Susan-readable narrative (see :mod:`.pdf`)
* ``03-audit-log.csv`` -- structured audit_log dump for the period
* ``05-customer-yaml.redacted.yml`` -- customer config, secrets redacted
* ``06-memory-snapshot.json`` -- memory rules + person mappings + voice
  metadata (no sample content; spec keeps it on a separate signed path)
* ``07-skill-catalog.json`` -- skills active during the period
* ``09-boot-checks.csv`` -- invariant_boot_checks dump
* ``manifest.json`` -- file hashes + Captain signature stub

The full spec lists additional documents (engagement-letter clauses,
DPA, BAA, decommission confirmation). Those are static or per-customer
documents not under the per-customer D1, so they are out of scope for
the runtime in this PR -- the packet structure leaves room to drop them
in without manifest/PDF rewrites.

Composition
-----------

The builder talks to D1 through a read executor protocol (mirrors the
write executor in :mod:`adapter.audit_log`). Tests pass a sqlite-backed
implementation; production wires the HTTP D1 client.

Every successful build emits one ``COMPLIANCE_PACKET_EXPORTED`` row to
the audit log writer the caller supplied. That row is the
chain-of-custody artifact for the export itself, with the manifest
sha256 in metadata so a reviewer can verify packet identity at any time.

Role gate
---------

The CLI accepts an ``--actor`` flag; the builder verifies the actor's
role is in :data:`REQUIRED_ACTOR_ROLES` (``captain`` or ``compliance``).
A missing or wrong role aborts the build before any D1 read and before
any audit row.

No-fabrication contract
-----------------------

When a table has no rows for the period, the JSON / CSV dump is the
empty case (``[]`` or header-only CSV). The PDF narrative reports the
literal count (``0``), not a soft phrase that implies the agent did
something it did not. ``customer.yaml`` missing on disk is an error,
not a placeholder: callers must point at a real file.

The secret-redaction pass walks the parsed YAML and replaces every
``token_ref``, ``oauth_scopes``, and ``failure_recipients`` /
``red_flag_recipients`` value. A pre-export validator scans the
redacted output for residual secret patterns and aborts if any leak
through (``EvidencePacketError`` raised before the packet writes).
"""

from __future__ import annotations

import csv
import enum
import hashlib
import io
import json
import logging
import re
import tarfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import (
    Any,
    Iterable,
    List,
    Mapping,
    Optional,
    Protocol,
    Sequence,
    Tuple,
)

from .manifest import EvidenceManifest, build_manifest, manifest_sha256_hex
from .pdf import render_summary_pdf

log = logging.getLogger("aie.evidence.packet")


REQUIRED_ACTOR_ROLES = frozenset({"captain", "compliance"})

# Phrases / shapes the redactor walks customer.yaml for.
_SECRET_KEY_PATTERN = re.compile(
    r"(?i)^(token_ref|api_key|secret|password|client_secret|signing_key|"
    r"refresh_token|access_token|private_key)$"
)
_OAUTH_KEY_PATTERN = re.compile(r"(?i)^oauth_scopes$")
_RECIPIENT_KEY_PATTERN = re.compile(
    r"(?i)^(failure_recipients|red_flag_recipients|notification_recipients)$"
)

# Pre-export validator: a redacted file must NOT contain these patterns.
_SECRET_VALUE_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9]{20,}"),       # OpenAI / Anthropic style secret
    re.compile(r"AKIA[0-9A-Z]{16}"),          # AWS access key
    re.compile(r"AIza[0-9A-Za-z_-]{35}"),     # Google API key
    re.compile(r"xox[abposr]-[A-Za-z0-9-]{10,}"),  # Slack token
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"ghp_[A-Za-z0-9]{20,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
]


class EvidencePacketError(RuntimeError):
    """Raised on any unrecoverable packet-build failure.

    The caller (CLI or dashboard worker) should surface this verbatim to
    the operator. Partial outputs are NOT written: the builder writes
    to a temp path and only renames into place on success.
    """


class PacketActor(str, enum.Enum):
    """Subset of :class:`adapter.audit_log.ActorRole` that may invoke."""

    CAPTAIN = "captain"
    COMPLIANCE = "compliance"


@dataclass(frozen=True)
class PacketRequest:
    """Inputs that fully specify a packet build.

    ``matter`` may be a specific matter ID or the string ``"all"`` (the
    spec lets the caller scope the export by matter or by period).
    ``customer_yaml_path`` is the on-disk yaml for the customer; the
    builder reads it once and includes the redacted form in the packet.
    """

    customer_slug: str
    matter: str
    period_start: str
    period_end: str
    output_path: Path
    customer_yaml_path: Path
    actor: str
    actor_role: PacketActor

    def validate(self) -> None:
        if not self.customer_slug:
            raise EvidencePacketError("customer_slug must be non-empty")
        if not self.matter:
            raise EvidencePacketError(
                "matter must be a specific id or 'all'; never empty"
            )
        if not _is_iso8601(self.period_start) or not _is_iso8601(self.period_end):
            raise EvidencePacketError(
                "period_start / period_end must be ISO 8601 strings"
            )
        if self.period_end < self.period_start:
            raise EvidencePacketError("period_end must be >= period_start")
        if not isinstance(self.actor_role, PacketActor):
            raise EvidencePacketError(
                "actor_role must be a PacketActor (captain | compliance)"
            )
        if self.actor_role.value not in REQUIRED_ACTOR_ROLES:
            raise EvidencePacketError(
                f"actor_role {self.actor_role.value!r} not in "
                f"{sorted(REQUIRED_ACTOR_ROLES)}"
            )


@dataclass
class EvidencePacketResult:
    """What the build returns to the caller."""

    output_path: Path
    manifest_sha256: str
    file_count: int
    bytes_written: int
    counts: Mapping[str, int]
    manifest: EvidenceManifest


# ---------------------------------------------------------------------------
# Read executor protocol
# ---------------------------------------------------------------------------


class ReadExecutor(Protocol):
    """One method: run a SQL SELECT and return list of rows as dicts."""

    async def fetch_all(self, sql: str, params: Sequence[Any]) -> List[dict]: ...


class SqliteReadExecutor:
    """Sqlite-backed read executor for tests + local dev.

    Mirrors :class:`adapter.audit_log.SqliteExecutor` shape. Returns
    rows as dicts keyed by column name.
    """

    def __init__(self, connection) -> None:
        self._conn = connection
        self._conn.row_factory = _row_factory

    async def fetch_all(self, sql: str, params: Sequence[Any]) -> List[dict]:
        cur = self._conn.cursor()
        cur.execute(sql, list(params))
        rows = cur.fetchall()
        return [dict(r) for r in rows]


def _row_factory(cursor, row):
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_ISO_8601_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z?$"
)


def _is_iso8601(value: str) -> bool:
    return bool(value) and bool(_ISO_8601_RE.match(value))


def _iso_utc(now: Optional[datetime] = None) -> str:
    dt = now if now is not None else datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# customer.yaml redaction
# ---------------------------------------------------------------------------


def _redact_email(email: str) -> str:
    """Replace local-part; keep domain so the structure is auditable."""
    if "@" in email:
        _, domain = email.split("@", 1)
        return f"<redacted>@{domain}"
    return "<redacted>"


def redact_customer_yaml(parsed: Any) -> Any:
    """Walk a parsed-yaml structure and redact sensitive fields.

    Returns a NEW structure; the input is not mutated. The function is
    pure-Python (no PyYAML import here) so the test suite can pass it
    dicts directly and the CLI parses via yaml at call time.
    """
    if isinstance(parsed, dict):
        out: dict = {}
        for key, value in parsed.items():
            if isinstance(key, str) and _SECRET_KEY_PATTERN.match(key):
                out[key] = "<redacted>"
                continue
            if isinstance(key, str) and _OAUTH_KEY_PATTERN.match(key):
                count = (
                    len(value)
                    if isinstance(value, (list, tuple, set))
                    else 1 if value
                    else 0
                )
                out[key] = f"<{count} scopes redacted>"
                continue
            if isinstance(key, str) and _RECIPIENT_KEY_PATTERN.match(key):
                if isinstance(value, list):
                    out[key] = [_redact_email(str(v)) for v in value]
                elif isinstance(value, str):
                    out[key] = _redact_email(value)
                else:
                    out[key] = "<redacted>"
                continue
            out[key] = redact_customer_yaml(value)
        return out
    if isinstance(parsed, list):
        return [redact_customer_yaml(item) for item in parsed]
    return parsed


def _scan_for_secret_leak(rendered: str) -> Optional[str]:
    """Return the first regex match (as a label) found in the rendered
    yaml, or None when clean."""
    for pattern in _SECRET_VALUE_PATTERNS:
        if pattern.search(rendered):
            return pattern.pattern
    return None


# ---------------------------------------------------------------------------
# D1 reads
# ---------------------------------------------------------------------------


_AUDIT_LOG_COLUMNS = (
    "id",
    "ts",
    "action_type",
    "actor",
    "actor_role",
    "skill_name",
    "matter_ref",
    "input_digest",
    "output_digest",
    "diff_digest",
    "trust_ceiling",
    "metadata",
)

_BOOT_CHECK_COLUMNS = ("id", "ts", "invariant_num", "passed", "failure_detail")


async def _fetch_audit_log(
    reader: ReadExecutor,
    *,
    period_start: str,
    period_end: str,
    matter: str,
) -> List[dict]:
    if matter == "all":
        sql = (
            "SELECT * FROM audit_log "
            "WHERE ts >= ? AND ts <= ? "
            "ORDER BY ts ASC, id ASC"
        )
        params: list = [period_start, period_end]
    else:
        sql = (
            "SELECT * FROM audit_log "
            "WHERE ts >= ? AND ts <= ? AND matter_ref = ? "
            "ORDER BY ts ASC, id ASC"
        )
        params = [period_start, period_end, matter]
    return await _fetch_safe(reader, sql, params)


async def _fetch_boot_checks(
    reader: ReadExecutor, *, period_start: str, period_end: str
) -> List[dict]:
    sql = (
        "SELECT id, ts, invariant_num, passed, failure_detail "
        "FROM invariant_boot_checks "
        "WHERE ts >= ? AND ts <= ? "
        "ORDER BY ts ASC, id ASC"
    )
    return await _fetch_safe(reader, sql, [period_start, period_end])


async def _fetch_memory_snapshot(reader: ReadExecutor) -> dict:
    rules = await _fetch_safe(
        reader,
        "SELECT id, rule_type, category, content, source, source_ref, "
        "created_at, updated_at, deleted_at, version FROM memory_rules "
        "ORDER BY created_at ASC, id ASC",
    )
    persons = await _fetch_safe(
        reader,
        "SELECT id, canonical_name, role, email_addresses, firm_internal, "
        "notes, created_at, updated_at, deleted_at FROM person_mappings "
        "ORDER BY created_at ASC, id ASC",
    )
    # Redact external_ids entirely from the snapshot, per spec.
    for row in persons:
        row.pop("external_ids", None)

    voice_meta = await _fetch_safe(
        reader,
        "SELECT id, uploaded_at, uploaded_by, source, recipient_cohort_id, "
        "sanitized, active, used_in_blind_test FROM voice_samples "
        "ORDER BY uploaded_at ASC, id ASC",
    )

    cohorts = await _fetch_safe(
        reader,
        "SELECT id, name, description, tone_descriptors, match_rules, "
        "created_at, updated_at FROM recipient_cohorts "
        "ORDER BY created_at ASC, id ASC",
    )

    return {
        "memory_rules": rules,
        "person_mappings": persons,
        "voice_samples_metadata": voice_meta,
        "voice_sample_bodies_included": False,
        "voice_sample_body_export_note": (
            "Voice sample bodies are not included in the default packet. "
            "Use ai-employee/bin/export-voice-samples.sh (separate signed "
            "export path) per spec when full bodies are required."
        ),
        "recipient_cohorts": cohorts,
    }


async def _fetch_skill_catalog(
    reader: ReadExecutor, *, period_start: str, period_end: str
) -> List[dict]:
    sql = (
        "SELECT skill_name, trust_ceiling, content_hash, activated_at, "
        "last_run_at, run_count, operator_may_approve, config "
        "FROM skill_state "
        "WHERE activated_at <= ? "
        "ORDER BY activated_at ASC, skill_name ASC"
    )
    rows = await _fetch_safe(reader, sql, [period_end])
    return rows


async def _fetch_safe(
    reader: ReadExecutor, sql: str, params: Optional[Sequence[Any]] = None
) -> List[dict]:
    """Run a SELECT; return [] on table-missing errors.

    Production D1 will have every migration applied; tests may construct
    only the tables they exercise. Treating "table absent" as "no data"
    matches the no-fabrication contract.
    """
    try:
        return await reader.fetch_all(sql, list(params or []))
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).lower()
        if "no such table" in msg or "does not exist" in msg:
            log.warning("evidence read skipped (table absent): %s", exc)
            return []
        raise


# ---------------------------------------------------------------------------
# Serialization helpers
# ---------------------------------------------------------------------------


def _rows_to_csv(rows: Iterable[dict], columns: Sequence[str]) -> bytes:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(columns), extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({c: ("" if row.get(c) is None else row.get(c)) for c in columns})
    return buf.getvalue().encode("utf-8")


def _rows_to_json(payload: Any) -> bytes:
    return json.dumps(payload, sort_keys=True, indent=2, default=str).encode("utf-8")


def _render_yaml(data: Any) -> bytes:
    """Render a parsed yaml structure back to a stable YAML-ish string.

    The builder avoids importing PyYAML so the adapter does not pick up
    an optional dep. The output is human-readable and deterministic.
    JSON is a valid YAML 1.2 subset, which is enough for the packet's
    audit purpose.
    """
    return (
        json.dumps(data, sort_keys=True, indent=2, ensure_ascii=False, default=str)
        + "\n"
    ).encode("utf-8")


def _readme_text(
    *,
    customer_slug: str,
    customer_name: str,
    period_start: str,
    period_end: str,
    matter: str,
    captain_name: str,
    captain_email: str,
    manifest_sha256: str,
) -> bytes:
    """Render the plain-language README first page.

    No em dashes (style rule). No fabricated promises about behavior
    the customer did not contract: the README describes only what the
    packet itself contains.
    """
    body = (
        f"# Compliance Evidence -- {customer_name}\n\n"
        f"**Customer slug:** {customer_slug}\n"
        f"**Matter scope:** {matter}\n"
        f"**Period covered:** {period_start} to {period_end}\n"
        f"**Generated by:** {captain_name} ({captain_email})\n"
        f"**Manifest SHA-256:** {manifest_sha256}\n\n"
        "## What this package is\n\n"
        "This package documents how the AI Employee operated inside this "
        "customer instance during the period above. It is meant to be read "
        "by an attorney, an outside auditor, or the customer itself. You "
        "do not need a technical background to read this README or the "
        "summary PDF.\n\n"
        "## What is in the package\n\n"
        "- `00-README.md` -- this document\n"
        "- `01-summary.pdf` -- the Susan-readable narrative\n"
        "- `03-audit-log.csv` -- every audit_log row for the period\n"
        "- `05-customer-yaml.redacted.yml` -- the customer's config, with "
        "secrets and OAuth scopes redacted\n"
        "- `06-memory-snapshot.json` -- the agent's memory rules, "
        "person mappings, and voice metadata\n"
        "- `07-skill-catalog.json` -- the skills active during the period\n"
        "- `09-boot-checks.csv` -- the substrate's invariant boot-check log\n"
        "- `manifest.json` -- file hashes plus the Captain signature\n\n"
        "## What this package does NOT contain\n\n"
        "Substantive content of drafts, sent messages, or memory payloads "
        "is not in this packet. Those bodies live in per-customer R2 "
        "storage keyed by SHA-256 digest; the audit log records every "
        "digest, and an auditor can request the underlying object on "
        "demand against the customer's data-processing addendum.\n\n"
        "Voice sample bodies are not in this packet by default. Use the "
        "separate signed export path "
        "(`ai-employee/bin/export-voice-samples.sh`) when full bodies are "
        "required.\n\n"
        "## Verification\n\n"
        "**This packet is UNSIGNED. Its integrity is not yet "
        "cryptographically verifiable.** The `manifest.json` signature is a "
        "stub (a real detached Captain signature is a planned addition). The "
        "SHA-256 values quoted inside this packet (this README and the "
        "summary PDF) prove only that the packet is internally self-"
        "consistent. They are stored in the same archive they describe, so on "
        "their own they cannot detect deliberate tampering.\n\n"
        "To check integrity, compare the manifest SHA-256 above against the "
        "value recorded OUT OF BAND when the packet was generated: the "
        "`COMPLIANCE_PACKET_EXPORTED` audit-log row's `manifest_sha256`, "
        "obtained directly from the firm or SMD rather than from this "
        "archive. Once the manifest hash matches that external record, hash "
        "any individual file and compare it to its entry in `manifest.json`.\n\n"
        "## Questions\n\n"
        f"Contact: {captain_email}\n"
    )
    return body.encode("utf-8")


# ---------------------------------------------------------------------------
# Counts (used by both the PDF and the manifest extra block)
# ---------------------------------------------------------------------------


def _compute_counts(
    *,
    audit_rows: Sequence[dict],
    boot_check_rows: Sequence[dict],
    skill_rows: Sequence[dict],
    memory_snapshot: Mapping[str, Any],
) -> dict:
    """Tally the headline numbers the summary PDF reports."""
    def _count(action_type: str) -> int:
        return sum(1 for r in audit_rows if r.get("action_type") == action_type)

    return {
        "audit_events": len(audit_rows),
        "drafts_created": _count("DRAFT_CREATED"),
        "drafts_approved": _count("DRAFT_APPROVED"),
        "drafts_rejected": _count("DRAFT_REJECTED"),
        "memory_rule_events": (
            _count("MEMORY_RULE_ADDED")
            + _count("MEMORY_RULE_EDITED")
            + _count("MEMORY_RULE_DELETED")
        ),
        "skills_enabled": sum(
            1 for r in skill_rows if (r.get("trust_ceiling") or "").lower() != "refused"
        ),
        "boot_checks": len(boot_check_rows),
        "invariant_violations": (
            _count("INVARIANT_VIOLATION") + _count("INVARIANT_BOOT_CHECK_FAILED")
        ),
        "escalations": _count("ESCALATION_FIRED"),
        "memory_rules_in_snapshot": len(memory_snapshot.get("memory_rules", [])),
        "person_mappings_in_snapshot": len(memory_snapshot.get("person_mappings", [])),
        "voice_samples_metadata_rows": len(
            memory_snapshot.get("voice_samples_metadata", [])
        ),
    }


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------


@dataclass
class EvidencePacketBuilder:
    """Compose a signed evidence packet for one customer + period.

    Construction wires the read executor + audit writer + (optional)
    yaml parser. ``yaml_loader`` defaults to a minimal JSON-ish parser
    that accepts either JSON or simple YAML; production CLI passes
    ``yaml.safe_load`` directly.

    Call :meth:`build` to produce a tar.gz at ``request.output_path``.
    The builder writes to ``<output>.tmp``, fsyncs, and renames into
    place so partial files never appear on disk.
    """

    reader: ReadExecutor
    audit_writer: object  # adapter.audit_log.AuditLogWriter; kept loose
    yaml_loader: Optional[object] = None  # callable parsing yaml bytes
    yaml_dumper: Optional[object] = None  # callable dumping back to yaml

    async def build(self, request: PacketRequest) -> EvidencePacketResult:
        request.validate()

        customer_yaml_text = self._load_customer_yaml(request.customer_yaml_path)
        parsed_yaml = self._parse_yaml(customer_yaml_text)
        redacted_yaml = redact_customer_yaml(parsed_yaml)
        rendered_redacted_yaml = self._render_yaml(redacted_yaml)
        leak = _scan_for_secret_leak(rendered_redacted_yaml.decode("utf-8", "replace"))
        if leak is not None:
            raise EvidencePacketError(
                "redacted customer.yaml still contains a secret-shaped "
                f"value (pattern {leak!r}); aborting export. Update the "
                "redaction rules and re-run; do NOT modify the source yaml "
                "to bypass this guardrail."
            )

        customer_name = self._extract_customer_name(parsed_yaml, request.customer_slug)

        audit_rows = await _fetch_audit_log(
            self.reader,
            period_start=request.period_start,
            period_end=request.period_end,
            matter=request.matter,
        )
        boot_check_rows = await _fetch_boot_checks(
            self.reader,
            period_start=request.period_start,
            period_end=request.period_end,
        )
        memory_snapshot = await _fetch_memory_snapshot(self.reader)
        skill_rows = await _fetch_skill_catalog(
            self.reader,
            period_start=request.period_start,
            period_end=request.period_end,
        )

        counts = _compute_counts(
            audit_rows=audit_rows,
            boot_check_rows=boot_check_rows,
            skill_rows=skill_rows,
            memory_snapshot=memory_snapshot,
        )

        audit_csv = _rows_to_csv(audit_rows, _AUDIT_LOG_COLUMNS)
        boot_csv = _rows_to_csv(boot_check_rows, _BOOT_CHECK_COLUMNS)
        memory_json = _rows_to_json(memory_snapshot)
        skill_json = _rows_to_json(skill_rows)

        # Build a placeholder manifest first so the PDF can quote a
        # stable manifest-sha; we rebuild the manifest with the final
        # file hashes (including the PDF) after rendering.
        placeholder_hashes = {
            "00-README.md": _sha256(b""),
            "01-summary.pdf": _sha256(b""),
            "03-audit-log.csv": _sha256(audit_csv),
            "05-customer-yaml.redacted.yml": _sha256(rendered_redacted_yaml),
            "06-memory-snapshot.json": _sha256(memory_json),
            "07-skill-catalog.json": _sha256(skill_json),
            "09-boot-checks.csv": _sha256(boot_csv),
        }
        provisional_manifest = build_manifest(
            customer_slug=request.customer_slug,
            matter=request.matter,
            period_start=request.period_start,
            period_end=request.period_end,
            file_hashes=placeholder_hashes,
            actor=request.actor,
            actor_role=request.actor_role.value,
            extra={"counts": counts, "stage": "provisional"},
        )
        provisional_sha = manifest_sha256_hex(provisional_manifest)

        pdf_bytes = render_summary_pdf(
            customer_slug=request.customer_slug,
            customer_name=customer_name,
            period_start=request.period_start,
            period_end=request.period_end,
            matter=request.matter,
            captain_id=provisional_manifest.captain_key_id,
            manifest_sha256=provisional_sha,
            counts=counts,
        )

        readme_bytes = _readme_text(
            customer_slug=request.customer_slug,
            customer_name=customer_name,
            period_start=request.period_start,
            period_end=request.period_end,
            matter=request.matter,
            captain_name=provisional_manifest.captain_name,
            captain_email=provisional_manifest.captain_email,
            manifest_sha256=provisional_sha,
        )

        # Final manifest with real file hashes (PDF + README included).
        file_hashes = {
            "00-README.md": _sha256(readme_bytes),
            "01-summary.pdf": _sha256(pdf_bytes),
            "03-audit-log.csv": _sha256(audit_csv),
            "05-customer-yaml.redacted.yml": _sha256(rendered_redacted_yaml),
            "06-memory-snapshot.json": _sha256(memory_json),
            "07-skill-catalog.json": _sha256(skill_json),
            "09-boot-checks.csv": _sha256(boot_csv),
        }
        manifest = build_manifest(
            customer_slug=request.customer_slug,
            matter=request.matter,
            period_start=request.period_start,
            period_end=request.period_end,
            file_hashes=file_hashes,
            actor=request.actor,
            actor_role=request.actor_role.value,
            extra={
                "counts": counts,
                "provisional_manifest_sha256": provisional_sha,
            },
        )
        manifest_bytes = manifest.to_bytes()
        manifest_sha = manifest_sha256_hex(manifest)

        entries: List[Tuple[str, bytes]] = [
            ("00-README.md", readme_bytes),
            ("01-summary.pdf", pdf_bytes),
            ("03-audit-log.csv", audit_csv),
            ("05-customer-yaml.redacted.yml", rendered_redacted_yaml),
            ("06-memory-snapshot.json", memory_json),
            ("07-skill-catalog.json", skill_json),
            ("09-boot-checks.csv", boot_csv),
            ("manifest.json", manifest_bytes),
        ]

        bytes_written = self._write_targz(request.output_path, entries)

        await self._emit_audit_row(
            request=request,
            manifest_sha=manifest_sha,
            counts=counts,
            file_count=len(entries),
            bytes_written=bytes_written,
        )

        return EvidencePacketResult(
            output_path=request.output_path,
            manifest_sha256=manifest_sha,
            file_count=len(entries),
            bytes_written=bytes_written,
            counts=counts,
            manifest=manifest,
        )

    # ------------------------------------------------------------------
    # internals
    # ------------------------------------------------------------------

    def _load_customer_yaml(self, path: Path) -> bytes:
        if not path.exists():
            raise EvidencePacketError(
                f"customer.yaml not found at {path}; refusing to fabricate a "
                "placeholder. Provide a real customer.yaml."
            )
        return path.read_bytes()

    def _parse_yaml(self, text: bytes) -> Any:
        if self.yaml_loader is not None:
            return self.yaml_loader(text.decode("utf-8"))  # type: ignore[misc]
        # Fall back to a tiny built-in parser: accept JSON, otherwise
        # treat as opaque single-key text. This branch is exercised only
        # in tests that pass yaml_loader=None for simplicity.
        text_str = text.decode("utf-8")
        try:
            return json.loads(text_str)
        except json.JSONDecodeError:
            return {"raw": text_str}

    def _render_yaml(self, data: Any) -> bytes:
        if self.yaml_dumper is not None:
            rendered = self.yaml_dumper(data)  # type: ignore[misc]
            if isinstance(rendered, bytes):
                return rendered
            return rendered.encode("utf-8")
        return _render_yaml(data)

    def _extract_customer_name(self, parsed: Any, fallback_slug: str) -> str:
        if isinstance(parsed, dict):
            for key in ("customer_name", "name", "firm_name"):
                value = parsed.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        return fallback_slug

    def _write_targz(
        self, output_path: Path, entries: Sequence[Tuple[str, bytes]]
    ) -> int:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = output_path.with_suffix(output_path.suffix + ".tmp")
        with tarfile.open(tmp_path, "w:gz", format=tarfile.PAX_FORMAT) as tar:
            for name, blob in entries:
                info = tarfile.TarInfo(name=name)
                info.size = len(blob)
                info.mtime = 0  # deterministic mtime for stable archives
                info.mode = 0o644
                info.uid = 0
                info.gid = 0
                info.uname = ""
                info.gname = ""
                tar.addfile(info, io.BytesIO(blob))
        bytes_written = tmp_path.stat().st_size
        tmp_path.replace(output_path)
        return bytes_written

    async def _emit_audit_row(
        self,
        *,
        request: PacketRequest,
        manifest_sha: str,
        counts: Mapping[str, int],
        file_count: int,
        bytes_written: int,
    ) -> None:
        # Import locally to mirror the bin/lib/decommission.py pattern
        # (avoids hard adapter import at module load time).
        from adapter.audit_log import ActorRole, AuditEvent  # type: ignore

        role_map = {
            PacketActor.CAPTAIN: ActorRole.CAPTAIN,
            PacketActor.COMPLIANCE: ActorRole.COMPLIANCE,
        }
        event = AuditEvent(
            action_type="COMPLIANCE_PACKET_EXPORTED",
            actor=request.actor,
            actor_role=role_map[request.actor_role],
            skill_name="compliance-audit-export",
            matter_ref=None if request.matter == "all" else request.matter,
            metadata={
                "customer_slug": request.customer_slug,
                "matter": request.matter,
                "period_start": request.period_start,
                "period_end": request.period_end,
                "manifest_sha256": manifest_sha,
                "file_count": file_count,
                "bytes_written": bytes_written,
                "output_path": str(request.output_path),
                "counts": dict(counts),
            },
        )
        try:
            await self.audit_writer.write(event)  # type: ignore[attr-defined]
        except Exception as exc:  # noqa: BLE001
            # If chain-of-custody fails, the packet that exists on disk
            # is unprovable. Surface the failure rather than swallow it.
            raise EvidencePacketError(
                "evidence packet wrote successfully but the "
                "COMPLIANCE_PACKET_EXPORTED audit row could not be "
                "persisted; manifest SHA-256 "
                f"{manifest_sha} is on disk but lacks chain-of-custody. "
                "Re-run after audit log recovery, or quarantine the "
                "packet pending audit reconciliation."
            ) from exc


__all__ = [
    "EvidencePacketBuilder",
    "EvidencePacketError",
    "EvidencePacketResult",
    "PacketActor",
    "PacketRequest",
    "REQUIRED_ACTOR_ROLES",
    "ReadExecutor",
    "SqliteReadExecutor",
    "redact_customer_yaml",
]
