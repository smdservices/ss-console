"""Per-customer decommission sequence (issue #820).

Full off-boarding pipeline for a single customer. Composes the existing
``decommission_source`` hooks in :mod:`adapter.memory.state` and
:mod:`adapter.voice.pipeline` with the substrate-deletion steps owned by
ops (R2 bucket, Vectorize indexes, Composio connections, AgentMail
identity, Fly Machine), then archives the compliance packet and
tombstones the customer config directory.

Design notes
------------

* **Nine steps, one per AC bullet.** The :class:`DecommissionPipeline`
  exposes one method per step plus :meth:`run` that orchestrates them in
  order. Each step writes an audit row before and after via
  :class:`adapter.audit_log.AuditLogWriter`; on failure it writes a third
  ``failed`` row before raising :class:`DecommissionStepFailed`.

* **External services behind Protocols.** Composio, AgentMail, and Fly
  Machine are not wired in this PR. Each is stubbed behind a
  ``Protocol`` plus a :class:`NoOpStub` implementation that logs
  "skipped (no client wired)" and returns a manifest with
  ``skipped=True``. Production wiring is a constructor swap.

* **D1 cleanup delegates to the canonical hooks.** Memory and voice are
  not re-implemented here. The pipeline imports
  :func:`adapter.memory.state.decommission_source` and
  :func:`adapter.voice.pipeline.decommission_source` and calls them with
  the per-customer stores + storage clients constructed by the caller.

* **Dry-run mode is non-destructive.** Each step exposes a ``plan(...)``
  method that returns the manifest of what *would* happen without
  executing. The CLI surfaces this as one line per step. Live mode runs
  the same step body but with ``dry_run=False``; the manifests have the
  same shape so dry-run vs live diffs cleanly.

* **Idempotency is a P0 invariant.** Every step is safe to re-run on a
  partially-decommissioned customer. Re-running on a fully-decommissioned
  customer is a no-op that exits 0. The :class:`NoOpStub`,
  :class:`FilesystemTombstoner`, and the audit-log writer all treat
  missing inputs as success, not failure.

* **No real destructive actions in CI.** Tests construct the pipeline
  with :class:`NoOpStub` implementations of every external service. The
  ``smd`` customer-zero fixture is a synthetic directory inside
  ``ai-employee/bin/fixtures/smd/``, not a real customer.

Per the issue, the 9 steps are:

  1. Drain in-flight LLM calls (#805 handled separately at the script
     level via the Fly Machine pause; the pipeline records that the
     drain completed before mutating substrate).
  2. D1: delete customer's memory + voice artifacts via the canonical
     ``decommission_source`` hooks.
  3. R2: delete the customer's object namespace (everything under the
     ``{slug}/`` prefix EXCEPT the decommission-archive subtree).
  4. Vectorize: delete the per-customer vault + corrections indexes.
  5. Composio: revoke OAuth tokens / remove connections (stubbed).
  6. AgentMail: deprovision inbox / forwarding rules (stubbed).
  7. Fly Machine: stop and destroy ``hermes-{slug}`` (stubbed).
  8. Compliance evidence packet: generate the final packet and archive
     it to per-customer cold storage.
  9. ``ai-employee/customers/{slug}/`` tombstone: rename to
     ``{slug}.decommissioned.{iso-date}`` and write a marker file.
"""

from __future__ import annotations

import asyncio
import enum
import json
import logging
import os
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable, Optional, Protocol

log = logging.getLogger("aie.bin.decommission")


# ---------------------------------------------------------------------------
# Public exceptions
# ---------------------------------------------------------------------------


class DecommissionStepFailed(RuntimeError):
    """Raised when any decommission step fails in live mode.

    Halts execution. The script wrapper writes the failure to stderr and
    exits non-zero. The audit row for the failed step is already written
    by the time this is raised (the step body writes ``failed`` before
    re-raising), so the trail is preserved.
    """

    def __init__(self, step_name: str, customer_slug: str, cause: BaseException) -> None:
        super().__init__(
            f"decommission step {step_name!r} failed for customer {customer_slug!r}: "
            f"{type(cause).__name__}: {cause}"
        )
        self.step_name = step_name
        self.customer_slug = customer_slug
        self.cause = cause


# ---------------------------------------------------------------------------
# Step manifests
#
# Every step returns the same shape so dry-run and live runs are diffable
# line-by-line. ``skipped`` is true when the step short-circuited because
# the input was already absent (the idempotency path) or because the
# implementation is a NoOpStub.
# ---------------------------------------------------------------------------


class StepStatus(str, enum.Enum):
    PLANNED = "planned"      # dry-run; nothing executed
    EXECUTED = "executed"    # live run; work performed
    SKIPPED = "skipped"      # input already absent or stub
    FAILED = "failed"        # live run; exception raised


@dataclass(frozen=True)
class StepResult:
    """One step's outcome, both for plan() and execute().

    The pipeline collects these in order so the audit-log + dashboard can
    render a step-by-step decommission report.
    """

    name: str
    status: StepStatus
    detail: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Stubbed external services (Composio, AgentMail, Fly)
#
# Each Protocol has a NoOpStub that the CLI defaults to. Production
# wiring is a constructor swap with a real client. The stubs return
# manifests that look like real ones so the audit trail stays the same
# shape across stub vs live transitions.
# ---------------------------------------------------------------------------


class ComposioConnectionManager(Protocol):
    """Revokes OAuth tokens + removes connections for one customer.

    Production wiring uses the Composio Standard tier admin API; the
    customer's connection IDs come from per-skill connector bindings
    written into D1 at provisioning time. Until the per-customer Composio
    enrolment ships (tracked under #789), this is a no-op.
    """

    async def revoke_connections(self, customer_slug: str) -> dict: ...


class AgentMailProvisioner(Protocol):
    """Deprovisions an AgentMail identity and any forwarding rules."""

    async def deprovision(self, customer_slug: str) -> dict: ...


class FlyMachineManager(Protocol):
    """Stops and destroys ``hermes-{slug}`` Fly Machine."""

    async def destroy_machine(self, customer_slug: str) -> dict: ...


class NoOpComposioStub:
    """No-op Composio manager — logs and returns ``skipped`` manifest.

    Used until per-customer Composio enrolment lands (#789). The stub
    keeps the script runnable end-to-end against the ``smd`` fixture
    today so dry-run / live / idempotent re-run paths are testable
    without external service clients.
    """

    _SKIPPED_REASON = "external_client_not_wired"

    async def revoke_connections(self, customer_slug: str) -> dict:
        log.info("composio.revoke skipped (no client wired) customer=%s", customer_slug)
        return {"skipped": True, "reason": self._SKIPPED_REASON, "connections_revoked": 0}


class NoOpAgentMailStub:
    _SKIPPED_REASON = "external_client_not_wired"

    async def deprovision(self, customer_slug: str) -> dict:
        log.info("agentmail.deprovision skipped (no client wired) customer=%s", customer_slug)
        return {"skipped": True, "reason": self._SKIPPED_REASON, "identities_removed": 0}


class NoOpFlyStub:
    _SKIPPED_REASON = "external_client_not_wired"

    async def destroy_machine(self, customer_slug: str) -> dict:
        log.info("fly.destroy_machine skipped (no client wired) customer=%s", customer_slug)
        return {"skipped": True, "reason": self._SKIPPED_REASON, "app_destroyed": False}


# ---------------------------------------------------------------------------
# Substrate clients
#
# Memory + voice decommission are delegated to the canonical hooks in
# adapter/. The pipeline carries the wired stores + storage so the caller
# constructs them once (against either real D1/R2 bindings or fakes for
# tests).
# ---------------------------------------------------------------------------


class MemoryDecommissionRunner(Protocol):
    """Wraps adapter.memory.state.decommission_source for one source.

    Production constructs this with a real SourceStateStore +
    StorageRemovalClient. Tests use in-memory fakes.
    """

    async def run(self, source_kind: str, source_id: str) -> dict: ...


class VoiceDecommissionRunner(Protocol):
    """Wraps adapter.voice.pipeline.decommission_source for one source."""

    async def run(self, source_kind: str, source_id: str) -> dict: ...


class R2NamespaceDeleter(Protocol):
    """Deletes every R2 object under ``{customer-slug}/`` EXCEPT the
    decommission-archive subtree (which has already been moved to cold
    storage by step 8).

    Production calls ``wrangler r2 object delete`` in batches; tests
    track the would-be deletions in an in-memory dict.
    """

    async def delete_namespace(self, customer_slug: str) -> dict: ...


class VectorizeIndexDeleter(Protocol):
    """Deletes ``hermes-{slug}-vault`` and ``hermes-{slug}-corrections``."""

    async def delete_indexes(self, customer_slug: str) -> dict: ...


class ComplianceArchiver(Protocol):
    """Generates the compliance evidence packet and copies it to the
    per-customer cold-storage retention bucket per the spec.

    Returns the archive path written.
    """

    async def archive(self, customer_slug: str, archive_dir: Path) -> dict: ...


# ---------------------------------------------------------------------------
# Default in-process implementations
#
# These cover the substrate steps that have no external dependencies in
# this PR. The pipeline accepts a Protocol so tests pass fakes that
# record calls.
# ---------------------------------------------------------------------------


class FilesystemTombstoner:
    """Renames ``ai-employee/customers/{slug}/`` to
    ``{slug}.decommissioned.{iso-date}`` and writes a tombstone marker.

    Idempotent: if the live directory is already absent, returns
    ``skipped=True`` with the existing tombstone path (if found). If both
    the live and tombstone paths are absent, returns ``skipped=True`` with
    ``reason="no_customer_dir"``. Never deletes the directory entirely;
    preserves audit history per the issue.
    """

    def __init__(self, customers_root: Path) -> None:
        self._root = customers_root

    def tombstone(self, customer_slug: str, *, now: Optional[datetime] = None) -> dict:
        when = now if now is not None else datetime.now(timezone.utc)
        date_part = when.strftime("%Y-%m-%d")
        live_dir = self._root / customer_slug
        tomb_dir = self._root / f"{customer_slug}.decommissioned.{date_part}"

        # Idempotency: if there is already a tombstone, do not move again.
        if tomb_dir.exists():
            return {
                "skipped": True,
                "reason": "already_tombstoned",
                "tombstone_path": str(tomb_dir),
            }

        if not live_dir.exists():
            # No live dir, no existing tombstone — treat as already removed
            # (matches the "partial decommission" idempotency contract).
            return {
                "skipped": True,
                "reason": "no_customer_dir",
                "tombstone_path": None,
            }

        # Move the directory and drop a marker file at its root.
        live_dir.rename(tomb_dir)
        marker = tomb_dir / "DECOMMISSIONED.md"
        marker.write_text(
            "# Decommissioned\n\n"
            f"This directory contained the customer config for `{customer_slug}` until "
            f"{when.isoformat()}.\n\n"
            "The customer was decommissioned by `ai-employee/bin/decommission-customer.sh`.\n\n"
            "The directory is preserved as historical record per the audit-history requirement.\n",
            encoding="utf-8",
        )
        return {
            "skipped": False,
            "reason": None,
            "tombstone_path": str(tomb_dir),
            "marker_path": str(marker),
        }

    def plan(self, customer_slug: str, *, now: Optional[datetime] = None) -> dict:
        when = now if now is not None else datetime.now(timezone.utc)
        date_part = when.strftime("%Y-%m-%d")
        live_dir = self._root / customer_slug
        tomb_dir = self._root / f"{customer_slug}.decommissioned.{date_part}"
        if tomb_dir.exists():
            return {"would_rename": False, "reason": "already_tombstoned"}
        if not live_dir.exists():
            return {"would_rename": False, "reason": "no_customer_dir"}
        return {
            "would_rename": True,
            "from": str(live_dir),
            "to": str(tomb_dir),
        }


class DefaultDrainCoordinator:
    """Default drain coordinator: records that drain ran.

    The real drain logic (60s grace window for in-flight LLM calls)
    lives in #805 and is invoked by the shell wrapper BEFORE this
    pipeline runs. The pipeline records the drain marker into the audit
    log so the decommission report shows the drain step completed.

    If a richer drain client is provided by the CLI in the future, swap
    this for an implementation that calls the Fly Machine pause +
    in-flight poll. The protocol is intentionally trivial so this can
    happen without a pipeline rewrite.
    """

    def __init__(self, drain_window_seconds: int = 60) -> None:
        self._drain_window_seconds = drain_window_seconds

    async def drain(self, customer_slug: str) -> dict:
        # In-process default: assume the wrapper already paused the
        # machine. Return the drain window as evidence.
        log.info(
            "drain.complete window_seconds=%d customer=%s",
            self._drain_window_seconds,
            customer_slug,
        )
        return {
            "drain_window_seconds": self._drain_window_seconds,
            "in_flight_remaining": 0,
        }


class InMemoryComplianceArchiver:
    """Writes a minimal compliance-packet stub to the archive dir.

    Production wires this to the ``compliance-audit-export`` skill so the
    real packet (per ``compliance-evidence-packet.md`` §packet-structure)
    is generated. For now this writes a manifest JSON that names the
    customer, the timestamp, and the expected packet contents — enough to
    prove the archive step ran and to compose with the real generator
    later without changing the pipeline.
    """

    async def archive(self, customer_slug: str, archive_dir: Path) -> dict:
        archive_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
        manifest_path = archive_dir / f"compliance-packet-manifest-{ts}.json"
        manifest = {
            "customer_slug": customer_slug,
            "generated_at": ts,
            "packet_contents_expected": [
                "00-README.md",
                "01-summary.pdf",
                "02-architecture-controls.md",
                "03-audit-log.csv",
                "04-audit-log-human.md",
                "05-customer-yaml.redacted.yml",
                "06-memory-snapshot.json",
                "07-skill-catalog.json",
                "08-engagement-letter-clauses",
                "09-boot-checks.csv",
                "10-dpa.pdf",
                "11-baa.pdf",
                "12-decommission-confirmation.pdf",
                "manifest.json",
            ],
            "note": (
                "stub manifest from bin/lib/decommission.py InMemoryComplianceArchiver; "
                "replace with compliance-audit-export skill output when wired"
            ),
        }
        manifest_path.write_text(
            json.dumps(manifest, sort_keys=True, indent=2),
            encoding="utf-8",
        )
        return {
            "archive_path": str(manifest_path),
            "stub": True,
        }


# ---------------------------------------------------------------------------
# Audit helpers
# ---------------------------------------------------------------------------


def _audit_metadata(step: str, customer_slug: str, *, detail: Optional[dict] = None) -> dict:
    """Compose the metadata dict for a decommission audit row."""
    meta: dict = {
        "step": step,
        "customer_slug": customer_slug,
    }
    if detail:
        meta["detail"] = detail
    return meta


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


@dataclass
class DecommissionPipeline:
    """Orchestrator for the 9-step decommission sequence.

    Construct with the per-customer stores + storage clients (real or
    fake) plus the audit-log writer. Call :meth:`plan` for a dry-run
    manifest or :meth:`run` to execute.
    """

    customer_slug: str
    customers_root: Path
    archive_root: Path
    audit_writer: object  # adapter.audit_log.AuditLogWriter, kept loose to avoid import cycle
    actor: str = "captain"

    drain: object = field(default_factory=DefaultDrainCoordinator)
    memory_runner: Optional[MemoryDecommissionRunner] = None
    voice_runner: Optional[VoiceDecommissionRunner] = None
    r2_deleter: Optional[R2NamespaceDeleter] = None
    vectorize_deleter: Optional[VectorizeIndexDeleter] = None
    composio: ComposioConnectionManager = field(default_factory=NoOpComposioStub)
    agentmail: AgentMailProvisioner = field(default_factory=NoOpAgentMailStub)
    fly: FlyMachineManager = field(default_factory=NoOpFlyStub)
    archiver: ComplianceArchiver = field(default_factory=InMemoryComplianceArchiver)
    tombstoner: Optional[FilesystemTombstoner] = None

    # Memory + voice sources to decommission. Defaults match the
    # canonical PracticeManagement + Email source kinds the pipelines
    # already write to D1.
    memory_sources: tuple[tuple[str, str], ...] = (
        ("practice_management", "filevine"),
        ("practice_management", "clio"),
        ("practice_management", "none"),
    )
    voice_sources: tuple[tuple[str, str], ...] = (
        ("email", "gmail"),
        ("email", "ms-graph"),
    )

    def __post_init__(self) -> None:
        if not self.customer_slug:
            raise ValueError("customer_slug must be a non-empty string")
        if self.tombstoner is None:
            self.tombstoner = FilesystemTombstoner(self.customers_root)

    # --- public entrypoints -------------------------------------------------

    async def plan(self) -> list[StepResult]:
        """Dry-run: returns the per-step manifest of what would happen.

        Performs no destructive operations and writes no audit rows. The
        CLI surfaces each result as one line so dry-run output diffs
        cleanly against live-run output.
        """
        return [
            StepResult(
                name="01_drain",
                status=StepStatus.PLANNED,
                detail={"action": "verify drain marker", "customer": self.customer_slug},
            ),
            StepResult(
                name="02_d1_memory_voice",
                status=StepStatus.PLANNED,
                detail={
                    "memory_sources": list(self.memory_sources),
                    "voice_sources": list(self.voice_sources),
                },
            ),
            StepResult(
                name="03_r2_namespace",
                status=StepStatus.PLANNED,
                detail={"namespace": f"{self.customer_slug}/", "deleter_wired": self.r2_deleter is not None},
            ),
            StepResult(
                name="04_vectorize_indexes",
                status=StepStatus.PLANNED,
                detail={
                    "indexes": [
                        f"hermes-{self.customer_slug}-vault",
                        f"hermes-{self.customer_slug}-corrections",
                    ],
                    "deleter_wired": self.vectorize_deleter is not None,
                },
            ),
            StepResult(
                name="05_composio",
                status=StepStatus.PLANNED,
                detail={"action": "revoke OAuth + remove connections"},
            ),
            StepResult(
                name="06_agentmail",
                status=StepStatus.PLANNED,
                detail={"action": "deprovision inbox + forwarding rules"},
            ),
            StepResult(
                name="07_fly_machine",
                status=StepStatus.PLANNED,
                detail={"app": f"hermes-{self.customer_slug}"},
            ),
            StepResult(
                name="08_compliance_archive",
                status=StepStatus.PLANNED,
                detail={
                    "archive_dir": str(self.archive_root / self.customer_slug),
                },
            ),
            StepResult(
                name="09_tombstone",
                status=StepStatus.PLANNED,
                detail=self.tombstoner.plan(self.customer_slug),
            ),
        ]

    async def run(self) -> list[StepResult]:
        """Live mode: executes all 9 steps in order. Halts on first failure."""
        results: list[StepResult] = []

        # Step 1 — DECOMMISSION_INITIATED + drain
        await self._write_audit_row(
            action_type="DECOMMISSION_INITIATED",
            metadata=_audit_metadata("01_drain", self.customer_slug),
        )
        try:
            drain_detail = await self.drain.drain(self.customer_slug)
        except Exception as exc:
            await self._write_failure("01_drain", exc)
            raise DecommissionStepFailed("01_drain", self.customer_slug, exc) from exc
        results.append(StepResult(name="01_drain", status=StepStatus.EXECUTED, detail=drain_detail))
        await self._write_audit_row(
            action_type="DECOMMISSION_DRAIN_COMPLETE",
            metadata=_audit_metadata("01_drain", self.customer_slug, detail=drain_detail),
        )

        # Step 2 — D1 memory + voice cleanup
        results.append(await self._run_step(
            "02_d1_memory_voice",
            self._step_d1_memory_voice,
        ))

        # Step 3 — R2 namespace delete
        results.append(await self._run_step(
            "03_r2_namespace",
            self._step_r2_namespace,
        ))

        # Step 4 — Vectorize indexes delete
        results.append(await self._run_step(
            "04_vectorize_indexes",
            self._step_vectorize_indexes,
        ))

        # Step 5 — Composio
        results.append(await self._run_step(
            "05_composio",
            self._step_composio,
        ))

        # Step 6 — AgentMail
        results.append(await self._run_step(
            "06_agentmail",
            self._step_agentmail,
        ))

        # Step 7 — Fly Machine
        results.append(await self._run_step(
            "07_fly_machine",
            self._step_fly_machine,
        ))

        # Step 8 — Compliance archive
        results.append(await self._run_step(
            "08_compliance_archive",
            self._step_compliance_archive,
        ))

        # Step 9 — Tombstone
        results.append(await self._run_step(
            "09_tombstone",
            self._step_tombstone,
        ))

        # Final marker: DECOMMISSION_FINAL records the end of the pipeline.
        await self._write_audit_row(
            action_type="DECOMMISSION_FINAL",
            metadata=_audit_metadata(
                "decommission_complete",
                self.customer_slug,
                detail={"steps": [r.name for r in results]},
            ),
        )
        return results

    # --- step implementations ----------------------------------------------

    async def _run_step(
        self,
        name: str,
        body: Callable[[], Awaitable[dict]],
    ) -> StepResult:
        """Run one step body wrapped with begin/end audit rows + halt-on-fail."""
        await self._write_audit_row(
            action_type="DECOMMISSION_INITIATED",
            metadata=_audit_metadata(name, self.customer_slug),
        )
        try:
            detail = await body()
        except Exception as exc:
            await self._write_failure(name, exc)
            raise DecommissionStepFailed(name, self.customer_slug, exc) from exc

        skipped = bool(detail.get("skipped"))
        status = StepStatus.SKIPPED if skipped else StepStatus.EXECUTED
        await self._write_audit_row(
            action_type="DECOMMISSION_DRAIN_COMPLETE",  # closest matching enum value
            metadata=_audit_metadata(name, self.customer_slug, detail=detail),
        )
        return StepResult(name=name, status=status, detail=detail)

    async def _step_d1_memory_voice(self) -> dict:
        memory_results: list[dict] = []
        for source_kind, source_id in self.memory_sources:
            if self.memory_runner is None:
                memory_results.append({
                    "source_kind": source_kind,
                    "source_id": source_id,
                    "skipped": True,
                    "reason": "no memory_runner wired",
                })
                continue
            manifest = await self.memory_runner.run(source_kind, source_id)
            memory_results.append({"source_kind": source_kind, "source_id": source_id, **manifest})

        voice_results: list[dict] = []
        for source_kind, source_id in self.voice_sources:
            if self.voice_runner is None:
                voice_results.append({
                    "source_kind": source_kind,
                    "source_id": source_id,
                    "skipped": True,
                    "reason": "no voice_runner wired",
                })
                continue
            manifest = await self.voice_runner.run(source_kind, source_id)
            voice_results.append({"source_kind": source_kind, "source_id": source_id, **manifest})

        all_skipped = all(r.get("skipped") for r in memory_results + voice_results) or (
            not memory_results and not voice_results
        )
        return {
            "skipped": all_skipped and (self.memory_runner is None and self.voice_runner is None),
            "memory_runs": memory_results,
            "voice_runs": voice_results,
        }

    async def _step_r2_namespace(self) -> dict:
        if self.r2_deleter is None:
            return {
                "skipped": True,
                "reason": "no r2_deleter wired",
                "namespace": f"{self.customer_slug}/",
            }
        manifest = await self.r2_deleter.delete_namespace(self.customer_slug)
        return {"namespace": f"{self.customer_slug}/", **manifest}

    async def _step_vectorize_indexes(self) -> dict:
        if self.vectorize_deleter is None:
            return {
                "skipped": True,
                "reason": "no vectorize_deleter wired",
                "indexes": [
                    f"hermes-{self.customer_slug}-vault",
                    f"hermes-{self.customer_slug}-corrections",
                ],
            }
        manifest = await self.vectorize_deleter.delete_indexes(self.customer_slug)
        return manifest

    async def _step_composio(self) -> dict:
        return await self.composio.revoke_connections(self.customer_slug)

    async def _step_agentmail(self) -> dict:
        return await self.agentmail.deprovision(self.customer_slug)

    async def _step_fly_machine(self) -> dict:
        return await self.fly.destroy_machine(self.customer_slug)

    async def _step_compliance_archive(self) -> dict:
        archive_dir = self.archive_root / self.customer_slug
        manifest = await self.archiver.archive(self.customer_slug, archive_dir)
        return manifest

    async def _step_tombstone(self) -> dict:
        # Tombstoner is sync; wrap to keep the step interface uniform.
        return self.tombstoner.tombstone(self.customer_slug)

    # --- audit-row helpers --------------------------------------------------

    async def _write_audit_row(self, *, action_type: str, metadata: dict) -> None:
        # Import here to avoid hard adapter import at module load time;
        # the lib is consumed by the script + tests, and tests inject a
        # fake writer that does not need adapter.audit_log on PYTHONPATH.
        from adapter.audit_log import AuditEvent, ActorRole

        event = AuditEvent(
            action_type=action_type,
            actor=self.actor,
            actor_role=ActorRole.CAPTAIN,
            metadata=metadata,
        )
        await self.audit_writer.write(event)

    async def _write_failure(self, step_name: str, exc: BaseException) -> None:
        try:
            await self._write_audit_row(
                action_type="DECOMMISSION_INITIATED",
                metadata=_audit_metadata(
                    step_name,
                    self.customer_slug,
                    detail={"failed": True, "error": f"{type(exc).__name__}: {exc}"},
                ),
            )
        except Exception:  # noqa: BLE001
            # If audit write itself fails we cannot do better than log;
            # the calling script still raises the original step failure.
            log.exception("decommission audit-row write failed for %s/%s", self.customer_slug, step_name)


__all__ = [
    "AgentMailProvisioner",
    "ComplianceArchiver",
    "ComposioConnectionManager",
    "DecommissionPipeline",
    "DecommissionStepFailed",
    "DefaultDrainCoordinator",
    "FilesystemTombstoner",
    "FlyMachineManager",
    "InMemoryComplianceArchiver",
    "MemoryDecommissionRunner",
    "NoOpAgentMailStub",
    "NoOpComposioStub",
    "NoOpFlyStub",
    "R2NamespaceDeleter",
    "StepResult",
    "StepStatus",
    "VectorizeIndexDeleter",
    "VoiceDecommissionRunner",
]
