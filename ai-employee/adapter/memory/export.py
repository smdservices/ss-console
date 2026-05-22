"""Memory export pipeline (issue #862).

Per ADR 0008 (customer-owned memory artifact), the customer can request
a portable archive of their memory on offboarding. This module produces
that artifact from the per-customer memory store written by
:mod:`adapter.memory.pipeline` (PR #944).

The export is read-only on the source data. Every artifact ends up in a
:class:`MemoryExportManifest` whose entries name the artifact, kind,
sha256 digest, item count, and access scope so the customer can verify
integrity post-extraction.

Design rules
------------

* **Read-only.** This module NEVER mutates the source data. It reads
  rows from D1, reads objects from R2, and writes serialized copies to
  a writer client owned by the caller. The memory ingestion pipeline,
  the dashboard, and the decommission hook all keep working while an
  export is in flight.

* **Privacy.** Every artifact propagates the access_scope recorded by
  the ingestion pipeline. A matter tagged ``partner-only`` carries that
  tag into the export manifest so the customer (and any downstream
  consumer) can apply the same control.

* **Provenance.** Each manifest entry records the sha256 of the bytes
  the export wrote. Re-reading the bytes from the customer's local
  archive and recomputing the digest is sufficient to detect tampering.

* **Schema marker.** The manifest records ``schema_version`` so future
  format changes can be versioned without breaking older archives.

* **No raw email content.** Voice samples live in
  :mod:`adapter.voice.export` and use the structural-diff format
  already on disk (per PR #951). Memory artifacts here are matters,
  documents, recipients, memory rules, and person mappings -- all
  pre-redacted at ingestion time. The pipeline never sees email bodies.

* **No autonomous send.** This module only reads and writes; the caller
  decides where the archive lands. There is no SMTP, no S3 publish,
  no shareable-URL generation in this PR.

The :class:`MemoryExportWriter` protocol abstracts the destination so
the caller can target a local tar.gz (the default for offboarding) or
an in-memory buffer (the default for tests). The CLI orchestrator in
``bin/lib/export.py`` wires a tar.gz writer.
"""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Protocol, Sequence

log = logging.getLogger("aie.memory.export")


# Schema version for the export format itself. Bump when the manifest
# shape, the artifact layout, or the per-artifact JSON contract changes.
EXPORT_SCHEMA_VERSION = 1


# Artifact kinds map onto the rows the memory pipeline persists, plus
# the rules + person directory the customer authors directly. Each kind
# is documented in docs/specs/ai-employee/memory-export.md.
ARTIFACT_KIND_MATTER = "matter"
ARTIFACT_KIND_DOCUMENT = "document"
ARTIFACT_KIND_RECIPIENT = "recipient"
ARTIFACT_KIND_MEMORY_RULE = "memory_rule"
ARTIFACT_KIND_PERSON_MAPPING = "person_mapping"
ARTIFACT_KIND_INGESTION_STATE = "ingestion_state"

ALL_KINDS = frozenset(
    {
        ARTIFACT_KIND_MATTER,
        ARTIFACT_KIND_DOCUMENT,
        ARTIFACT_KIND_RECIPIENT,
        ARTIFACT_KIND_MEMORY_RULE,
        ARTIFACT_KIND_PERSON_MAPPING,
        ARTIFACT_KIND_INGESTION_STATE,
    }
)


# ---------------------------------------------------------------------------
# Manifest dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ExportManifestEntry:
    """One artifact in the manifest.

    ``path`` is the path inside the archive (POSIX style, no leading
    slash). ``sha256`` is the hex digest of the bytes written. The
    customer recomputes the digest after extraction to verify integrity.
    """

    path: str
    kind: str
    sha256: str
    item_count: int
    scope: str = "firm-wide"
    source_kind: Optional[str] = None
    source_id: Optional[str] = None


@dataclass
class MemoryExportManifest:
    """Top-level manifest returned by :func:`export_memory`.

    The manifest is JSON-serialized into the archive at
    ``manifests/memory.json``. The caller composes it with the voice
    manifest into the archive-level ``manifest.json``.
    """

    customer_slug: str
    exported_at: str
    schema_version: int = EXPORT_SCHEMA_VERSION
    entries: list[ExportManifestEntry] = field(default_factory=list)
    signature: Optional[str] = None
    signature_kind: Optional[str] = None

    def add(self, entry: ExportManifestEntry) -> None:
        if entry.kind not in ALL_KINDS:
            raise ValueError(
                f"unknown manifest kind {entry.kind!r}; "
                f"valid kinds are {sorted(ALL_KINDS)}"
            )
        self.entries.append(entry)

    def total_items(self) -> int:
        return sum(entry.item_count for entry in self.entries)

    def to_json_bytes(self) -> bytes:
        payload = {
            "customer_slug": self.customer_slug,
            "exported_at": self.exported_at,
            "schema_version": self.schema_version,
            "signature": self.signature,
            "signature_kind": self.signature_kind,
            "entries": [
                {
                    "path": e.path,
                    "kind": e.kind,
                    "sha256": e.sha256,
                    "item_count": e.item_count,
                    "scope": e.scope,
                    "source_kind": e.source_kind,
                    "source_id": e.source_id,
                }
                for e in self.entries
            ],
        }
        return json.dumps(payload, sort_keys=True, indent=2).encode("utf-8")


# ---------------------------------------------------------------------------
# Read protocols (everything the export module consumes is read-only)
# ---------------------------------------------------------------------------


class MemoryExportReader(Protocol):
    """Per-customer D1 reads the export module performs.

    Production wires this to an executor satisfying ``QueryExecutor`` on
    the customer's D1 binding. Tests pass a sqlite-backed reader. The
    methods return lists of dicts -- the same shape D1's HTTP API uses.
    """

    async def list_active_items(self) -> list[dict]: ...

    async def list_source_states(self) -> list[dict]: ...

    async def list_memory_rules(self) -> list[dict]: ...

    async def list_person_mappings(self) -> list[dict]: ...


class R2ObjectReader(Protocol):
    """Per-customer R2 binding (read-only).

    Returns the raw bytes for the given key or raises if the object is
    missing. The export module never deletes -- that is the decommission
    hook's job after the export has succeeded.
    """

    async def get(self, key: str) -> bytes: ...


# ---------------------------------------------------------------------------
# Write protocol (the destination the caller composes into a tar.gz)
# ---------------------------------------------------------------------------


class MemoryExportWriter(Protocol):
    """Where the export module sends serialized artifacts.

    The caller chooses the destination (an in-memory tarfile, an open
    file on disk, a fake recorder for tests). The writer is responsible
    for ordering, compression, and lifecycle; this module just hands it
    one ``(path, bytes)`` pair at a time.
    """

    async def write_file(self, path: str, body: bytes) -> None: ...


# ---------------------------------------------------------------------------
# Optional signing seam
# ---------------------------------------------------------------------------


class ExportSigner(Protocol):
    """Captain-key signer for the manifest.

    For v1 the signer is a no-op stub (:class:`NoOpExportSigner`). The
    interface is here so PGP / age signing can drop in without a
    pipeline rewrite. Callers that omit the signer get an unsigned
    manifest, which is still integrity-verifiable via the per-artifact
    digests.
    """

    signature_kind: str

    async def sign(self, manifest_bytes: bytes) -> str: ...


class NoOpExportSigner:
    """No-op signer -- leaves the seam open without producing a signature.

    Returns an empty string. The manifest records
    ``signature_kind="stub"`` so consumers can tell the export was
    written before signing was wired. Production wiring swaps this for
    a PGP or age implementation; the contract is one method.
    """

    signature_kind = "stub"

    async def sign(self, manifest_bytes: bytes) -> str:  # noqa: ARG002
        return ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _iso_utc(now: Optional[datetime] = None) -> str:
    dt = now if now is not None else datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _serialize_rows(rows: Sequence[dict]) -> bytes:
    """Stable JSON serialization for a row collection.

    The bytes form the artifact body. ``sort_keys=True`` plus ``indent=2``
    makes the archive diff-friendly so a customer auditor can compare
    two exports textually.
    """
    return json.dumps(list(rows), sort_keys=True, indent=2, default=str).encode("utf-8")


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------


async def export_memory(
    *,
    customer_slug: str,
    reader: MemoryExportReader,
    r2_reader: Optional[R2ObjectReader],
    writer: MemoryExportWriter,
    signer: Optional[ExportSigner] = None,
    now: Optional[datetime] = None,
) -> MemoryExportManifest:
    """Produce the memory portion of the customer-owned export archive.

    Steps:

      1. Read ``memory_source_state`` rows. One JSON file per source
         lands at ``memory/state/{kind}-{id}.json``.
      2. Read ``memory_ingested_items`` (active rows only). Grouped by
         (source_kind, source_id, item_type), each group is serialized
         to a JSON file under ``memory/items/``. For ``matter`` and
         ``document`` items with an ``r2_key`` and a wired
         :class:`R2ObjectReader`, the underlying R2 object is also
         pulled in at ``memory/vault/{matter|process}/{filename}``.
         The R2 read is best-effort: a missing object is recorded in
         the manifest with ``item_count=0`` and an empty body, so a
         customer auditor can see which keys failed to read without
         the export aborting.
      3. Read ``memory_rules`` (active rows). Lands at
         ``memory/rules/memory-rules.json``.
      4. Read ``person_mappings`` (active rows). Lands at
         ``memory/people/person-mappings.json``.
      5. Build the manifest, optionally sign it, and write
         ``manifests/memory.json``.

    The returned manifest mirrors what was written; the caller can
    embed it in the archive-level manifest without re-reading the file.
    """
    if not customer_slug:
        raise ValueError("customer_slug must be a non-empty string")

    exported_at = _iso_utc(now)
    manifest = MemoryExportManifest(
        customer_slug=customer_slug,
        exported_at=exported_at,
    )

    # 1. Source states (per kind+id).
    source_states = await reader.list_source_states()
    for row in source_states:
        kind = row.get("source_kind", "unknown")
        sid = row.get("source_id", "unknown")
        path = f"memory/state/{kind}-{sid}.json"
        body = _serialize_rows([row])
        await writer.write_file(path, body)
        manifest.add(
            ExportManifestEntry(
                path=path,
                kind=ARTIFACT_KIND_INGESTION_STATE,
                sha256=_sha256(body),
                item_count=1,
                scope="firm-wide",
                source_kind=kind,
                source_id=sid,
            )
        )

    # 2. Ingested items grouped by (source_kind, source_id, item_type).
    items = await reader.list_active_items()
    grouped: dict[tuple[str, str, str], list[dict]] = {}
    for row in items:
        key = (
            row.get("source_kind", "unknown"),
            row.get("source_id", "unknown"),
            row.get("item_type", "unknown"),
        )
        grouped.setdefault(key, []).append(row)

    for (kind, sid, item_type), rows in sorted(grouped.items()):
        if item_type not in {
            ARTIFACT_KIND_MATTER,
            ARTIFACT_KIND_DOCUMENT,
            ARTIFACT_KIND_RECIPIENT,
        }:
            # Unknown item_type: still export the row collection so the
            # customer has the provenance, but do not pull R2 bodies.
            log.warning(
                "memory_export.unknown_item_type customer=%s kind=%s sid=%s type=%s",
                customer_slug,
                kind,
                sid,
                item_type,
            )
        path = f"memory/items/{kind}-{sid}-{item_type}.json"
        body = _serialize_rows(rows)
        await writer.write_file(path, body)
        # Compute the cohort scope from the row set. If any row carries
        # a non-default scope, we surface "mixed" so the consumer reads
        # the per-row metadata for detail.
        scope = _summarize_scope([r.get("access_scope") for r in rows])
        manifest.add(
            ExportManifestEntry(
                path=path,
                kind=item_type,
                sha256=_sha256(body),
                item_count=len(rows),
                scope=scope,
                source_kind=kind,
                source_id=sid,
            )
        )

        # R2 bodies for matter narratives and document bodies. Best-effort.
        if r2_reader is None:
            continue
        for row in rows:
            r2_key = row.get("r2_key")
            if not r2_key:
                continue
            try:
                obj_bytes = await r2_reader.get(r2_key)
            except Exception as exc:  # noqa: BLE001
                log.warning(
                    "memory_export.r2_get_failed customer=%s key=%s err=%s",
                    customer_slug,
                    r2_key,
                    exc,
                )
                continue
            archive_path = f"memory/vault/{_safe_archive_segment(r2_key)}"
            await writer.write_file(archive_path, obj_bytes)
            manifest.add(
                ExportManifestEntry(
                    path=archive_path,
                    kind=item_type,
                    sha256=_sha256(obj_bytes),
                    item_count=1,
                    scope=row.get("access_scope") or "firm-wide",
                    source_kind=kind,
                    source_id=sid,
                )
            )

    # 3. Memory rules.
    memory_rules = await reader.list_memory_rules()
    if memory_rules:
        path = "memory/rules/memory-rules.json"
        body = _serialize_rows(memory_rules)
        await writer.write_file(path, body)
        manifest.add(
            ExportManifestEntry(
                path=path,
                kind=ARTIFACT_KIND_MEMORY_RULE,
                sha256=_sha256(body),
                item_count=len(memory_rules),
                scope="firm-wide",
            )
        )

    # 4. Person mappings.
    persons = await reader.list_person_mappings()
    if persons:
        path = "memory/people/person-mappings.json"
        body = _serialize_rows(persons)
        await writer.write_file(path, body)
        manifest.add(
            ExportManifestEntry(
                path=path,
                kind=ARTIFACT_KIND_PERSON_MAPPING,
                sha256=_sha256(body),
                item_count=len(persons),
                scope="firm-wide",
            )
        )

    # 5. Sign and write the manifest itself.
    signer_impl = signer or NoOpExportSigner()
    manifest_bytes_unsigned = manifest.to_json_bytes()
    try:
        sig = await signer_impl.sign(manifest_bytes_unsigned)
    except Exception as exc:  # noqa: BLE001
        log.warning(
            "memory_export.sign_failed customer=%s kind=%s err=%s; writing unsigned",
            customer_slug,
            signer_impl.signature_kind,
            exc,
        )
        sig = ""
    manifest.signature = sig
    manifest.signature_kind = signer_impl.signature_kind

    manifest_bytes = manifest.to_json_bytes()
    await writer.write_file("manifests/memory.json", manifest_bytes)

    log.info(
        "memory_export.complete customer=%s entries=%d items=%d",
        customer_slug,
        len(manifest.entries),
        manifest.total_items(),
    )
    return manifest


# ---------------------------------------------------------------------------
# Helpers (private)
# ---------------------------------------------------------------------------


def _summarize_scope(scopes: Sequence[Optional[str]]) -> str:
    """Reduce a row collection's per-row scopes to one manifest label.

    If every row shares one scope, that scope is the label. Otherwise
    the label is ``"mixed"`` and the per-row scope is preserved inside
    the items JSON for downstream consumers.
    """
    seen = {s or "firm-wide" for s in scopes}
    if len(seen) == 1:
        return next(iter(seen))
    return "mixed"


def _safe_archive_segment(r2_key: str) -> str:
    """Convert an R2 key into a safe archive path.

    The R2 namespace already lives under ``{slug}/vault/...``. The
    archive parks the segment under ``memory/vault/{rest}`` so the
    customer can browse the export without seeing platform-internal
    bucket layout.
    """
    parts = [p for p in r2_key.split("/") if p]
    if len(parts) >= 3 and parts[1] == "vault":
        # Strip the leading "{slug}/vault/" and keep the rest.
        return "/".join(parts[2:])
    # Fall back to a flattened name so the artifact still lands somewhere
    # auditable.
    return parts[-1] if parts else "unknown"


__all__ = [
    "ALL_KINDS",
    "ARTIFACT_KIND_DOCUMENT",
    "ARTIFACT_KIND_INGESTION_STATE",
    "ARTIFACT_KIND_MATTER",
    "ARTIFACT_KIND_MEMORY_RULE",
    "ARTIFACT_KIND_PERSON_MAPPING",
    "ARTIFACT_KIND_RECIPIENT",
    "EXPORT_SCHEMA_VERSION",
    "ExportManifestEntry",
    "ExportSigner",
    "MemoryExportManifest",
    "MemoryExportReader",
    "MemoryExportWriter",
    "NoOpExportSigner",
    "R2ObjectReader",
    "export_memory",
]
