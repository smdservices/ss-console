"""Per-connection isolation enforcement for Composio-managed connectors (issue #850).

Composio manages OAuth for Gmail, Slack, and GitHub adapters
(`backend: composio:*` in `customer.yaml`). Per [ADR 0009](../../../docs/adr/0009-cross-machine-query-prohibition.md)
the runtime must be incapable of querying another customer's data, but
the Composio surface introduces a vector ADR 0009 does not cover on
its own: the provisioner stages one tenant-wide `COMPOSIO_API_KEY`,
and every call into Composio carries a connection ID that names which
end-user's OAuth credential the action runs against. A misrouted
connection ID is a cross-customer leakage vector.

The Hermes Machine itself is per-customer (ADR 0007), so the slug
binding is already known at boot. This module makes that binding
mechanical at every Composio call site.

Contract
--------

* `customer.yaml` connectors of `backend: composio:*` MUST declare a
  `composio_connection_id` of the shape `conn_{slug}_<token>` (see
  `classify_composio_connection_id` for the exact rule). The
  TypeScript validator at
  `src/lib/ai-employee/customer-yaml/sections-connectors.ts` enforces
  the structural shape; this module enforces it at runtime.

* Every Composio API call site wraps its connection-ID argument in
  `ComposioConnectionGuard.assert_belongs(connection_id)`. The guard
  is constructed against the bound customer slug at Machine boot —
  one instance per Hermes Machine, never a shared/cross-customer
  instance.

* Refusal is loud:
  * `ComposioIsolationError` is raised with a structured
    `(violation_kind, expected_slug, attempted_connection_id)` shape
    matching the `NamespaceAssertionError` contract in
    `namespace_assertion.py`. Callers MUST NOT swallow it.
  * One `INVARIANT_VIOLATION` audit row is written via the injected
    `AuditLogWriter` before the raise so the operator dashboard sees
    the violation even if a caller catches the exception (it must
    not).

Why this matches namespace_assertion's shape
--------------------------------------------

Issue #850 calls out the same failure family the namespace assertion
covers (cross-customer leakage) at a different layer (managed OAuth
vs. storage bindings). Using the same exception attributes, the same
`INVARIANT_VIOLATION` audit action_type, and the same constructor
ergonomics means: a single audit query surfaces both kinds of
violation; operator runbooks already know the shape; reviewers reading
the two files together see the parallel.

The wrapper composes with `namespace_assertion.py` rather than
replacing it. A Composio call site that also writes to D1 still hits
the D1 wrapper for SQL-string scoping; the Composio guard is the
gate for Composio's own connection-ID surface.

Out of scope
------------

* Composio SDK installation / retry / rate-limit logic. The guard is
  the safety floor; concrete adapters (forthcoming Gmail / Slack /
  GitHub `composio_*.py` connectors) will pass their connection ID
  through `assert_belongs()` before making each HTTP call. Adding a
  new Composio-managed connector requires importing the guard and
  threading the assertion at every call site — there is no
  alternative path.

* Time-of-check / time-of-use. The guard inspects the connection ID
  passed to it; a caller that constructs a Composio client with a raw
  connection ID at boot and never re-checks at call time can still
  bypass. The follow-on hardening is to surface the guard as part of
  the Composio client wrapper API so adapters cannot construct one
  without supplying the guard.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

from ..audit_log import (
    ACCEPTED_ACTION_TYPES,
    AuditEvent,
    AuditLogWriter,
    AuditWriteError,
)

log = logging.getLogger("aie.composio_assertion")


# ---------------------------------------------------------------------------
# Slug validation
#
# Matches the slug shape enforced by bin/provision-customer.sh and
# namespace_assertion.py: lowercase alphanumerics + dashes, 2-40 chars,
# no leading or trailing dash. Kept local rather than imported so this
# module is self-contained for the adapter boot path; if the two
# diverge, that is a hardcoded test failure in test_composio_assertion.
# ---------------------------------------------------------------------------


_SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$")


def _validate_slug(slug: str) -> str:
    if not isinstance(slug, str) or not _SLUG_PATTERN.match(slug):
        raise ValueError(
            f"composio guard slug {slug!r} does not match required pattern "
            "(lowercase alphanumerics + dashes, 2-40 chars, no leading/trailing dash); "
            "this is a bootstrap-time invariant failure — see bin/provision-customer.sh"
        )
    return slug


# ---------------------------------------------------------------------------
# Connection-ID shape
#
# We enforce `conn_{slug}_{suffix}` where:
#   - `conn_` is the literal prefix (consistent with Composio's own
#     connection-ID surface, which uses `conn_<random>` by default).
#   - `{slug}` is the customer slug, matching `_SLUG_PATTERN`.
#   - `{suffix}` is any non-empty string of [a-zA-Z0-9_-]{4,80}.
#
# This is an SMD naming convention layered on top of Composio's own
# IDs. Composio itself does not natively enforce a per-tenant prefix,
# so the provisioner mints connection IDs of this shape and the
# guard refuses anything else.
#
# The TS validator at sections-connectors.ts enforces the same shape
# at customer.yaml authoring time; this module is the runtime backstop
# for the case where a connection ID is constructed dynamically (a
# bug in the adapter, a misconfigured fixture, or — the threat we
# care about — a copy/paste of another customer's connection ID).
# ---------------------------------------------------------------------------


_CONNECTION_ID_SUFFIX = r"[A-Za-z0-9_-]{4,80}"
_CONNECTION_ID_PATTERN = re.compile(
    rf"^conn_([a-z0-9][a-z0-9-]{{0,38}}[a-z0-9])_({_CONNECTION_ID_SUFFIX})$"
)


def composio_connection_id_for_slug_prefix(slug: str) -> str:
    """Return the required prefix for a Composio connection ID bound to `slug`.

    The provisioner uses this to mint connection IDs of the form
    `{prefix}{suffix}`. The validator and runtime guard both compare
    against it.
    """
    _validate_slug(slug)
    return f"conn_{slug}_"


@dataclass(frozen=True)
class _ConnectionIdDecision:
    ok: bool
    found_slug: Optional[str]
    reason: str


def classify_composio_connection_id(
    connection_id: str, expected_slug: str
) -> _ConnectionIdDecision:
    """Decide whether a Composio connection ID belongs to `expected_slug`.

    Accepted: `conn_{expected_slug}_{suffix}` where suffix matches
    `_CONNECTION_ID_SUFFIX`.

    Refusals (in order of inspection):

    * empty / non-string
    * shape does not match `conn_{slug}_{suffix}`
    * slug captured by the regex does not equal `expected_slug` —
      the connection ID is bound to a foreign customer

    Returns the captured slug so callers can record it on the refusal.
    """
    if not isinstance(connection_id, str) or not connection_id:
        return _ConnectionIdDecision(
            ok=False, found_slug=None, reason="empty connection id"
        )
    match = _CONNECTION_ID_PATTERN.match(connection_id)
    if not match:
        return _ConnectionIdDecision(
            ok=False,
            found_slug=None,
            reason=(
                f"connection id {connection_id!r} does not match "
                "conn_{slug}_{suffix} shape required for Composio-managed "
                "connectors (see ai-employee/adapter/connectors/composio_assertion.py)"
            ),
        )
    found_slug = match.group(1)
    if found_slug != expected_slug:
        return _ConnectionIdDecision(
            ok=False,
            found_slug=found_slug,
            reason=(
                f"connection id bound to foreign customer slug "
                f"{found_slug!r}; this Machine is bound to "
                f"{expected_slug!r}"
            ),
        )
    return _ConnectionIdDecision(ok=True, found_slug=found_slug, reason="ok")


# ---------------------------------------------------------------------------
# Refusal exception
# ---------------------------------------------------------------------------


class ComposioIsolationError(RuntimeError):
    """Raised when a Composio connection ID is bound to a foreign customer.

    Same contract as `NamespaceAssertionError`: the caller MUST NOT
    swallow this. An attempted cross-customer Composio call is a
    safety-substrate alarm and the action that triggered it must
    abort.

    Attributes mirror the audit row written alongside the raise:

    * `violation_kind` — always `composio_connection_id`
    * `expected_slug` — the slug the guard was bound to at construction
    * `attempted_connection_id` — the foreign connection ID the caller passed
    """

    def __init__(
        self,
        *,
        expected_slug: str,
        attempted_connection_id: str,
        detail: str,
    ) -> None:
        super().__init__(
            f"composio isolation violation: "
            f"expected slug={expected_slug!r}, "
            f"attempted connection_id={attempted_connection_id!r}; "
            f"{detail}"
        )
        self.violation_kind = "composio_connection_id"
        self.expected_slug = expected_slug
        self.attempted_connection_id = attempted_connection_id
        self.detail = detail


# ---------------------------------------------------------------------------
# Audit emission
#
# One INVARIANT_VIOLATION row per refusal. Same emit shape as
# namespace_assertion._emit_violation_audit so a single audit query
# surfaces both namespace and Composio isolation violations.
# ---------------------------------------------------------------------------


_INVARIANT_VIOLATION = "INVARIANT_VIOLATION"

assert _INVARIANT_VIOLATION in ACCEPTED_ACTION_TYPES, (
    f"composio_assertion expects {_INVARIANT_VIOLATION!r} in ACCEPTED_ACTION_TYPES "
    "(see ai-employee/adapter/audit_log.py)"
)


async def _emit_violation_audit(
    audit_writer: Optional[AuditLogWriter],
    *,
    expected_slug: str,
    attempted_connection_id: str,
    capability: Optional[str],
    operation: Optional[str],
    actor: str = "agent",
) -> None:
    """Write one INVARIANT_VIOLATION audit row for a Composio refusal.

    `capability` and `operation` carry the call-site context (e.g.
    "Email" / "messages.send") so audit-log review can answer "what
    did the agent try to do?" without correlating against a separate
    log. Both are optional because the wrapper might be invoked from
    a path that has not stamped that context yet; production wiring
    should always pass them.
    """
    if audit_writer is None:
        log.warning(
            "composio isolation fired without audit writer; "
            "expected_slug=%s attempted_connection_id=%s capability=%s operation=%s",
            expected_slug,
            attempted_connection_id,
            capability,
            operation,
        )
        return
    try:
        await audit_writer.write(
            AuditEvent(
                action_type=_INVARIANT_VIOLATION,
                actor=actor,
                metadata={
                    "invariant": "composio_connection_isolation",
                    "violation_kind": "composio_connection_id",
                    "expected_slug": expected_slug,
                    "attempted_connection_id": attempted_connection_id,
                    "capability": capability,
                    "operation": operation,
                    "source": "ai-employee/adapter/connectors/composio_assertion.py",
                },
            )
        )
    except AuditWriteError:
        # Loud, but we still raise — transport failure on the audit
        # channel must not mask the cross-customer attempt.
        log.exception(
            "audit emission failed for composio isolation violation; "
            "expected_slug=%s attempted_connection_id=%s capability=%s operation=%s",
            expected_slug,
            attempted_connection_id,
            capability,
            operation,
        )


# ---------------------------------------------------------------------------
# Guard
# ---------------------------------------------------------------------------


class ComposioConnectionGuard:
    """Per-customer enforcement for Composio connection IDs.

    Construction takes the customer slug the Machine is bound to plus
    an optional `AuditLogWriter`. The guard is intended to live for the
    lifetime of the Machine — one instance, never shared across
    customers (a shared instance would be a category error and the
    constructor's slug validation will not catch it; that is what
    `assert_belongs` enforces).

    Adapter call sites use the guard like:

        guard = ComposioConnectionGuard(expected_slug=customer_slug, audit_writer=writer)
        ...
        async def send_message(connection_id: str, payload: dict) -> None:
            await guard.assert_belongs(
                connection_id,
                capability="Email",
                operation="messages.send",
            )
            await composio_client.execute("gmail.send", connection_id=connection_id, ...)

    `assert_belongs` is async because the audit write is async; the
    guard does no other I/O.
    """

    def __init__(
        self,
        *,
        expected_slug: str,
        audit_writer: Optional[AuditLogWriter] = None,
    ) -> None:
        self._slug = _validate_slug(expected_slug)
        self._audit = audit_writer

    @property
    def expected_slug(self) -> str:
        return self._slug

    async def assert_belongs(
        self,
        connection_id: str,
        *,
        capability: Optional[str] = None,
        operation: Optional[str] = None,
    ) -> None:
        """Raise `ComposioIsolationError` if `connection_id` is foreign.

        On the happy path returns None silently. Pass `capability` and
        `operation` so the audit row on refusal carries call-site
        context; both are optional but production wiring should
        provide them.
        """
        decision = classify_composio_connection_id(connection_id, self._slug)
        if decision.ok:
            return
        attempted = connection_id if isinstance(connection_id, str) else repr(connection_id)
        await _emit_violation_audit(
            self._audit,
            expected_slug=self._slug,
            attempted_connection_id=attempted,
            capability=capability,
            operation=operation,
        )
        raise ComposioIsolationError(
            expected_slug=self._slug,
            attempted_connection_id=attempted,
            detail=decision.reason,
        )


__all__ = [
    "ComposioConnectionGuard",
    "ComposioIsolationError",
    "classify_composio_connection_id",
    "composio_connection_id_for_slug_prefix",
]
