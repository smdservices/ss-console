"""Memory retention policy enforcer — sibling to ``pipeline.py`` and ``state.py``.

The retention runner is the periodic cleanup half of ADR 0008's
"customer-owned memory" contract. Ingestion adds rows to
``memory_ingested_items``; this module removes them once they age past
the per-customer retention window declared in ``customer.yaml``.

Two retention scopes live in this module:

* ``run_memory_retention()`` — walks ``memory_ingested_items`` per item
  type (``matter`` / ``document`` / ``recipient``) and removes any row
  whose ``ingested_at`` is older than the type's configured window.
  Item-type windows come from :class:`MemoryRetentionPolicy` which is
  built from the ``memory.retention.*`` block on customer.yaml.

* ``run_full_retention()`` — composes :func:`run_memory_retention` with
  the voice pipeline's existing :func:`adapter.voice.pipeline.enforce_retention`
  so the cron entrypoint in ``bin/cron-retention.py`` does not need to
  know about two pipelines.

Design rules (issue #863):

* **Per-data-type windows** — the issue requires distinct retention
  for voice samples, matters, audit-log, and drafts. Each is a separate
  knob on :class:`MemoryRetentionPolicy`; missing keys fall back to the
  documented defaults in the customer-yaml-schema spec.

* **Access scope is a read ACL, not a deletion exemption (issue #1126)** —
  ``deleting_scope`` lets a sweep be *narrowed* to a single access bucket
  for targeted redaction / partner off-boarding, but the SCHEDULED cron
  defaults to ``all`` so aged ``partner_only`` / ``attorney_list`` data is
  not retained forever. ``run_memory_retention`` still honors an explicit
  ``deleting_scope`` (a ``firm_wide`` call touches only ``firm-wide``
  rows) for those targeted Captain-run passes.

* **Idempotent** — selecting rows by ``deleted_at IS NULL`` and
  ``ingested_at < cutoff`` means a second run with no new expired rows
  reports zero items and writes no state changes. The audit row still
  fires, recording the no-op.

* **Audit-log emission** — every per-pipeline retention sweep writes
  one audit row via :class:`AuditLogWriter`. The ``action_type`` is
  ``DECOMMISSION_DRAIN_COMPLETE`` (the closest neutral cleanup signal
  in ``ACCEPTED_ACTION_TYPES``); ``metadata.step`` is set to
  ``retention/memory`` or ``retention/voice`` so the trail is
  unambiguous and the operator can filter the dashboard. A retention
  audit-type addition to the canonical enum is filed as a follow-on
  (see spec §"Audit-type backlog").

* **Module touches only its own SQL** — the existing
  :class:`SourceStateStore` does not expose a retention-shaped helper
  so this module talks to the same executor directly via the dedicated
  ``_SELECT_*`` / ``_UPDATE_*`` strings below. This keeps state.py
  untouched while landing a sibling retention surface.

* **No autonomous send paths** — like ingestion, retention only reads
  and deletes; it never sends.
"""

from __future__ import annotations

import enum
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional, Protocol

log = logging.getLogger("aie.memory.retention")


# ---------------------------------------------------------------------------
# Default retention windows
#
# Defaults are conservative and biased toward the legal vertical (the
# launch customer profile). Customer.yaml overrides each window per
# tenant. The ``audit_log_days`` default of 2555 (7 years) matches the
# document-retention norm Captain follows for law-firm bookkeeping.
# ---------------------------------------------------------------------------

DEFAULT_MATTERS_DAYS = 730            # 2 years
DEFAULT_DOCUMENTS_DAYS = 365          # 1 year
DEFAULT_RECIPIENTS_DAYS = 730         # 2 years; relationship graph kept with matters
DEFAULT_VOICE_SAMPLES_DAYS = 365      # 1 year (matches voice-ingestion.md §Retention)
DEFAULT_AUDIT_LOG_DAYS = 2555         # 7 years; legal industry retention norm
DEFAULT_DRAFTS_DAYS = 90              # 90 days; short-lived working state


# ---------------------------------------------------------------------------
# Access scope sweep modes
# ---------------------------------------------------------------------------


class DeletingScope(str, enum.Enum):
    """Which access-scope buckets a retention pass is allowed to touch.

    The default scheduled cron uses :attr:`FIRM_WIDE` so the global sweep
    never deletes a ``partner_only`` row. Captain runs a narrower sweep
    with :attr:`PARTNER_ONLY` or :attr:`ALL` when off-boarding a
    specific partner or fulfilling a redaction request.
    """

    FIRM_WIDE = "firm_wide"
    PARTNER_ONLY = "partner_only"
    ATTORNEY_LIST = "attorney_list"
    ALL = "all"

    def scopes(self) -> tuple[str, ...]:
        """Return the ``access_scope`` literals matched by this sweep mode.

        D1 stores scopes with hyphens (``firm-wide`` / ``partner-only``)
        per :data:`adapter.memory.state.VALID_ACCESS_SCOPES`; this method
        returns the on-disk literals so the SQL filter does not need to
        translate.
        """
        if self is DeletingScope.FIRM_WIDE:
            return ("firm-wide",)
        if self is DeletingScope.PARTNER_ONLY:
            return ("partner-only",)
        if self is DeletingScope.ATTORNEY_LIST:
            return ("attorney-list",)
        return ("firm-wide", "partner-only", "attorney-list")


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MemoryRetentionPolicy:
    """Per-data-type retention windows in days.

    Built from the ``memory.retention.*`` block on customer.yaml by
    :meth:`from_customer_yaml`. Missing fields fall back to the module
    defaults documented in ``customer-yaml-schema.md`` §"Memory retention".

    The ``voice_samples_days`` field is duplicated on this policy (also
    accepted by the voice pipeline) so the runner can pass the full
    policy to one composition entrypoint without splitting it.
    """

    matters_days: int = DEFAULT_MATTERS_DAYS
    documents_days: int = DEFAULT_DOCUMENTS_DAYS
    recipients_days: int = DEFAULT_RECIPIENTS_DAYS
    voice_samples_days: int = DEFAULT_VOICE_SAMPLES_DAYS
    audit_log_days: int = DEFAULT_AUDIT_LOG_DAYS
    drafts_days: int = DEFAULT_DRAFTS_DAYS

    def __post_init__(self) -> None:
        for field_name in (
            "matters_days",
            "documents_days",
            "recipients_days",
            "voice_samples_days",
            "audit_log_days",
            "drafts_days",
        ):
            value = getattr(self, field_name)
            if not isinstance(value, int) or value <= 0:
                raise ValueError(
                    f"MemoryRetentionPolicy.{field_name} must be a positive int "
                    f"(got {value!r})"
                )

    @classmethod
    def from_customer_yaml(cls, parsed: object) -> "MemoryRetentionPolicy":
        """Build a policy from a parsed customer.yaml object.

        The expected shape is ``memory.retention.<window>_days``. Any
        missing key falls back to the module default. An unrecognized
        ``memory.retention`` value is ignored (forward-compat with newer
        schema versions that add more knobs).
        """
        if not isinstance(parsed, dict):
            return cls()
        memory_block = parsed.get("memory")
        if not isinstance(memory_block, dict):
            return cls()
        retention = memory_block.get("retention")
        if not isinstance(retention, dict):
            return cls()

        def _pick(key: str, default: int) -> int:
            value = retention.get(key, default)
            if not isinstance(value, int):
                log.warning(
                    "customer.yaml memory.retention.%s = %r is not an int; "
                    "falling back to default %d",
                    key,
                    value,
                    default,
                )
                return default
            return value

        return cls(
            matters_days=_pick("matters_days", DEFAULT_MATTERS_DAYS),
            documents_days=_pick("documents_days", DEFAULT_DOCUMENTS_DAYS),
            recipients_days=_pick("recipients_days", DEFAULT_RECIPIENTS_DAYS),
            voice_samples_days=_pick("voice_samples_days", DEFAULT_VOICE_SAMPLES_DAYS),
            audit_log_days=_pick("audit_log_days", DEFAULT_AUDIT_LOG_DAYS),
            drafts_days=_pick("drafts_days", DEFAULT_DRAFTS_DAYS),
        )


# ---------------------------------------------------------------------------
# Per-pipeline result shapes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MemoryRetentionTypeResult:
    """Outcome of running retention against one ``item_type`` bucket."""

    item_type: str
    window_days: int
    considered: int
    deleted: int
    errors: int


@dataclass(frozen=True)
class MemoryRetentionResult:
    """Aggregate outcome of one memory-retention pass."""

    deleting_scope: DeletingScope
    started_at: str
    finished_at: str
    per_type: tuple[MemoryRetentionTypeResult, ...]

    @property
    def total_considered(self) -> int:
        return sum(t.considered for t in self.per_type)

    @property
    def total_deleted(self) -> int:
        return sum(t.deleted for t in self.per_type)

    @property
    def total_errors(self) -> int:
        return sum(t.errors for t in self.per_type)

    def to_metadata(self) -> dict:
        """Render a JSON-serializable summary for the audit row metadata."""
        return {
            "step": "retention/memory",
            "deleting_scope": self.deleting_scope.value,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "total_considered": self.total_considered,
            "total_deleted": self.total_deleted,
            "total_errors": self.total_errors,
            "per_type": [
                {
                    "item_type": t.item_type,
                    "window_days": t.window_days,
                    "considered": t.considered,
                    "deleted": t.deleted,
                    "errors": t.errors,
                }
                for t in self.per_type
            ],
        }


@dataclass(frozen=True)
class DraftRetentionResult:
    """Outcome of one ``draft_queue`` age sweep (issue #1126)."""

    window_days: int
    considered: int
    deleted: int
    errors: int

    def to_metadata(self) -> dict:
        return {
            "step": "retention/drafts",
            "window_days": self.window_days,
            "considered": self.considered,
            "deleted": self.deleted,
            "errors": self.errors,
        }


@dataclass(frozen=True)
class RetentionRunResult:
    """Combined memory + voice + drafts retention outcome.

    Returned by :func:`run_full_retention` so the cron entrypoint can
    log a single summary line and surface counts to the dashboard.
    """

    customer_slug: str
    policy: MemoryRetentionPolicy
    memory: MemoryRetentionResult
    voice: dict   # passthrough of voice pipeline's enforce_retention return shape
    drafts: DraftRetentionResult
    started_at: str
    finished_at: str

    @property
    def total_deleted(self) -> int:
        return (
            self.memory.total_deleted
            + int(self.voice.get("deleted", 0) or 0)
            + self.drafts.deleted
        )

    @property
    def total_errors(self) -> int:
        return (
            self.memory.total_errors
            + int(self.voice.get("errors", 0) or 0)
            + self.drafts.errors
        )


# ---------------------------------------------------------------------------
# Storage client used by memory retention
# ---------------------------------------------------------------------------


class StorageRemovalClient(Protocol):
    """Removes one R2 object and (optionally) a list of Vectorize vectors.

    Identical shape to :class:`adapter.memory.state.StorageRemovalClient`
    so the same per-customer client instance can be passed to both the
    decommission hook and the retention runner.
    """

    async def delete_r2_object(self, key: str) -> None: ...

    async def delete_vectorize_vectors(self, vector_ids: list[str]) -> None: ...


class WriteAndQueryExecutor(Protocol):
    """Dual-method executor used by retention.

    Production wiring uses the per-customer Cloudflare D1 HTTP executor
    that already satisfies both methods. Tests pass a sqlite-backed
    object with the same shape. Retention SQL is written here (not on
    :class:`SourceStateStore`) so this module is the only file touched
    by issue #863.
    """

    async def execute(self, sql: str, params: list) -> None: ...

    async def query(self, sql: str, params: list) -> list[dict]: ...


# ---------------------------------------------------------------------------
# SQL — local to retention; sibling to state.py without touching it
# ---------------------------------------------------------------------------


def _select_items_sql(scopes: tuple[str, ...]) -> str:
    """Build the per-type SELECT with an IN clause for the access scopes."""
    placeholders = ", ".join("?" for _ in scopes)
    return (
        "SELECT id, r2_key, vectorize_chunk_ids, access_scope "
        "FROM memory_ingested_items "
        "WHERE item_type = ? "
        "AND ingested_at < ? "
        "AND deleted_at IS NULL "
        f"AND access_scope IN ({placeholders})"
    )


_MARK_ITEM_DELETED_SQL = (
    "UPDATE memory_ingested_items SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL"
)


# Drafts live in their own ``draft_queue`` table (body in R2 via
# ``r2_draft_key`` / ``r2_sent_key``), NOT in ``memory_ingested_items`` —
# so they are swept by :func:`run_draft_retention`, not via
# ``_TYPE_WINDOW_MAP`` above. draft_queue carries no ``access_scope``
# (it is review-queue working state), so the sweep is purely age-based.
_SELECT_EXPIRED_DRAFTS_SQL = (
    "SELECT id, r2_draft_key, r2_sent_key FROM draft_queue WHERE created_at < ?"
)
_DELETE_DRAFT_SQL = "DELETE FROM draft_queue WHERE id = ?"


# ---------------------------------------------------------------------------
# Time helpers — kept local to avoid coupling to state.py internals
# ---------------------------------------------------------------------------


def _iso_utc(now: Optional[datetime] = None) -> str:
    dt = now if now is not None else datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


# ---------------------------------------------------------------------------
# Memory retention runner
# ---------------------------------------------------------------------------


# The item types we sweep, paired with the policy attribute that names
# the per-type window. Recipients are kept on the matters window because
# the relationship graph is meaningful only as long as the matter it
# references is retained.
_TYPE_WINDOW_MAP = (
    ("matter", "matters_days"),
    ("document", "documents_days"),
    ("recipient", "recipients_days"),
)


async def run_memory_retention(
    *,
    executor: WriteAndQueryExecutor,
    storage: StorageRemovalClient,
    policy: MemoryRetentionPolicy,
    deleting_scope: DeletingScope = DeletingScope.FIRM_WIDE,
    now: Optional[datetime] = None,
) -> MemoryRetentionResult:
    """Walk ``memory_ingested_items`` per item type and delete expired rows.

    For each item type the runner:

    1. Computes the cutoff = ``now - policy.<type>_days``.
    2. Selects rows with ``ingested_at < cutoff``, ``deleted_at IS NULL``,
       and ``access_scope`` in ``deleting_scope.scopes()``.
    3. For each row: deletes the R2 object (if any), deletes the
       Vectorize vectors (if any), then soft-deletes the provenance
       row. Failures are counted; one bad row never aborts the sweep.

    Returns a :class:`MemoryRetentionResult` summarizing per-type counts.
    """
    started = now or datetime.now(timezone.utc)
    started_iso = _iso_utc(started)
    scopes = deleting_scope.scopes()
    select_sql = _select_items_sql(scopes)

    per_type_results: list[MemoryRetentionTypeResult] = []
    for item_type, window_attr in _TYPE_WINDOW_MAP:
        window_days = getattr(policy, window_attr)
        cutoff = started - timedelta(days=window_days)
        cutoff_iso = _iso_utc(cutoff)
        rows = await executor.query(
            select_sql,
            [item_type, cutoff_iso, *scopes],
        )
        considered = len(rows)
        deleted = 0
        errors = 0
        for row in rows:
            row_id = row.get("id")
            r2_key = row.get("r2_key")
            chunk_ids_json = row.get("vectorize_chunk_ids")
            if not row_id:
                # Defensive: a row missing its id is unrecoverable; skip
                # without raising so the sweep continues.
                errors += 1
                continue
            try:
                if r2_key:
                    await storage.delete_r2_object(r2_key)
                if chunk_ids_json:
                    chunk_ids = json.loads(chunk_ids_json)
                    if chunk_ids:
                        await storage.delete_vectorize_vectors(chunk_ids)
                await executor.execute(
                    _MARK_ITEM_DELETED_SQL,
                    [_iso_utc(), row_id],
                )
                deleted += 1
            except Exception as exc:  # noqa: BLE001 — per-row resilience
                errors += 1
                log.error(
                    "memory retention failed for row id=%s item_type=%s: %s",
                    row_id,
                    item_type,
                    exc,
                )
        per_type_results.append(
            MemoryRetentionTypeResult(
                item_type=item_type,
                window_days=window_days,
                considered=considered,
                deleted=deleted,
                errors=errors,
            )
        )

    finished_iso = _iso_utc(now=None)
    return MemoryRetentionResult(
        deleting_scope=deleting_scope,
        started_at=started_iso,
        finished_at=finished_iso,
        per_type=tuple(per_type_results),
    )


# ---------------------------------------------------------------------------
# Draft-queue retention runner
# ---------------------------------------------------------------------------


async def run_draft_retention(
    *,
    executor: WriteAndQueryExecutor,
    storage: StorageRemovalClient,
    drafts_days: int,
    now: Optional[datetime] = None,
) -> DraftRetentionResult:
    """Delete ``draft_queue`` rows older than the drafts retention window.

    Drafts of legal correspondence live in the per-customer ``draft_queue``
    table (body in R2 via ``r2_draft_key`` / ``r2_sent_key``), NOT in
    ``memory_ingested_items``. Before this sweep, ``drafts_days`` was
    defined, validated, read from customer.yaml, and printed in dry-run
    output — but enforced by no deletion path, so drafts were retained
    forever (issue #1126), breaking the ADR-0008 deletion promise.

    Drafts carry no ``access_scope`` (review-queue working state), so the
    sweep is purely age-based and scope-independent. Each expired row's R2
    body (draft + any sent copy) is removed, then the D1 row is hard-deleted
    (draft_queue has no soft-delete column). One bad row never aborts the
    sweep.
    """
    started = now or datetime.now(timezone.utc)
    cutoff_iso = _iso_utc(started - timedelta(days=drafts_days))
    rows = await executor.query(_SELECT_EXPIRED_DRAFTS_SQL, [cutoff_iso])
    considered = len(rows)
    deleted = 0
    errors = 0
    for row in rows:
        row_id = row.get("id")
        if not row_id:
            errors += 1
            continue
        try:
            for key in (row.get("r2_draft_key"), row.get("r2_sent_key")):
                if key:
                    await storage.delete_r2_object(key)
            await executor.execute(_DELETE_DRAFT_SQL, [row_id])
            deleted += 1
        except Exception as exc:  # noqa: BLE001 — per-row resilience
            errors += 1
            log.error("draft retention failed for row id=%s: %s", row_id, exc)
    return DraftRetentionResult(
        window_days=drafts_days,
        considered=considered,
        deleted=deleted,
        errors=errors,
    )


# ---------------------------------------------------------------------------
# Cross-pipeline runner
# ---------------------------------------------------------------------------


class VoiceRetentionCallable(Protocol):
    """Subset of the voice pipeline's ``enforce_retention`` signature.

    Captured as a Protocol so the cross-pipeline runner does not import
    the voice pipeline at module-load time (keeps the retention module
    importable in test environments that stub voice out). Production
    callers pass :func:`adapter.voice.pipeline.enforce_retention` bound
    via :class:`functools.partial`.
    """

    async def __call__(self, *, voice_retention_days: int, now: Optional[datetime]) -> dict: ...


async def run_full_retention(
    *,
    customer_slug: str,
    policy: MemoryRetentionPolicy,
    memory_executor: WriteAndQueryExecutor,
    memory_storage: StorageRemovalClient,
    voice_retention: VoiceRetentionCallable,
    deleting_scope: DeletingScope = DeletingScope.FIRM_WIDE,
    audit_writer: Optional[object] = None,
    now: Optional[datetime] = None,
) -> RetentionRunResult:
    """Run memory + voice retention for one customer.

    Sequence:

    1. Run :func:`run_memory_retention` against the per-customer D1.
    2. Run the voice pipeline's ``enforce_retention`` against the
       per-customer voice store. ``voice_retention`` is passed in so
       the import boundary stays clean.
    3. Emit one audit row per pipeline via ``audit_writer`` if one is
       provided. Audit emission is best-effort: an audit failure is
       logged but does not unwind the cleanup (the rows are already
       removed; surfacing the audit error to the cron caller is a
       follow-on).

    Returns a :class:`RetentionRunResult` summarizing both halves.
    """
    started = now or datetime.now(timezone.utc)
    started_iso = _iso_utc(started)

    memory_result = await run_memory_retention(
        executor=memory_executor,
        storage=memory_storage,
        policy=policy,
        deleting_scope=deleting_scope,
        now=started,
    )
    voice_result = await voice_retention(
        voice_retention_days=policy.voice_samples_days,
        now=started,
    )
    # Drafts live in draft_queue in the same per-customer D1 / R2, so the
    # memory executor + storage clients cover them (issue #1126).
    draft_result = await run_draft_retention(
        executor=memory_executor,
        storage=memory_storage,
        drafts_days=policy.drafts_days,
        now=started,
    )

    finished_iso = _iso_utc(now=None)

    if audit_writer is not None:
        await _emit_retention_audit(
            audit_writer=audit_writer,
            customer_slug=customer_slug,
            memory_result=memory_result,
            voice_result=voice_result,
            draft_result=draft_result,
            policy=policy,
            started_iso=started_iso,
            finished_iso=finished_iso,
        )

    return RetentionRunResult(
        customer_slug=customer_slug,
        policy=policy,
        memory=memory_result,
        voice=voice_result,
        drafts=draft_result,
        started_at=started_iso,
        finished_at=finished_iso,
    )


# ---------------------------------------------------------------------------
# Audit helpers
# ---------------------------------------------------------------------------


_RETENTION_ACTION_TYPE = "DECOMMISSION_DRAIN_COMPLETE"
# Mapped to the closest neutral cleanup signal in ACCEPTED_ACTION_TYPES
# until a dedicated RETENTION_SWEEP action_type lands (filed as a
# follow-on against memory-retention.md §"Audit-type backlog"). The
# metadata.step discriminator keeps retention rows distinguishable from
# decommission rows that share the same action_type.


async def _emit_retention_audit(
    *,
    audit_writer: object,
    customer_slug: str,
    memory_result: MemoryRetentionResult,
    voice_result: dict,
    draft_result: DraftRetentionResult,
    policy: MemoryRetentionPolicy,
    started_iso: str,
    finished_iso: str,
) -> None:
    """Write one audit row per pipeline.

    Best-effort: a writer failure is logged but never re-raised so a
    transient D1 outage during the audit phase does not look like a
    retention failure (the rows are already removed by the time we get
    here).
    """
    # Imported here to keep the module importable without the adapter
    # audit_log dependency when retention is unit-tested in isolation.
    try:
        from adapter.audit_log import ActorRole, AuditEvent  # type: ignore[import-not-found]
    except Exception:  # noqa: BLE001
        log.warning(
            "retention audit emission skipped — adapter.audit_log unavailable"
        )
        return

    memory_meta = {
        "customer_slug": customer_slug,
        **memory_result.to_metadata(),
    }
    memory_meta["window_days"] = {
        "matters": policy.matters_days,
        "documents": policy.documents_days,
        "recipients": policy.recipients_days,
    }

    voice_meta = {
        "step": "retention/voice",
        "customer_slug": customer_slug,
        "window_days": policy.voice_samples_days,
        "started_at": started_iso,
        "finished_at": finished_iso,
        "considered": int(voice_result.get("considered", 0) or 0),
        "deleted": int(voice_result.get("deleted", 0) or 0),
        "errors": int(voice_result.get("errors", 0) or 0),
    }

    draft_meta = {
        "customer_slug": customer_slug,
        "started_at": started_iso,
        "finished_at": finished_iso,
        **draft_result.to_metadata(),
    }

    for metadata in (memory_meta, voice_meta, draft_meta):
        event = AuditEvent(
            action_type=_RETENTION_ACTION_TYPE,
            actor="agent",
            actor_role=ActorRole.AGENT,
            metadata=metadata,
        )
        try:
            await audit_writer.write(event)  # type: ignore[attr-defined]
        except Exception as exc:  # noqa: BLE001 — best-effort emission
            log.error(
                "retention audit row failed step=%s err=%s",
                metadata.get("step"),
                exc,
            )


__all__ = [
    "DEFAULT_AUDIT_LOG_DAYS",
    "DEFAULT_DOCUMENTS_DAYS",
    "DEFAULT_DRAFTS_DAYS",
    "DEFAULT_MATTERS_DAYS",
    "DEFAULT_RECIPIENTS_DAYS",
    "DEFAULT_VOICE_SAMPLES_DAYS",
    "DeletingScope",
    "DraftRetentionResult",
    "MemoryRetentionPolicy",
    "MemoryRetentionResult",
    "MemoryRetentionTypeResult",
    "RetentionRunResult",
    "StorageRemovalClient",
    "VoiceRetentionCallable",
    "WriteAndQueryExecutor",
    "run_draft_retention",
    "run_full_retention",
    "run_memory_retention",
]
