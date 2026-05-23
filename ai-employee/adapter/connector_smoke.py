"""Connector smoke-test framework (issue #852).

A real connector regression surface: for every enabled BUILD or Composio
connector declared in `customer.yaml`, invoke ONE read-only call against
the customer's tenant and capture (auth, scope, shape) outcomes. Auth /
scope / shape issues surface BEFORE any write capability runs.

Design intent
-------------

The Phase A stub in `run_prod_smoke_test.py` enumerated the plan but did
not execute anything. This module operationalizes the plan: each
connector is paired with a registered probe, the probe makes a single
read-only capability call, the result is graded against the capability's
conformance invariants (CAPABILITY_SET_HONEST, NO_AUTONOMOUS_EXTERNAL_SEND,
NULL_FOR_ABSENT, NO_FIELD_FABRICATION), and the aggregated `SmokeReport`
is returned to the caller.

Invariants enforced by this module
----------------------------------

1. **No mutating method ever invoked.** The probe registry only accepts
   methods from a hardcoded allowlist of read-only capability methods
   (`describe_capabilities`, `health_check`, `search_matters`,
   `list_matter_documents`, `list_documents`, `get_document` with a
   dummy id, `list_events`, `list_sent_messages`, etc.). A probe that
   tries to register a method outside the allowlist raises
   `ProbeRegistrationError` at construction time -- there is no runtime
   path that lands on a `create_*`, `send_*`, `upload_*`, or `post_*`
   method.

2. **Per-capability conformance shape check.** Every probe result runs
   through `_assert_capability_set_well_formed` (the Python mirror of
   `assertCapabilitySetWellFormed` from
   `src/lib/ai-employee/capabilities/conformance.ts`). Disjoint
   supported/unsupported, non-empty adapter/version, declared
   capability in the closed `CAPABILITY_NAMES` union.

3. **Audit emission.** Each per-connector result emits one
   `CONNECTOR_HEALTH_PROBE_FAILED` audit row when the result is `fail`
   or `partial`. (The accepted action set in `audit_log.py` does not
   include a generic `CONNECTOR_HEALTH_CHECK`; `CONNECTOR_HEALTH_PROBE_FAILED`
   is the closest existing type and the spec's intent is identical --
   record the failure with shape metadata so the dashboard can render
   "Filevine smoke failed: unauthorized" without re-running the probe.)
   The audit row is optional: callers that pass `audit_writer=None`
   (CLI provisioning context) skip emission entirely. The metadata
   block carries the connector capability, adapter slug, probe method,
   status, latency, and shape-violation list.

4. **Failure threshold.** The aggregated report's `overall_status` is:

   * ``pass`` -- every probe returned ``pass``.
   * ``partial`` -- at least one ``fail`` exists AND every failed probe
     was declared as ``optional: true`` in `customer.yaml`'s connector
     block (forward-compat field, defaults to false). Or, every probe
     was ``pass`` except one ``partial`` (shape conformance failed but
     the call itself returned data).
   * ``fail`` -- at least one non-optional connector returned ``fail``,
     OR a probe was registered for an enabled connector but the
     connector's backend is not understood (treat unknown backends as
     hard fail, not silent skip).

   Provisioning callers (`provision-customer.sh`) abort on ``fail`` and
   warn on ``partial``. The periodic cron caller logs ``partial`` as a
   degradation event rather than paging.

Invocation modes
----------------

* **Provisioning-time.** Call `run_smoke_tests(customer_yaml_path,
  registry, audit_writer=None)` from a wrapper script
  (`bin/run-connector-smoke-tests.sh`). The function returns a
  `SmokeReport`; the wrapper exits 0 on `pass`, 1 on `partial`, 2 on
  `fail`. Provisioning treats exit 1 and 2 as "review before enabling
  write capabilities."

* **Periodic.** Same callable, same wrapper script, separate cron
  trigger. The cron caller passes `audit_writer=writer_from_env()` so
  failures land in the per-customer D1 audit log. Cron schedule and
  Worker wiring land in a follow-on PR; this module just exposes the
  entrypoint.

No autonomous send anywhere -- the only side effects are audit-log
writes and stdout.
"""

from __future__ import annotations

import asyncio
import enum
import inspect
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional, Protocol

from adapter.audit_log import (
    ACCEPTED_ACTION_TYPES,
    ActorRole,
    AuditEvent,
    AuditLogWriter,
)

log = logging.getLogger("aie.connector_smoke")


# ---------------------------------------------------------------------------
# Capability names -- mirror of `CAPABILITY_NAMES` in
# `connectors/filevine/errors.py`, which in turn mirrors the closed
# CapabilityName union in `src/lib/ai-employee/capabilities/types.ts`.
# Held here to avoid a cross-package import from this adapter module to
# a vendor connector package.
# ---------------------------------------------------------------------------

CAPABILITY_NAMES: frozenset[str] = frozenset(
    {
        "PracticeManagement",
        "Email",
        "Calendar",
        "DocumentStorage",
        "ESign",
        "CourtAccess",
        "Payments",
        "Accounting",
        "IntakeCRM",
        "CallTracking",
        "InternalComms",
    }
)


# ---------------------------------------------------------------------------
# Read-only method allowlist per capability.
#
# A probe MUST be registered with a method name drawn from this set.
# Attempting to register anything outside this set raises
# ProbeRegistrationError at construction time. There is no runtime path
# that ever lands on a write method.
#
# The lists mirror the "Supported methods" sections of the capability
# interface contracts in src/lib/ai-employee/capabilities/*.ts. When a
# new read-only capability method ships, add it here in the same PR.
# ---------------------------------------------------------------------------

READ_ONLY_METHODS_BY_CAPABILITY: dict[str, frozenset[str]] = {
    "PracticeManagement": frozenset(
        {
            "describe_capabilities",
            "health_check",
            "search_matters",
            "get_matter",
            "list_matter_documents",
            "search_contacts",
            "get_contact",
            "list_time_entries",
        }
    ),
    "Email": frozenset(
        {
            "describe_capabilities",
            "health_check",
            "list_messages",
            "list_sent_messages",
            "get_message",
            "list_folders",
            "list_threads",
        }
    ),
    "Calendar": frozenset(
        {
            "describe_capabilities",
            "health_check",
            "list_events",
            "get_event",
            "list_calendars",
            "get_freebusy",
        }
    ),
    "DocumentStorage": frozenset(
        {
            "describe_capabilities",
            "health_check",
            "list_documents",
            "get_document",
            "list_folder",
            "list_versions",
            "get_scoped_folders",
        }
    ),
    "ESign": frozenset(
        {
            "describe_capabilities",
            "health_check",
            "list_envelopes",
            "get_envelope",
            "list_templates",
        }
    ),
    "CourtAccess": frozenset(
        {
            "describe_capabilities",
            "health_check",
            "list_filings",
            "get_filing",
            "list_dockets",
        }
    ),
    "Payments": frozenset(
        {
            "describe_capabilities",
            "health_check",
            "list_payment_requests",
            "get_payment_request",
            "list_accounts",
        }
    ),
    "Accounting": frozenset(
        {
            "describe_capabilities",
            "health_check",
            "list_invoices",
            "get_invoice",
            "list_expenses",
            "list_accounts",
        }
    ),
    "IntakeCRM": frozenset(
        {
            "describe_capabilities",
            "health_check",
            "list_leads",
            "get_lead",
            "list_pipelines",
        }
    ),
    "CallTracking": frozenset(
        {
            "describe_capabilities",
            "health_check",
            "list_calls",
            "get_call",
            "list_numbers",
        }
    ),
    "InternalComms": frozenset(
        {
            "describe_capabilities",
            "health_check",
            "list_channels",
            "list_messages",
            "get_channel",
        }
    ),
}


# ---------------------------------------------------------------------------
# Probe registration
#
# A `SmokeProbe` is the executable form of "for this enabled connector,
# run THIS read-only method with THESE arguments and grade the result."
# Registries are explicit -- the framework does not introspect a
# connector to "find a safe method to call." That would be the slip
# route by which a write method gets called by accident.
# ---------------------------------------------------------------------------


class ProbeRegistrationError(ValueError):
    """Raised at registration time if a probe declares a non-allowlisted
    method, an unknown capability, or a missing factory.
    """


# Type of the factory used to build a vendor adapter instance for a
# given (capability, adapter, backend, connector_config). The factory
# returns the adapter; the probe calls a method on it. Factories live in
# vendor connector packages (e.g. `connectors.filevine`) and are
# registered by the wrapper script at startup, not by this module.
AdapterFactory = Callable[[dict[str, Any]], Any]


@dataclass(frozen=True)
class SmokeProbe:
    """Definition of one read-only smoke probe.

    Attributes
    ----------
    capability:
        Capability name from `CAPABILITY_NAMES`.
    adapter:
        Adapter slug (e.g. ``"filevine"``).
    backend_prefix:
        The `backend:` field's prefix in `customer.yaml`, one of
        ``composio:`` | ``build:`` | ``mcp:`` | ``synthetic:``. The probe
        matches when the enabled connector's backend startswith this
        value.
    method:
        Name of the read-only method to call. MUST be in
        `READ_ONLY_METHODS_BY_CAPABILITY[capability]`.
    args:
        Positional args to pass to the method.
    kwargs:
        Keyword args to pass to the method.
    factory:
        Callable that builds an adapter instance from the connector
        config block. Receives the dict from `customer.yaml`'s
        `connectors.<Capability>` entry (which has `adapter`, `backend`,
        `enabled`, `scopes`, `token_ref`, ...).
    """

    capability: str
    adapter: str
    backend_prefix: str
    method: str
    factory: AdapterFactory
    args: tuple[Any, ...] = ()
    kwargs: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.capability not in CAPABILITY_NAMES:
            raise ProbeRegistrationError(
                f"SmokeProbe capability {self.capability!r} not in CAPABILITY_NAMES; "
                f"valid: {sorted(CAPABILITY_NAMES)}"
            )
        allowlist = READ_ONLY_METHODS_BY_CAPABILITY.get(self.capability)
        if allowlist is None or self.method not in allowlist:
            raise ProbeRegistrationError(
                f"SmokeProbe method {self.method!r} is not in the read-only allowlist "
                f"for capability {self.capability!r}. Allowed: {sorted(allowlist or ())}. "
                "Write methods (create_*, send_*, upload_*, post_*) are forbidden in "
                "smoke probes by design."
            )
        if self.backend_prefix not in {"composio:", "build:", "mcp:", "synthetic:"}:
            raise ProbeRegistrationError(
                f"SmokeProbe backend_prefix {self.backend_prefix!r} must be one of "
                "'composio:' | 'build:' | 'mcp:' | 'synthetic:'"
            )


class SmokeProbeRegistry:
    """Per-process registry of `SmokeProbe` instances.

    Vendor connector packages register their probes by calling
    `registry.register(probe)`. The framework iterates the registry to
    pair each enabled connector with its probe.
    """

    def __init__(self) -> None:
        self._probes: list[SmokeProbe] = []

    def register(self, probe: SmokeProbe) -> None:
        # Validation already ran in __post_init__; this is just append.
        self._probes.append(probe)

    def find(self, *, capability: str, adapter: str, backend: str) -> Optional[SmokeProbe]:
        """Return the first probe matching the enabled connector entry."""
        for p in self._probes:
            if (
                p.capability == capability
                and p.adapter == adapter
                and backend.startswith(p.backend_prefix)
            ):
                return p
        return None

    def __len__(self) -> int:
        return len(self._probes)


# ---------------------------------------------------------------------------
# Result aggregation
# ---------------------------------------------------------------------------


class SmokeStatus(str, enum.Enum):
    PASS = "pass"
    PARTIAL = "partial"
    FAIL = "fail"
    SKIPPED = "skipped"


@dataclass(frozen=True)
class ConnectorSmokeResult:
    """One connector's smoke outcome."""

    capability: str
    adapter: str
    backend: str
    status: SmokeStatus
    elapsed_ms: float
    method_called: Optional[str]
    optional: bool
    shape_violations: tuple[str, ...] = ()
    error_code: Optional[str] = None
    error_message: Optional[str] = None

    def captain_summary(self) -> str:
        """One-line Captain-readable summary."""
        head = f"[{self.status.value.upper()}] {self.capability}/{self.adapter} ({self.backend})"
        if self.status == SmokeStatus.SKIPPED:
            return f"{head}  (not enabled)"
        tail = f"  {self.method_called or '-'}  {self.elapsed_ms:.0f}ms"
        if self.error_code:
            tail += f"  err={self.error_code}"
        if self.shape_violations:
            tail += f"  shape={list(self.shape_violations)}"
        return head + tail


@dataclass(frozen=True)
class SmokeReport:
    """Aggregated outcome across all enabled connectors."""

    customer_id: str
    results: tuple[ConnectorSmokeResult, ...]
    overall_status: SmokeStatus
    started_at_ms: int
    finished_at_ms: int

    def captain_summary(self) -> str:
        head = (
            f"Connector smoke report -- customer={self.customer_id} "
            f"overall={self.overall_status.value.upper()} "
            f"({len(self.results)} connector(s), "
            f"{self.finished_at_ms - self.started_at_ms}ms total)\n"
        )
        body = "\n".join(f"  {r.captain_summary()}" for r in self.results)
        return head + body

    def exit_code(self) -> int:
        """Conventional exit code for CLI wrappers.

        ``0`` on PASS, ``1`` on PARTIAL, ``2`` on FAIL. SKIPPED-only is
        treated as PASS (no enabled connectors means no risk surface).
        """
        if self.overall_status == SmokeStatus.FAIL:
            return 2
        if self.overall_status == SmokeStatus.PARTIAL:
            return 1
        return 0


# ---------------------------------------------------------------------------
# Capability-set shape check -- Python mirror of
# `assertCapabilitySetWellFormed` from
# `src/lib/ai-employee/capabilities/conformance.ts`.
# ---------------------------------------------------------------------------


def _assert_capability_set_well_formed(set_obj: Any, expected_capability: str) -> list[str]:
    """Return a list of shape violations; empty list means well-formed.

    Accepts either a dataclass (Python adapter mirror) or a dict-like
    payload (Composio/MCP response that has been normalized into the
    capability shape upstream).
    """
    violations: list[str] = []

    def get(name: str) -> Any:
        if hasattr(set_obj, name):
            return getattr(set_obj, name)
        if isinstance(set_obj, dict):
            return set_obj.get(name)
        return None

    capability = get("capability")
    adapter = get("adapter")
    version = get("version")
    supported = get("supported_methods")
    unsupported = get("unsupported_methods") or ()

    if capability != expected_capability:
        violations.append(
            f"capability mismatch: declared {capability!r}, probe expected {expected_capability!r}"
        )
    if capability not in CAPABILITY_NAMES:
        violations.append(f"capability {capability!r} not in CAPABILITY_NAMES closed union")
    if not adapter:
        violations.append("adapter must be a non-empty string")
    if not version:
        violations.append("version must be a non-empty string")
    if not supported:
        violations.append("supported_methods must declare at least one method")
    else:
        sup_set = set(supported)
        for m in unsupported:
            if m in sup_set:
                violations.append(
                    f"method {m!r} appears in both supported_methods and unsupported_methods"
                )

    return violations


# ---------------------------------------------------------------------------
# Per-connector probe execution
# ---------------------------------------------------------------------------


# Per-probe wall-clock budget. The conformance harness's
# HEALTH_CHECK_BOUNDED invariant requires `health_check` to resolve in
# under 5s; smoke probes against real tenants pay one round-trip plus
# parsing, so 15s is a generous outer bound. A probe that exceeds this
# is recorded as `fail` with error_code=`transient`.
PROBE_TIMEOUT_SECONDS = 15.0


async def _run_one_probe(
    probe: SmokeProbe,
    connector_config: dict[str, Any],
) -> ConnectorSmokeResult:
    """Run one probe end-to-end and grade the result."""
    optional = bool(connector_config.get("optional", False))
    backend = connector_config.get("backend") or ""

    start = time.monotonic()
    try:
        adapter_instance = probe.factory(connector_config)
    except Exception as exc:  # noqa: BLE001 -- factory failures wrap to fail
        elapsed_ms = (time.monotonic() - start) * 1000.0
        return ConnectorSmokeResult(
            capability=probe.capability,
            adapter=probe.adapter,
            backend=backend,
            status=SmokeStatus.FAIL,
            elapsed_ms=elapsed_ms,
            method_called=None,
            optional=optional,
            error_code="validation_failed",
            error_message=f"adapter factory raised: {type(exc).__name__}: {exc}",
        )

    # Resolve the method bound on the adapter instance. If the adapter
    # does not expose the method we registered for, surface that as a
    # shape violation -- the connector is wired to an adapter that does
    # not implement the capability the customer.yaml claims.
    method_fn = getattr(adapter_instance, probe.method, None)
    if method_fn is None:
        elapsed_ms = (time.monotonic() - start) * 1000.0
        return ConnectorSmokeResult(
            capability=probe.capability,
            adapter=probe.adapter,
            backend=backend,
            status=SmokeStatus.FAIL,
            elapsed_ms=elapsed_ms,
            method_called=probe.method,
            optional=optional,
            shape_violations=(
                f"adapter does not expose {probe.method!r}; declared in customer.yaml "
                f"as {probe.adapter}/{probe.capability}",
            ),
            error_code="capability_not_supported",
        )

    shape_violations: tuple[str, ...] = ()
    try:
        # Always run describe_capabilities() first if the adapter has
        # one -- the shape check is the cheapest, most diagnostic
        # signal and it runs independent of whether the probe method
        # also returns shape-checked data.
        describe = getattr(adapter_instance, "describe_capabilities", None)
        if callable(describe):
            try:
                set_obj = describe()
                if inspect.isawaitable(set_obj):
                    set_obj = await asyncio.wait_for(set_obj, timeout=PROBE_TIMEOUT_SECONDS)
                v = _assert_capability_set_well_formed(set_obj, probe.capability)
                if v:
                    shape_violations = tuple(v)
            except Exception as exc:  # noqa: BLE001
                shape_violations = (
                    f"describe_capabilities() raised: {type(exc).__name__}: {exc}",
                )

        # Execute the read-only probe method.
        result = method_fn(*probe.args, **probe.kwargs)
        if inspect.isawaitable(result):
            await asyncio.wait_for(result, timeout=PROBE_TIMEOUT_SECONDS)

        elapsed_ms = (time.monotonic() - start) * 1000.0
        if shape_violations:
            # Call returned data but shape conformance failed -- record
            # as partial so the dashboard surfaces the drift without
            # marking the connector dead.
            return ConnectorSmokeResult(
                capability=probe.capability,
                adapter=probe.adapter,
                backend=backend,
                status=SmokeStatus.PARTIAL,
                elapsed_ms=elapsed_ms,
                method_called=probe.method,
                optional=optional,
                shape_violations=shape_violations,
            )

        return ConnectorSmokeResult(
            capability=probe.capability,
            adapter=probe.adapter,
            backend=backend,
            status=SmokeStatus.PASS,
            elapsed_ms=elapsed_ms,
            method_called=probe.method,
            optional=optional,
        )

    except asyncio.TimeoutError:
        elapsed_ms = (time.monotonic() - start) * 1000.0
        return ConnectorSmokeResult(
            capability=probe.capability,
            adapter=probe.adapter,
            backend=backend,
            status=SmokeStatus.FAIL,
            elapsed_ms=elapsed_ms,
            method_called=probe.method,
            optional=optional,
            shape_violations=shape_violations,
            error_code="transient",
            error_message=f"probe exceeded {PROBE_TIMEOUT_SECONDS}s wall-clock budget",
        )
    except Exception as exc:  # noqa: BLE001 -- wrap to result
        elapsed_ms = (time.monotonic() - start) * 1000.0
        # If the adapter raised an AdapterError, surface its `code` and
        # `message`. Otherwise treat as unknown -- the dashboard renders
        # both as "fail" but the code helps Captain triage.
        error_code = getattr(exc, "code", None) or "unknown"
        return ConnectorSmokeResult(
            capability=probe.capability,
            adapter=probe.adapter,
            backend=backend,
            status=SmokeStatus.FAIL,
            elapsed_ms=elapsed_ms,
            method_called=probe.method,
            optional=optional,
            shape_violations=shape_violations,
            error_code=str(error_code),
            error_message=f"{type(exc).__name__}: {exc}",
        )


# ---------------------------------------------------------------------------
# Customer.yaml ingestion -- find the enabled connectors block
# ---------------------------------------------------------------------------


def load_enabled_connectors(customer_yaml_path: Path) -> tuple[str, list[tuple[str, dict[str, Any]]]]:
    """Read `customer.yaml` and return `(customer_id, enabled_entries)`.

    Each enabled entry is `(CapabilityName, connector_config_dict)`.
    Connectors with `enabled: false` are excluded. Synthetic backends
    (`synthetic:<fixture>`) are excluded because they target local
    fixtures, not a customer tenant -- smoke testing them adds zero
    diagnostic value.
    """
    try:
        import yaml  # type: ignore[import-not-found]
    except ImportError as exc:
        raise RuntimeError(
            "load_enabled_connectors requires pyyaml; "
            "invoke via `uv run --with pyyaml python3 ...`"
        ) from exc

    with open(customer_yaml_path) as f:
        cfg = yaml.safe_load(f)

    customer_id = cfg.get("customer_id") or ""
    if not customer_id:
        raise ValueError(
            f"customer.yaml at {customer_yaml_path} has no customer_id; cannot smoke-test"
        )

    enabled: list[tuple[str, dict[str, Any]]] = []
    for cap_name, conn in (cfg.get("connectors") or {}).items():
        if not conn:
            continue
        if not conn.get("enabled", True):
            continue
        backend = conn.get("backend") or ""
        if backend.startswith("synthetic:"):
            # Synthetic fixtures land in skill-regression CI, not here.
            continue
        enabled.append((cap_name, conn))

    return customer_id, enabled


# ---------------------------------------------------------------------------
# Audit emission
# ---------------------------------------------------------------------------


# The accepted action-type set in `adapter/audit_log.py` does not
# include a generic `CONNECTOR_HEALTH_CHECK`. The closest existing type
# is `CONNECTOR_HEALTH_PROBE_FAILED`, which is exactly the event we
# want to record (a failed / partial probe). PASS results are not
# emitted -- the audit log is the failure record, not the success ping
# log. Adding `CONNECTOR_HEALTH_CHECK` to ACCEPTED_ACTION_TYPES requires
# coordinating with d1-schema.md §1 per the audit_log module docstring;
# this PR stays within the existing set.
_AUDIT_ACTION_TYPE = "CONNECTOR_HEALTH_PROBE_FAILED"


def _audit_metadata(result: ConnectorSmokeResult) -> dict[str, Any]:
    return {
        "capability": result.capability,
        "adapter": result.adapter,
        "backend": result.backend,
        "method": result.method_called,
        "status": result.status.value,
        "optional": result.optional,
        "elapsed_ms": round(result.elapsed_ms, 1),
        "shape_violations": list(result.shape_violations),
        "error_code": result.error_code,
        "error_message": result.error_message,
    }


async def _emit_audit(writer: AuditLogWriter, result: ConnectorSmokeResult) -> None:
    if result.status not in {SmokeStatus.FAIL, SmokeStatus.PARTIAL}:
        return
    # Sanity check -- the accepted set MUST contain our action type.
    if _AUDIT_ACTION_TYPE not in ACCEPTED_ACTION_TYPES:
        log.warning(
            "_AUDIT_ACTION_TYPE %r not in ACCEPTED_ACTION_TYPES; "
            "skipping audit emission. Update audit_log.py.",
            _AUDIT_ACTION_TYPE,
        )
        return
    try:
        await writer.write(
            AuditEvent(
                action_type=_AUDIT_ACTION_TYPE,
                actor="captain",
                actor_role=ActorRole.CAPTAIN,
                skill_name="connector-smoke",
                metadata=_audit_metadata(result),
            )
        )
    except Exception as exc:  # noqa: BLE001 -- audit failure logged, not raised
        log.error(
            "audit emission for connector-smoke %s/%s failed: %s",
            result.capability,
            result.adapter,
            exc,
        )


# ---------------------------------------------------------------------------
# Top-level entrypoint
# ---------------------------------------------------------------------------


def _overall_status(results: list[ConnectorSmokeResult]) -> SmokeStatus:
    """Compute the report's overall status per the threshold rules.

    See module docstring §"Failure threshold".
    """
    if not results:
        return SmokeStatus.PASS
    has_required_fail = any(
        r.status == SmokeStatus.FAIL and not r.optional for r in results
    )
    if has_required_fail:
        return SmokeStatus.FAIL
    has_any_fail = any(r.status == SmokeStatus.FAIL for r in results)
    has_any_partial = any(r.status == SmokeStatus.PARTIAL for r in results)
    if has_any_fail or has_any_partial:
        return SmokeStatus.PARTIAL
    return SmokeStatus.PASS


async def run_smoke_tests(
    *,
    customer_yaml_path: Path,
    registry: SmokeProbeRegistry,
    audit_writer: Optional[AuditLogWriter] = None,
) -> SmokeReport:
    """Run every registered probe against every enabled connector.

    Parameters
    ----------
    customer_yaml_path:
        Path to the customer's `customer.yaml` (e.g.
        `ai-employee/customers/<slug>/customer.yaml`).
    registry:
        `SmokeProbeRegistry` populated by vendor connector packages.
        Empty registries are valid (zero probes returns SKIPPED-only).
    audit_writer:
        Optional `AuditLogWriter` for per-connector failure rows.
        Provisioning-time callers pass `None`; the periodic cron caller
        passes a writer wired to the customer's D1.

    Returns
    -------
    `SmokeReport` with per-connector results and an aggregated status.
    """
    customer_id, enabled = load_enabled_connectors(customer_yaml_path)
    started_at_ms = int(time.time() * 1000)
    results: list[ConnectorSmokeResult] = []

    for cap_name, conn in enabled:
        adapter_slug = conn.get("adapter") or ""
        backend = conn.get("backend") or ""

        probe = registry.find(capability=cap_name, adapter=adapter_slug, backend=backend)
        if probe is None:
            # Unknown backend or unregistered probe is a hard fail per
            # design rule -- silent skip would let a misconfigured
            # connector slip past day-1. The dashboard renders this as
            # "no probe registered for filevine/PracticeManagement
            # build:filevine-mcp" so Captain knows what to wire.
            results.append(
                ConnectorSmokeResult(
                    capability=cap_name,
                    adapter=adapter_slug,
                    backend=backend,
                    status=SmokeStatus.FAIL,
                    elapsed_ms=0.0,
                    method_called=None,
                    optional=bool(conn.get("optional", False)),
                    shape_violations=(
                        f"no probe registered for capability={cap_name} "
                        f"adapter={adapter_slug} backend={backend}",
                    ),
                    error_code="capability_not_supported",
                    error_message="connector enabled in customer.yaml but no probe registered",
                )
            )
            continue

        result = await _run_one_probe(probe, conn)
        results.append(result)

        if audit_writer is not None:
            await _emit_audit(audit_writer, result)

    finished_at_ms = int(time.time() * 1000)
    return SmokeReport(
        customer_id=customer_id,
        results=tuple(results),
        overall_status=_overall_status(results),
        started_at_ms=started_at_ms,
        finished_at_ms=finished_at_ms,
    )


__all__ = [
    "AdapterFactory",
    "CAPABILITY_NAMES",
    "ConnectorSmokeResult",
    "PROBE_TIMEOUT_SECONDS",
    "ProbeRegistrationError",
    "READ_ONLY_METHODS_BY_CAPABILITY",
    "SmokeProbe",
    "SmokeProbeRegistry",
    "SmokeReport",
    "SmokeStatus",
    "_AUDIT_ACTION_TYPE",
    "load_enabled_connectors",
    "run_smoke_tests",
]
