"""Periodic integrity check: Logpush mirror == D1 audit_log contents (issue #892).

AC: "Periodic integrity check (Logpush mirror == D1 contents)."

This module compares the audit_log rows present in D1 against the rows
mirrored to the immutable Logpush archive (R2 with Object Lock, per
`wrangler.toml` and `docs/specs/ai-employee/audit-log-immutability.md`).
Any drift surfaces as an `IntegrityFinding` inside the returned
`IntegrityReport`.

Three drift classes are detected:

1. `IN_D1_NOT_IN_MIRROR` — a D1 row has no matching mirror entry. The
   most common benign cause is mirror lag (the Logpush stream batches);
   the integrity check skips rows newer than `_MIRROR_LAG_GRACE_SECONDS`
   to avoid false positives. Anything older than the grace window is a
   real finding — either the mirror dropped the row or D1 was written
   to outside the writer path (which the Worker-layer guard should have
   blocked).

2. `IN_MIRROR_NOT_IN_D1` — a mirror row has no matching D1 row. This is
   the load-bearing case for immutability: if the mirror has a row the
   D1 table no longer carries, the row was deleted from D1 (a
   substrate-level violation) OR a Captain-supervised legal-hold
   redaction landed (legitimate, ledger-backed). The check does not
   distinguish — it surfaces the finding and the operator reconciles
   against the exceptions ledger.

3. `DIGEST_MISMATCH` — both D1 and the mirror carry the same id, but a
   load-bearing column differs. We compare every column except
   `metadata` (which can contain non-deterministic ordering inside
   nested JSON objects); the audit-log writer canonicalizes its own
   metadata serialization (sort_keys, no whitespace) but a future
   non-writer caller might not. If metadata-level drift becomes a real
   concern, lift it into a separate finding class.

The check is read-only and side-effect-free. It does NOT write to D1,
does NOT delete from the mirror, does NOT alert. Callers (a Cloudflare
Cron Trigger Worker or the compliance-evidence-packet generator) decide
what to do with the report.

Performance
-----------

The check walks both stores in id order (ULID is sortable by time). The
expected cardinality on the per-customer audit log is in the tens of
thousands of rows per month, so a full pass is bounded and cheap. The
loader interfaces support pagination so the integrity-check Worker can
chunk large windows without holding the full set in memory.

Out of scope (this PR)
----------------------

* Wiring this module to a Cron Trigger. The check is a library — the
  scheduler is a deployment concern.
* The Captain-side exceptions ledger schema. The integrity check
  surfaces findings; the operator cross-checks against the ledger
  manually (or via a future automated reconciliation pass).
"""

from __future__ import annotations

import enum
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import AsyncIterator, Callable, Optional, Protocol

log = logging.getLogger("aie.audit_log.integrity")


# How many seconds we tolerate between a D1 write and the mirror seeing it.
# Logpush latency is typically under a minute; the grace window picks a
# conservative 5 minutes so the periodic check (recommended hourly cadence)
# does not page on benign batching.
_MIRROR_LAG_GRACE_SECONDS = 5 * 60


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


class FindingKind(str, enum.Enum):
    IN_D1_NOT_IN_MIRROR = "in_d1_not_in_mirror"
    IN_MIRROR_NOT_IN_D1 = "in_mirror_not_in_d1"
    DIGEST_MISMATCH = "digest_mismatch"


@dataclass(frozen=True)
class IntegrityFinding:
    """A single drift between D1 and the Logpush mirror.

    Findings are intentionally lightweight — they carry the row id and
    the kind of drift, not the row payload. Reconstruction goes through
    the loader. This keeps the report small for the dashboard surface
    and avoids leaking digest/metadata into log streams.
    """

    kind: FindingKind
    row_id: str
    detail: Optional[str] = None


@dataclass
class IntegrityReport:
    """Result of one integrity-check pass.

    `clean` is True if and only if `findings` is empty AND the loaders
    did not raise. A loader exception is surfaced via the `loader_error`
    field and forces `clean=False` even if no finding was produced.
    """

    d1_rows_checked: int = 0
    mirror_rows_checked: int = 0
    findings: list[IntegrityFinding] = field(default_factory=list)
    loader_error: Optional[str] = None

    @property
    def clean(self) -> bool:
        return not self.findings and self.loader_error is None


# ---------------------------------------------------------------------------
# Row shape exchanged between the loaders and the comparator
#
# Matches the audit_log column set 1:1 so the comparator can do a
# tuple-comparison on the load-bearing fields without per-source
# translation. The metadata column is excluded from comparison (see
# module docstring) but is carried so the dashboard can surface the
# offending row if needed.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AuditRow:
    id: str
    ts: str
    action_type: str
    actor: str
    actor_role: Optional[str]
    skill_name: Optional[str]
    matter_ref: Optional[str]
    input_digest: Optional[str]
    output_digest: Optional[str]
    diff_digest: Optional[str]
    trust_ceiling: Optional[str]
    metadata: Optional[str]

    def compare_key(self) -> tuple:
        """Tuple of load-bearing columns — every column except `metadata`."""
        return (
            self.id,
            self.ts,
            self.action_type,
            self.actor,
            self.actor_role,
            self.skill_name,
            self.matter_ref,
            self.input_digest,
            self.output_digest,
            self.diff_digest,
            self.trust_ceiling,
        )


# ---------------------------------------------------------------------------
# Loader protocols
#
# Two async iterators yielding `AuditRow` in id (ULID) ascending order.
# The D1 loader queries the per-customer database; the mirror loader
# reads R2 objects under the per-customer archive prefix. Both default
# to no-op for tests; real wiring lands in the integrity-check Worker.
# ---------------------------------------------------------------------------


class D1AuditLoader(Protocol):
    """Yield `AuditRow` rows from D1 within the [start_ts, end_ts] window."""

    def load(self, start_ts: str, end_ts: str) -> AsyncIterator[AuditRow]: ...


class LogpushArchiveLoader(Protocol):
    """Yield `AuditRow` rows from the Logpush archive within the window."""

    def load(self, start_ts: str, end_ts: str) -> AsyncIterator[AuditRow]: ...


# ---------------------------------------------------------------------------
# The check itself
# ---------------------------------------------------------------------------


async def _drain(stream: AsyncIterator[AuditRow]) -> dict[str, AuditRow]:
    """Read an async iterator into an id-keyed dict.

    The audit log is small enough to fit a full window in memory for the
    Cron Trigger Worker's expected window size (one hour); the check
    is a library, not a streaming sort-merge. If the per-customer audit
    log ever exceeds the Worker's memory budget, swap the comparator
    for a sort-merge over the two iterators (both sources are ULID-
    ordered, so the merge is linear).
    """
    out: dict[str, AuditRow] = {}
    async for row in stream:
        out[row.id] = row
    return out


def _parse_iso(ts: str) -> Optional[datetime]:
    """Parse an audit-log `ts` (ISO 8601 UTC, millisecond precision, Z suffix).

    Returns None on parse failure — the integrity check is best-effort
    on timestamp comparison; a bad timestamp does not block the rest of
    the comparison.
    """
    try:
        # The writer emits "YYYY-MM-DDTHH:MM:SS.sssZ"
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _within_lag_grace(row_ts: str, now: datetime) -> bool:
    """True if the row's ts is recent enough that mirror lag is plausible."""
    parsed = _parse_iso(row_ts)
    if parsed is None:
        # Unparseable — treat as old (don't grant the grace)
        return False
    return parsed > now - timedelta(seconds=_MIRROR_LAG_GRACE_SECONDS)


async def check_audit_integrity(
    d1_loader: D1AuditLoader,
    logpush_archive_loader: LogpushArchiveLoader,
    *,
    start_ts: str,
    end_ts: str,
    now: Optional[Callable[[], datetime]] = None,
) -> IntegrityReport:
    """Compare D1 audit_log against the Logpush mirror.

    Both loaders are scanned over the same `[start_ts, end_ts]` window
    (ISO 8601 UTC strings, matching the audit_log `ts` column shape).
    The comparator builds two id-keyed maps, then walks the union.

    Returns an `IntegrityReport`. Caller decides what to do with the
    findings — alert, escalate, file a compliance ticket. This module
    does not write.
    """
    report = IntegrityReport()
    now_dt = (now or (lambda: datetime.now(timezone.utc)))()

    try:
        d1_rows = await _drain(d1_loader.load(start_ts, end_ts))
        mirror_rows = await _drain(logpush_archive_loader.load(start_ts, end_ts))
    except Exception as e:  # noqa: BLE001 — loader failures must surface
        log.error("integrity-check loader failure: %s", e)
        report.loader_error = f"{type(e).__name__}: {e}"
        return report

    report.d1_rows_checked = len(d1_rows)
    report.mirror_rows_checked = len(mirror_rows)

    only_in_d1 = set(d1_rows) - set(mirror_rows)
    only_in_mirror = set(mirror_rows) - set(d1_rows)
    in_both = set(d1_rows) & set(mirror_rows)

    for row_id in sorted(only_in_d1):
        row = d1_rows[row_id]
        # Apply the lag grace — recent rows may not have hit the mirror yet.
        if _within_lag_grace(row.ts, now_dt):
            continue
        report.findings.append(
            IntegrityFinding(
                kind=FindingKind.IN_D1_NOT_IN_MIRROR,
                row_id=row_id,
                detail=f"row in D1 (ts={row.ts}) has no mirror entry beyond {_MIRROR_LAG_GRACE_SECONDS}s grace",
            )
        )

    for row_id in sorted(only_in_mirror):
        # Any mirror row without a D1 row is a finding — either an
        # immutability violation (D1 was deleted) or a Captain-cleared
        # legal-hold redaction the operator reconciles against the
        # exceptions ledger.
        report.findings.append(
            IntegrityFinding(
                kind=FindingKind.IN_MIRROR_NOT_IN_D1,
                row_id=row_id,
                detail="row present in Logpush mirror but missing from D1",
            )
        )

    for row_id in sorted(in_both):
        d1_row = d1_rows[row_id]
        mirror_row = mirror_rows[row_id]
        if d1_row.compare_key() != mirror_row.compare_key():
            report.findings.append(
                IntegrityFinding(
                    kind=FindingKind.DIGEST_MISMATCH,
                    row_id=row_id,
                    detail="load-bearing column drift between D1 and Logpush mirror",
                )
            )

    return report


__all__ = [
    "AuditRow",
    "D1AuditLoader",
    "FindingKind",
    "IntegrityFinding",
    "IntegrityReport",
    "LogpushArchiveLoader",
    "check_audit_integrity",
]
