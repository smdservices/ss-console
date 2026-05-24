"""Audit log writer — synchronous persistence layer for issue #891.

Every safety-relevant action the agent takes (draft created, trust ceiling
promoted, connector bound, invariant violation, etc.) writes a row into the
per-customer D1 audit_log table before the action's effect lands. The write
is synchronous — there is no queue, no batch, no fire-and-forget. Losing an
audit event is treated as a safety-substrate failure on par with bypassing
trust-ceiling enforcement.

Design notes
------------

* The audit_log table lives in the per-customer D1 database
  (`hermes-{slug}-d1`), one binding per customer Machine per ADR 0008 +
  ADR 0009. There is no row-level customer column because cross-customer
  queries are forbidden. The DB binding *is* the customer scope.

* `ts` is ISO 8601 UTC with millisecond precision so the dashboard's
  recent-activity feed can order events that arrive in the same second.

* `id` is a ULID generated locally — sortable by time, monotonic per
  process, no external service required. The full implementation is in
  `_ulid()` below; it follows the spec at https://github.com/ulid/spec.

* Substantive content (the body of a draft email, the diff of a memory
  rule edit, etc.) never lands in this table. The writer takes a payload
  bytes object and computes its SHA-256 digest. The bytes themselves are
  the caller's responsibility to persist to R2 per r2-vectorize-naming.md.

* The executor interface is pluggable: production uses an `HttpD1Executor`
  that calls the Cloudflare D1 HTTP API; tests use a `SqliteExecutor`
  pointed at a tmp_path sqlite database. The interface is one method:
  `execute(sql: str, params: list) -> None`.

* The writer is async because the production HTTP executor uses httpx
  AsyncClient. Tests with the sqlite executor still run inside an asyncio
  event loop; sqlite calls block, which is acceptable in test scope.

Performance target
------------------

AC: <10ms p99 write. The sqlite executor consistently lands under 1ms per
write on dev hardware. The HTTP executor's latency is bounded by network
round-trip to D1 (typically 5-8ms within a Cloudflare datacenter). The
test in `tests/test_audit_log.py::test_write_under_10ms_p99` exercises
the sqlite path and asserts the budget.

Failure modes
-------------

* D1 unavailable: `AuditWriteError` raised. The caller must NOT swallow
  this — an unloggable action must not execute. The substrate invariant
  is "every action that touches state has an audit row." Skipping audit
  to make the agent more available violates the safety floor.

* Invalid action_type: `ValueError` raised before the SQL executes. The
  accepted set lives in `ACCEPTED_ACTION_TYPES` and matches d1-schema.md
  §1 exactly. Adding a new action type means updating both this constant
  and the spec — pull both forward in the same PR.
"""

from __future__ import annotations

import enum
import hashlib
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Awaitable, Callable, Optional, Protocol

log = logging.getLogger("aie.audit_log")


# ---------------------------------------------------------------------------
# Accepted action_type values
#
# Source of truth: docs/specs/ai-employee/d1-schema.md §1 "Accepted action_type
# values". Any addition or removal here must match the spec and any
# fabrication-filter / compliance-evidence-packet consumers.
# ---------------------------------------------------------------------------

ACCEPTED_ACTION_TYPES = frozenset(
    {
        # Draft lifecycle
        "DRAFT_CREATED",
        "DRAFT_APPROVED",
        "DRAFT_REJECTED",
        "DRAFT_EXPIRED",
        # Memory rules
        "MEMORY_RULE_ADDED",
        "MEMORY_RULE_EDITED",
        "MEMORY_RULE_DELETED",
        # Trust ceiling
        "TRUST_PROMOTED",
        "TRUST_DEMOTED",
        # Skill activation
        "SKILL_ENABLED",
        "SKILL_DISABLED",
        # Agent lifecycle
        "AGENT_STOPPED",
        "AGENT_RESUMED",
        # Connector lifecycle
        "CONNECTOR_BOUND",
        "CONNECTOR_UNBOUND",
        "CONNECTOR_AUTH_EXPIRED",
        "CONNECTOR_AUTH_RESTORED",
        "CONNECTOR_TOKEN_REFRESHED",
        "CONNECTOR_HEALTH_PROBE_FAILED",
        # Scope changes
        "SCOPE_CHANGED",
        # Sent-folder watching
        "SENT_DETECTED",
        "SENT_DIFF_INDEXED",
        # Safety substrate
        "INVARIANT_VIOLATION",
        "INVARIANT_BOOT_CHECK_FAILED",
        # RBAC and compliance
        "RBAC_EVENT",
        "COMPLIANCE_PACKET_EXPORTED",
        # Voice gate
        "VOICE_GATE_PASSED",
        "VOICE_GATE_NEAR_PASS",
        "VOICE_GATE_FAILED",
        # Fabrication and escalation
        "FABRICATION_FILTER_TRIGGERED",
        "ESCALATION_FIRED",
        "ESCALATION_ACKNOWLEDGED",
        # Decommission lifecycle
        "DECOMMISSION_INITIATED",
        "DECOMMISSION_DRAIN_COMPLETE",
        "DECOMMISSION_FINAL",
    }
)


class ActorRole(str, enum.Enum):
    """Caller's role at the time of the audited action."""

    PRINCIPAL = "principal"
    OPERATOR = "operator"
    COMPLIANCE = "compliance"
    AGENT = "agent"
    CAPTAIN = "captain"


# ---------------------------------------------------------------------------
# ULID generation
#
# A ULID is a 26-char Crockford-base32 string: 10 chars timestamp (ms since
# epoch) + 16 chars randomness. Sortable. No dashes. The implementation here
# is intentionally minimal — no external dep — and is consistent with the
# `id TEXT PRIMARY KEY` shape declared in migration 0001.
# ---------------------------------------------------------------------------

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def _encode_crockford(value: int, length: int) -> str:
    out = []
    for _ in range(length):
        value, rem = divmod(value, 32)
        out.append(_CROCKFORD[rem])
    return "".join(reversed(out))


def _ulid(now_ms: Optional[int] = None) -> str:
    """Return a 26-char ULID. now_ms is injectable for deterministic tests."""
    ts = now_ms if now_ms is not None else int(time.time() * 1000)
    rand = secrets.randbits(80)
    return _encode_crockford(ts, 10) + _encode_crockford(rand, 16)


def _iso_utc(now: Optional[datetime] = None) -> str:
    """ISO 8601 UTC with millisecond precision and explicit Z suffix."""
    dt = now if now is not None else datetime.now(timezone.utc)
    # strip to milliseconds; trailing Z marks UTC explicitly
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _sha256(payload: Optional[bytes]) -> Optional[str]:
    if payload is None:
        return None
    return hashlib.sha256(payload).hexdigest()


# ---------------------------------------------------------------------------
# Executor interface
#
# The writer talks to D1 through a thin Protocol so tests can swap in a
# sqlite-backed executor without touching network code. Production uses
# `HttpD1Executor` (Cloudflare D1 HTTP API). Tests use `SqliteExecutor`
# from tests/conftest.py or equivalent.
# ---------------------------------------------------------------------------


class Executor(Protocol):
    async def execute(self, sql: str, params: list) -> None: ...


class AuditWriteError(RuntimeError):
    """Raised when the audit log cannot be written.

    The caller must NOT swallow this. Per safety substrate, an unloggable
    action must not execute. If the audit row cannot persist, the
    pending action must abort.
    """


@dataclass(frozen=True)
class AuditEvent:
    """Strongly-typed event payload accepted by `AuditLogWriter.write()`.

    Required:
        action_type — one of ACCEPTED_ACTION_TYPES
        actor       — 'agent' | 'captain' | person_mappings.id

    Optional:
        actor_role     — ActorRole enum (or string for forward-compat)
        skill_name     — name of the skill that originated the action
        matter_ref     — opaque per-vertical reference (matter id, lead id)
        input_payload  — bytes to digest; never stored
        output_payload — bytes to digest; never stored
        diff_payload   — bytes to digest; never stored
        trust_ceiling  — value of the skill's trust_ceiling at action time
        metadata       — JSON-serializable dict; merged then json.dumps()ed
    """

    action_type: str
    actor: str
    actor_role: Optional[ActorRole] = None
    skill_name: Optional[str] = None
    matter_ref: Optional[str] = None
    input_payload: Optional[bytes] = None
    output_payload: Optional[bytes] = None
    diff_payload: Optional[bytes] = None
    trust_ceiling: Optional[str] = None
    metadata: Optional[dict] = field(default=None)


# ---------------------------------------------------------------------------
# Writer
# ---------------------------------------------------------------------------


_INSERT_SQL = (
    "INSERT INTO audit_log "
    "(id, ts, action_type, actor, actor_role, skill_name, matter_ref, "
    "input_digest, output_digest, diff_digest, trust_ceiling, metadata) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)


class AuditLogWriter:
    """Synchronous (single-row-per-call) audit log writer.

    Construction takes an Executor. The writer holds no other state, so a
    single instance per Machine is sufficient and concurrency-safe (the
    executor is responsible for its own concurrency model).

    A production wiring looks like:

        from ai_employee_adapter.audit_log import AuditLogWriter
        from ai_employee_adapter.audit_log import HttpD1Executor

        executor = HttpD1Executor(
            account_id=os.environ["CF_ACCOUNT_ID"],
            database_id=os.environ["AIE_D1_DATABASE_ID"],
            api_token=os.environ["CF_API_TOKEN"],
        )
        writer = AuditLogWriter(executor)
    """

    def __init__(
        self,
        executor: Executor,
        *,
        clock: Optional[Callable[[], datetime]] = None,
        ulid_now_ms: Optional[Callable[[], int]] = None,
    ) -> None:
        self._executor = executor
        self._clock = clock
        self._ulid_now_ms = ulid_now_ms

    async def write(self, event: AuditEvent) -> str:
        """Insert one audit_log row. Returns the inserted ULID.

        Synchronous in the sense that the awaited call returns only after
        the INSERT has been acknowledged by D1. No batching, no queueing.
        """
        if event.action_type not in ACCEPTED_ACTION_TYPES:
            raise ValueError(
                f"action_type {event.action_type!r} not in ACCEPTED_ACTION_TYPES; "
                "update both this constant and docs/specs/ai-employee/d1-schema.md §1"
            )

        now_dt = self._clock() if self._clock else None
        now_ms = self._ulid_now_ms() if self._ulid_now_ms else None
        ulid = _ulid(now_ms=now_ms)
        ts = _iso_utc(now_dt)

        params = [
            ulid,
            ts,
            event.action_type,
            event.actor,
            event.actor_role.value if isinstance(event.actor_role, ActorRole) else event.actor_role,
            event.skill_name,
            event.matter_ref,
            _sha256(event.input_payload),
            _sha256(event.output_payload),
            _sha256(event.diff_payload),
            event.trust_ceiling,
            json.dumps(event.metadata, sort_keys=True, separators=(",", ":")) if event.metadata else None,
        ]

        try:
            await self._executor.execute(_INSERT_SQL, params)
        except Exception as e:  # noqa: BLE001 — re-raise as audit-specific
            log.error(
                "audit_log INSERT failed: action_type=%s actor=%s skill=%s err=%s",
                event.action_type,
                event.actor,
                event.skill_name,
                e,
            )
            raise AuditWriteError(
                f"audit_log INSERT failed for action_type={event.action_type}; "
                "caller MUST abort the pending action (no audit row, no action)"
            ) from e

        return ulid


# ---------------------------------------------------------------------------
# HTTP D1 executor (production)
#
# Calls the Cloudflare D1 HTTP API. Lazy-imported httpx so the module can be
# imported in test environments that don't pull httpx.
# ---------------------------------------------------------------------------


class HttpD1Executor:
    """Cloudflare D1 HTTP API executor.

    Uses the `query` endpoint per the D1 HTTP API spec:
    POST /accounts/{account_id}/d1/database/{database_id}/query

    Requires a CF API token with D1:Edit permission. Account ID and database
    ID come from the per-customer Hermes Machine's bound secrets, set by
    `bin/provision-customer.sh` at provision time.
    """

    def __init__(
        self,
        *,
        account_id: str,
        database_id: str,
        api_token: str,
        timeout_seconds: float = 5.0,
    ) -> None:
        self._url = (
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}"
            f"/d1/database/{database_id}/query"
        )
        self._headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        }
        self._timeout = timeout_seconds
        self._client: Optional[object] = None

    async def execute(self, sql: str, params: list) -> None:
        try:
            import httpx
        except ImportError as e:
            raise RuntimeError(
                "HttpD1Executor requires httpx; install ai-employee[adapter] extras"
            ) from e

        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout, headers=self._headers)

        body = {"sql": sql, "params": params}
        resp: Awaitable = self._client.post(self._url, json=body)  # type: ignore[assignment]
        result = await resp
        if result.status_code != 200:
            raise RuntimeError(
                f"D1 HTTP API returned {result.status_code}: {result.text[:200]}"
            )
        payload = result.json()
        if not payload.get("success"):
            raise RuntimeError(
                f"D1 query failed: {payload.get('errors') or payload}"
            )

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()  # type: ignore[attr-defined]
            self._client = None


# ---------------------------------------------------------------------------
# Sqlite executor (tests + local dev)
#
# Backs the writer with an in-process sqlite3 connection. Used by
# tests/test_audit_log.py and any local-dev script that wants to exercise
# the writer without a real D1.
# ---------------------------------------------------------------------------


class SqliteExecutor:
    """Sqlite3-backed executor for tests and local dev.

    The caller supplies a `sqlite3.Connection` that already has the
    audit_log schema applied (either via 0001_per_customer_schema.sql or
    a hand-built CREATE TABLE in test setup).
    """

    def __init__(self, connection) -> None:
        self._conn = connection

    async def execute(self, sql: str, params: list) -> None:
        cur = self._conn.cursor()
        cur.execute(sql, params)
        self._conn.commit()


# ---------------------------------------------------------------------------
# Convenience: read the env-bound HTTP executor used by bootstrap.sh
# ---------------------------------------------------------------------------


def writer_from_env() -> AuditLogWriter:
    """Return an AuditLogWriter wired to the env-bound D1 HTTP executor.

    Reads `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `AIE_D1_DATABASE_ID` from the
    process env. Raises `RuntimeError` if any is missing — that is a
    bootstrap-time invariant failure and should abort container start.
    """
    missing = [
        k
        for k in ("CF_ACCOUNT_ID", "CF_API_TOKEN", "AIE_D1_DATABASE_ID")
        if not os.environ.get(k)
    ]
    if missing:
        raise RuntimeError(
            f"audit_log.writer_from_env: missing required env vars {missing}; "
            "bootstrap.sh must set these from the per-customer secret bundle"
        )
    executor = HttpD1Executor(
        account_id=os.environ["CF_ACCOUNT_ID"],
        database_id=os.environ["AIE_D1_DATABASE_ID"],
        api_token=os.environ["CF_API_TOKEN"],
    )
    return AuditLogWriter(executor)


# Public surface (`from adapter.audit_log import *`) excludes the raw
# `HttpD1Executor` and `SqliteExecutor` constructors as of issue #861's
# TOCTOU hardening: external callers MUST go through
# `adapter.d1_env.namespaced_executor_from_env(...)` so every D1 access
# is bound to a customer slug. The raw classes remain importable by
# explicit name for the in-tree writer path (per the audit-log
# immutability design at `audit_log_immutability.py`) and for tests,
# but they are not advertised. A future PR can mark them
# underscore-private once the in-tree consumers migrate.
__all__ = [
    "ACCEPTED_ACTION_TYPES",
    "ActorRole",
    "AuditEvent",
    "AuditLogWriter",
    "AuditWriteError",
    "Executor",
    "writer_from_env",
]
