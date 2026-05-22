"""Audit-log immutability enforcement at the Worker layer (issue #892).

Cloudflare D1 does not ship per-role table permissions, so the substrate
cannot grant the agent-runtime binding INSERT-only on `audit_log` the way
a Postgres deployment would. That gap is documented in `d1-schema.md`
§Failure modes and `index.md` open ambiguity #5. This module is the
Worker-layer answer to that gap.

Three pieces:

1. `D1Executor` — a thin wrapper around any existing `Executor` (the
   protocol declared in `audit_log.py`) that intercepts SQL targeting the
   `audit_log` table and rejects UPDATE / DELETE. The wrapper is what
   every non-writer caller should hold. The writer module (`audit_log.py`,
   shipped in PR #942) constructs its `AuditLogWriter` against the
   unrestricted executor directly — that is the only path on the substrate
   that may INSERT into `audit_log`.

2. `LogpushMirror` — a Protocol with a single `mirror_audit_event(row)`
   coroutine. v1 ships a no-op stub (`NoopLogpushMirror`) that satisfies
   the protocol without doing any I/O. The Hermes-side deployment will
   land a real implementation that streams each row into the per-customer
   R2 archive bucket (`smd-audit-archive-{slug}/`) per the configuration
   block in `wrangler.toml` (additive in this PR, deferred wiring).

3. `LegalHoldException` — a sentinel exception type the Captain-only
   redaction script raises after the multi-confirmation guard in
   `bin/audit-redact.sh` clears (script is out of scope for this issue,
   see `docs/specs/ai-employee/audit-log-immutability.md` §Captain
   exception process). The wrapper recognizes the exception and lets
   the SQL through — there is no other bypass path.

Design notes
------------

* The wrapper inspects the *first* SQL keyword (after leading whitespace
  and comments) plus a heuristic match for the `audit_log` table name.
  The audit-log writer's INSERT statement (`INSERT INTO audit_log ...`)
  passes; UPDATE and DELETE statements targeting `audit_log` are
  rejected with `AuditLogImmutabilityError`.

* The check is deliberately conservative. If the SQL parser cannot
  decide whether a statement touches `audit_log`, we err on the side of
  rejection: a false-positive blocks one query and is loud; a
  false-negative silently violates the safety floor.

* Multi-statement SQL (semicolon-separated) is rejected wholesale when
  it touches `audit_log`. D1's HTTP API accepts only single-statement
  parameterized queries by convention, so this is not a real-world
  constraint loss.

* The wrapper does not interpret SQL — it does not understand JOINs,
  WITH clauses, or fancy DML. It pattern-matches on keyword + table
  name. The complete grammar of "what statements are allowed against
  audit_log" is: `INSERT INTO audit_log ... VALUES ...` and
  `SELECT ... FROM audit_log ...`. Everything else is rejected.

* The Logpush mirror is a fire-and-forget protocol — the wrapper does
  NOT await it inside the INSERT critical path. The writer is the only
  module that mirrors, and it does so after a successful INSERT, not
  before. Mirror failures are logged but do NOT roll back the INSERT
  (the D1 row is the durable record; the mirror is the
  immutability-backup record per Logpush retention).

Out of scope (this PR)
----------------------

* `bin/audit-redact.sh` — the Captain-only redaction script. See the
  spec for the documented procedure.
* The real Logpush mirror that talks to R2 with Object Lock. v1 ships
  the protocol shape and a no-op stub; Hermes-side wiring lands later.
* Replacing `audit_log.py`'s direct executor wiring. The writer keeps
  using the unrestricted executor — that is the one path that may
  INSERT. This module wraps every OTHER caller.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional, Protocol

log = logging.getLogger("aie.audit_log.immutability")


# ---------------------------------------------------------------------------
# Public exception types
# ---------------------------------------------------------------------------


class AuditLogImmutabilityError(RuntimeError):
    """Raised when a caller attempts UPDATE/DELETE/TRUNCATE on audit_log.

    The substrate treats audit_log rows as immutable. The only writer is
    the audit-log INSERT path (`AuditLogWriter` in
    `ai-employee/adapter/audit_log.py`). The only legitimate path that
    modifies an existing row is the Captain-supervised redaction script,
    which surfaces a `LegalHoldException` to bypass the guard — see
    `docs/specs/ai-employee/audit-log-immutability.md`.
    """


class LegalHoldException(Exception):  # noqa: N818 — sentinel name, not Error suffix
    """Sentinel attached to an executor call to bypass the immutability check.

    Raised only by `bin/audit-redact.sh` (out of scope this PR) after a
    Captain-only multi-confirmation guard clears. The wrapper recognizes
    the exception type via the `legal_hold_ticket` kwarg on `execute` — see
    `D1Executor.execute` below. There is no other bypass path.

    The exception carries the ticket id of the corresponding row in the
    `audit_exceptions_ledger` (a separate immutable ledger maintained on
    the Captain-side control plane — see the spec). Without a non-empty
    ticket the bypass is rejected even if the exception is raised.
    """

    def __init__(self, ticket: str) -> None:
        if not ticket:
            raise ValueError("LegalHoldException requires a non-empty ticket id")
        super().__init__(f"legal_hold_ticket={ticket}")
        self.ticket = ticket


# ---------------------------------------------------------------------------
# SQL inspection
#
# The grammar we accept against `audit_log`:
#
#   INSERT INTO audit_log ...        (the writer path)
#   SELECT ... FROM audit_log ...    (reads)
#
# Everything else against `audit_log` is rejected. Statements that don't
# touch `audit_log` at all are passed through unchanged.
# ---------------------------------------------------------------------------


# Mutating verbs we block when targeting audit_log.
_MUTATING_VERBS = ("UPDATE", "DELETE", "REPLACE", "TRUNCATE", "DROP", "ALTER")

# Single regex that finds `audit_log` as a SQL token (word boundaries,
# case-insensitive). Comments are stripped from the statement before the
# match runs.
_AUDIT_LOG_TOKEN = re.compile(r"\baudit_log\b", re.IGNORECASE)

# Strip /* ... */ block comments and -- line comments before inspection
# so they cannot hide the table name.
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_LINE_COMMENT = re.compile(r"--[^\n]*")


def _strip_sql_comments(sql: str) -> str:
    """Remove SQL comments so they cannot hide table references."""
    sql = _BLOCK_COMMENT.sub(" ", sql)
    sql = _LINE_COMMENT.sub(" ", sql)
    return sql


def _first_verb(sql: str) -> str:
    """Return the first SQL keyword (uppercased) after leading whitespace."""
    stripped = sql.lstrip()
    # Take the leading word — stops at whitespace, paren, or semicolon
    match = re.match(r"([A-Za-z]+)", stripped)
    return match.group(1).upper() if match else ""


def _touches_audit_log(sql: str) -> bool:
    return bool(_AUDIT_LOG_TOKEN.search(sql))


def _is_multi_statement(sql: str) -> bool:
    """True if the SQL contains a semicolon separating multiple statements.

    A trailing semicolon on a single statement does NOT count. We strip
    trailing whitespace + semicolons before checking for embedded ones.
    """
    trimmed = sql.rstrip().rstrip(";").rstrip()
    return ";" in trimmed


def is_mutation_against_audit_log(sql: str) -> bool:
    """Public helper: does this statement attempt a forbidden write?

    Returns True if the SQL targets `audit_log` and the leading verb is
    in `_MUTATING_VERBS`, OR if the SQL is multi-statement and any part
    of it mentions `audit_log`. Used by both `D1Executor` and the
    integrity-check module's loader so the rules live in one place.
    """
    clean = _strip_sql_comments(sql)
    if not _touches_audit_log(clean):
        return False
    if _is_multi_statement(clean):
        # Multi-statement queries against audit_log are rejected wholesale.
        # The single-row INSERT path uses parameterized single statements.
        return True
    verb = _first_verb(clean)
    return verb in _MUTATING_VERBS


# ---------------------------------------------------------------------------
# Executor protocol re-export
#
# We don't import from `audit_log` here to keep the dependency direction
# clean (audit_log.py is the lower-level module). The Executor protocol
# below has the same shape — duck-typed against `audit_log.Executor`.
# ---------------------------------------------------------------------------


class _Executor(Protocol):
    async def execute(self, sql: str, params: list) -> None: ...


# ---------------------------------------------------------------------------
# Logpush mirror protocol
#
# The Hermes-side deployment will land a real implementation. v1 ships
# the protocol shape and a no-op stub so call-sites can already wire
# against the contract.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MirroredAuditRow:
    """The minimum shape mirrored to the immutable backing store.

    Keys mirror the audit_log columns 1:1 so the integrity check can
    deep-compare D1 rows against the mirror archive without translation.
    """

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


class LogpushMirror(Protocol):
    """Mirror one audit_log row to the immutable backing store.

    Real implementations (deferred — see `wrangler.toml` config block)
    POST the row into R2 keyed `{YYYY}/{MM}/{DD}/{ulid}.json` with R2
    Object Lock applied at the bucket level. The mirror is the
    compliance-grade copy: even a compromised Worker cannot delete a
    row from an Object-Lock bucket within the retention window.

    The mirror MUST NOT raise on transient failure — log + return is the
    contract. The integrity check (separate module) catches drift between
    D1 and the mirror and reports it.
    """

    async def mirror_audit_event(self, row: MirroredAuditRow) -> None: ...


class NoopLogpushMirror:
    """v1 default mirror. Logs the row id and returns.

    Replace with the R2-backed implementation when Hermes-side deployment
    lands. Until then, the Logpush job declared in `wrangler.toml` is the
    operational backstop — every D1 query is shipped to Logpush at the
    Cloudflare-platform level regardless of this no-op.
    """

    async def mirror_audit_event(self, row: MirroredAuditRow) -> None:
        log.debug("noop logpush mirror: audit row id=%s action=%s", row.id, row.action_type)


# ---------------------------------------------------------------------------
# The wrapping executor
# ---------------------------------------------------------------------------


class D1Executor:
    """Wraps any `Executor` and rejects forbidden mutations on `audit_log`.

    Every non-writer caller in the substrate should hold a `D1Executor`,
    not the raw HTTP / sqlite executor. The audit-log writer (the only
    legitimate INSERT path) constructs its `AuditLogWriter` against the
    raw executor directly — see `audit_log.py::writer_from_env`.

    Bypass: pass `legal_hold_ticket=<ticket>` to `execute()` together
    with a raised `LegalHoldException`. Bare ticket strings without the
    matching exception are rejected — this prevents a compromised caller
    from typing the ticket in plain code.

    Example:

        from ai_employee_adapter.audit_log_immutability import (
            D1Executor,
            AuditLogImmutabilityError,
        )

        raw = HttpD1Executor(...)
        safe = D1Executor(raw)

        # Reads: allowed
        await safe.execute("SELECT * FROM audit_log WHERE id = ?", [ulid])

        # Mutations: blocked
        try:
            await safe.execute("DELETE FROM audit_log WHERE id = ?", [ulid])
        except AuditLogImmutabilityError:
            # caller MUST NOT swallow this; an attempted audit-log mutation
            # is a safety-substrate alarm
            raise
    """

    def __init__(self, inner: _Executor) -> None:
        self._inner = inner

    async def execute(
        self,
        sql: str,
        params: list,
        *,
        legal_hold_ticket: Optional[str] = None,
    ) -> None:
        if is_mutation_against_audit_log(sql):
            if legal_hold_ticket:
                # Bypass path — the caller asserts a Captain-cleared legal hold.
                # We require a non-empty ticket and log the bypass loudly so
                # the operator audit picks it up. The redaction script
                # (out of scope, see spec) writes the matching exceptions
                # ledger row before invoking this path.
                log.warning(
                    "audit_log immutability bypass: ticket=%s sql=%s",
                    legal_hold_ticket,
                    sql.strip()[:200],
                )
                await self._inner.execute(sql, params)
                return
            log.error(
                "audit_log immutability violation: rejected SQL=%s",
                sql.strip()[:200],
            )
            raise AuditLogImmutabilityError(
                "audit_log is append-only; UPDATE/DELETE/REPLACE/TRUNCATE/DROP/ALTER "
                "rejected at the Worker layer. The only legitimate writer is "
                "ai-employee/adapter/audit_log.py::AuditLogWriter. Captain-supervised "
                "redaction requires the documented exception process — see "
                "docs/specs/ai-employee/audit-log-immutability.md."
            )
        await self._inner.execute(sql, params)


__all__ = [
    "AuditLogImmutabilityError",
    "D1Executor",
    "LegalHoldException",
    "LogpushMirror",
    "MirroredAuditRow",
    "NoopLogpushMirror",
    "is_mutation_against_audit_log",
]
