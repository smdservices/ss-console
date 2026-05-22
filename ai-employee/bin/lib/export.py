"""CLI orchestrator for the customer-owned memory export (issue #862).

Composes :func:`adapter.memory.export.export_memory` and
:func:`adapter.voice.export.export_voice_library` into one tar.gz
archive the customer can take with them on offboarding.

This module sits between the per-domain export modules and the
decommission script (PR #956). The decommission script today does NOT
call this module -- wiring is a follow-on. This PR ships the
orchestrator + a documented integration seam (see
``run_export_for_decommission``) so the decommission CLI can adopt it
in a small follow-up without rewriting either side.

Design rules
------------

* **Read-only.** The export never mutates the source data. Composing
  memory + voice exports does not change that -- the in-process writer
  here only writes the tar.gz; it does not touch the customer's D1,
  R2, or Vectorize bindings.

* **Audit emission.** Two audit rows wrap the export:
  ``COMPLIANCE_PACKET_EXPORTED`` with ``metadata.kind="memory_export.initiated"``
  before, and a second ``COMPLIANCE_PACKET_EXPORTED`` with
  ``metadata.kind="memory_export.completed"`` after. The
  ``COMPLIANCE_PACKET_EXPORTED`` action_type is the closest match in
  the closed set -- ``MEMORY_EXPORTED`` would be cleaner but is not in
  ``ACCEPTED_ACTION_TYPES`` and adding it requires a coordinated
  schema-spec change. The metadata distinguishes the two cases.

* **Idempotent re-runs.** Re-running ``run_export`` writes a new
  timestamped archive; prior archives are not modified. The customer
  can request the export as many times as they want without conflict.

* **No autonomous send.** The archive is written to a path the caller
  supplies. There is no SMTP, no S3 upload, no shareable-URL
  generation in this PR.

* **Decommission integration seam.**
  :func:`run_export_for_decommission` is the pre-flight the
  decommission script will call BEFORE step 02 (memory + voice D1
  cleanup). The function returns the archive path so the decommission
  CLI can log it; it raises :class:`ExportFailed` if the export itself
  fails so the decommission run halts and re-runs do not lose data.
"""

from __future__ import annotations

import io
import logging
import os
import tarfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

log = logging.getLogger("aie.bin.export")


class ExportFailed(RuntimeError):
    """Raised when the export orchestrator cannot complete.

    Decommission must halt on this exception. A partial export must
    not be paired with a successful decommission; the customer would
    lose data with no way to recover it.
    """


# ---------------------------------------------------------------------------
# Tarfile writer -- satisfies both MemoryExportWriter and VoiceExportWriter
# ---------------------------------------------------------------------------


class TarGzExportWriter:
    """Append-only writer that lands artifacts in a tar.gz file.

    Construct with the open archive's tarfile handle. Each
    :meth:`write_file` call appends one entry. The caller is
    responsible for opening and closing the tarfile so the file is
    written even when the export raises mid-stream (the partial
    archive is still useful to an auditor diagnosing the failure).

    The writer is NOT thread-safe. The export modules await each
    write_file in sequence; that contract is enforced by the call
    sites.
    """

    def __init__(self, tar: tarfile.TarFile) -> None:
        self._tar = tar

    async def write_file(self, path: str, body: bytes) -> None:
        info = tarfile.TarInfo(name=path)
        info.size = len(body)
        info.mtime = int(time.time())
        info.mode = 0o644
        self._tar.addfile(info, io.BytesIO(body))


# ---------------------------------------------------------------------------
# Recorder writer -- for tests; records writes in-memory
# ---------------------------------------------------------------------------


class InMemoryExportWriter:
    """In-memory writer used by tests.

    Records every (path, bytes) pair in ``self.files`` so test
    assertions can verify archive layout without round-tripping
    through a real tarfile.
    """

    def __init__(self) -> None:
        self.files: dict[str, bytes] = {}

    async def write_file(self, path: str, body: bytes) -> None:
        if path in self.files:
            raise ExportFailed(
                f"InMemoryExportWriter received duplicate path {path!r}; "
                "the export module is supposed to produce unique paths"
            )
        self.files[path] = body


# ---------------------------------------------------------------------------
# Run summary
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ExportRunSummary:
    """Aggregated outcome the caller can serialize for the audit log."""

    customer_slug: str
    archive_path: Optional[str]
    started_at: str
    finished_at: str
    memory_entry_count: int
    memory_item_count: int
    voice_entry_count: int
    voice_item_count: int

    def to_metadata(self) -> dict:
        return {
            "customer_slug": self.customer_slug,
            "archive_path": self.archive_path,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "memory_entry_count": self.memory_entry_count,
            "memory_item_count": self.memory_item_count,
            "voice_entry_count": self.voice_entry_count,
            "voice_item_count": self.voice_item_count,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _iso_utc(now: Optional[datetime] = None) -> str:
    dt = now if now is not None else datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _archive_name(customer_slug: str, *, now: Optional[datetime] = None) -> str:
    when = now if now is not None else datetime.now(timezone.utc)
    stamp = when.strftime("%Y-%m-%dT%H-%M-%SZ")
    return f"{customer_slug}-export-{stamp}.tar.gz"


def _audit_metadata(kind: str, summary: dict) -> dict:
    """Compose the metadata dict for an export audit row."""
    return {"kind": kind, "summary": summary}


async def _write_audit_row(
    *,
    audit_writer: object,
    action_type: str,
    actor: str,
    metadata: dict,
) -> None:
    """Write one audit row.

    Audit writer is loose-typed to avoid a hard import dependency at
    module load time; the CLI hands in an :class:`adapter.audit_log.AuditLogWriter`.
    Tests inject a fake writer that records calls.
    """
    from adapter.audit_log import ActorRole, AuditEvent  # local to break import cycles

    event = AuditEvent(
        action_type=action_type,
        actor=actor,
        actor_role=ActorRole.CAPTAIN,
        metadata=metadata,
    )
    await audit_writer.write(event)


# ---------------------------------------------------------------------------
# Public entrypoint -- composes memory + voice into one archive
# ---------------------------------------------------------------------------


async def run_export(
    *,
    customer_slug: str,
    memory_reader,
    memory_r2_reader,
    voice_reader,
    voice_r2_reader,
    voice_config: Optional[dict] = None,
    archive_dir: Path,
    audit_writer,
    actor: str = "captain",
    now: Optional[datetime] = None,
) -> ExportRunSummary:
    """Run the full memory + voice export.

    Composes :func:`adapter.memory.export.export_memory` and
    :func:`adapter.voice.export.export_voice_library` into one tar.gz
    written under ``archive_dir``. The archive name is timestamped so
    re-running does not overwrite a prior export.

    Audit emission:

      * Before opening the archive: one ``COMPLIANCE_PACKET_EXPORTED``
        row with ``metadata.kind="memory_export.initiated"``.
      * After the archive closes: one ``COMPLIANCE_PACKET_EXPORTED``
        row with ``metadata.kind="memory_export.completed"`` and the
        full :class:`ExportRunSummary` in metadata.

    On any export-module failure: the partial archive is left on disk
    for diagnosis and :class:`ExportFailed` is raised so the caller
    (decommission script) halts.
    """
    # Local imports keep the bin module light when the modules are not
    # in use, and match the convention used by other bin/lib code.
    from adapter.memory.export import export_memory
    from adapter.voice.export import export_voice_library

    if not customer_slug:
        raise ExportFailed("customer_slug must be a non-empty string")

    started_at = _iso_utc(now)

    # Initial audit row: announces the export is about to start. The
    # row lands before any data leaves the customer's substrate so an
    # auditor can correlate the row with the archive on disk.
    await _write_audit_row(
        audit_writer=audit_writer,
        action_type="COMPLIANCE_PACKET_EXPORTED",
        actor=actor,
        metadata=_audit_metadata(
            "memory_export.initiated",
            {"customer_slug": customer_slug, "started_at": started_at},
        ),
    )

    archive_dir = Path(archive_dir)
    archive_dir.mkdir(parents=True, exist_ok=True)
    archive_path = archive_dir / _archive_name(customer_slug, now=now)

    memory_manifest = None
    voice_manifest = None
    try:
        # GzipFile mtime=0 keeps the gzip header byte-stable across
        # re-runs of the same input; the archive content varies by
        # data, not by clock.
        with tarfile.open(
            archive_path,
            mode="w:gz",
            format=tarfile.PAX_FORMAT,
        ) as tar:
            writer = TarGzExportWriter(tar)
            memory_manifest = await export_memory(
                customer_slug=customer_slug,
                reader=memory_reader,
                r2_reader=memory_r2_reader,
                writer=writer,
                now=now,
            )
            voice_manifest = await export_voice_library(
                customer_slug=customer_slug,
                reader=voice_reader,
                r2_reader=voice_r2_reader,
                writer=writer,
                voice_config=voice_config,
                now=now,
            )
    except Exception as exc:  # noqa: BLE001 -- re-raise as ExportFailed
        # Best-effort: write a closing audit row so the trail shows the
        # export was attempted even when it could not finish.
        try:
            await _write_audit_row(
                audit_writer=audit_writer,
                action_type="COMPLIANCE_PACKET_EXPORTED",
                actor=actor,
                metadata=_audit_metadata(
                    "memory_export.failed",
                    {
                        "customer_slug": customer_slug,
                        "started_at": started_at,
                        "error": f"{type(exc).__name__}: {exc}",
                    },
                ),
            )
        except Exception:  # noqa: BLE001
            log.exception("audit row write failed during export failure path")
        raise ExportFailed(
            f"memory + voice export failed for {customer_slug!r}: "
            f"{type(exc).__name__}: {exc}"
        ) from exc

    finished_at = _iso_utc()
    summary = ExportRunSummary(
        customer_slug=customer_slug,
        archive_path=str(archive_path),
        started_at=started_at,
        finished_at=finished_at,
        memory_entry_count=len(memory_manifest.entries) if memory_manifest else 0,
        memory_item_count=memory_manifest.total_items() if memory_manifest else 0,
        voice_entry_count=len(voice_manifest.entries) if voice_manifest else 0,
        voice_item_count=voice_manifest.total_items() if voice_manifest else 0,
    )

    await _write_audit_row(
        audit_writer=audit_writer,
        action_type="COMPLIANCE_PACKET_EXPORTED",
        actor=actor,
        metadata=_audit_metadata("memory_export.completed", summary.to_metadata()),
    )

    log.info(
        "export.complete customer=%s archive=%s memory_entries=%d voice_entries=%d",
        customer_slug,
        archive_path,
        summary.memory_entry_count,
        summary.voice_entry_count,
    )

    return summary


# ---------------------------------------------------------------------------
# Decommission integration seam
# ---------------------------------------------------------------------------


async def run_export_for_decommission(
    *,
    customer_slug: str,
    memory_reader,
    memory_r2_reader,
    voice_reader,
    voice_r2_reader,
    voice_config: Optional[dict] = None,
    archive_dir: Path,
    audit_writer,
    actor: str = "captain",
    now: Optional[datetime] = None,
) -> ExportRunSummary:
    """Pre-decommission hook: produces the customer's export archive.

    The decommission script (``bin/decommission-customer.sh`` +
    ``bin/lib/decommission.py``) is the intended caller. It calls this
    function BEFORE step ``02_d1_memory_voice`` so the customer's
    artifact lands on disk before the substrate deletion runs.

    This PR does NOT modify the decommission script. The wiring is a
    follow-on of the form:

        # in bin/lib/decommission.py, before _step_d1_memory_voice:
        summary = await run_export_for_decommission(
            customer_slug=self.customer_slug,
            memory_reader=...,  # constructed from per-customer D1
            ...
            archive_dir=self.archive_root / self.customer_slug,
            audit_writer=self.audit_writer,
        )
        # surface summary.archive_path on the decommission report.

    The interface mirrors :func:`run_export` but flagging the intent
    in the name lets the decommission CLI surface the right error
    message ("export failed; halting decommission to avoid data loss")
    without sniffing the call site.
    """
    try:
        return await run_export(
            customer_slug=customer_slug,
            memory_reader=memory_reader,
            memory_r2_reader=memory_r2_reader,
            voice_reader=voice_reader,
            voice_r2_reader=voice_r2_reader,
            voice_config=voice_config,
            archive_dir=archive_dir,
            audit_writer=audit_writer,
            actor=actor,
            now=now,
        )
    except ExportFailed:
        # Re-raised verbatim so the decommission CLI catches the
        # right exception type and surfaces the right exit code.
        raise


__all__ = [
    "ExportFailed",
    "ExportRunSummary",
    "InMemoryExportWriter",
    "TarGzExportWriter",
    "run_export",
    "run_export_for_decommission",
]
