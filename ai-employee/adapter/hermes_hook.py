"""Hermes hook surface - typed interface for the SMD overlay layer (issue #841).

Background
----------

Per [ADR 0015](../../docs/adr/0015-hermes-fork-vs-upstream.md), SMD maintains
a thin vendored fork of NousResearch/hermes-agent. The fork carries an SMD
overlay layer (`smd/` subpackage) that exposes hook points the upstream
runtime does not. The upstream surface that the overlay extends is
`agent/tool_guardrails.py`. PR #829's runbook confirmed `tool_guardrails.py`
as the integration point at upstream `v2026.5.7` and superseded the original
PR #812 assumption of `tool_router.py`.

This module is the typed contract between:

  * the SMD overlay layer inside the Hermes fork (which constructs a
    `HookRegistry` and exposes it at adapter-load time), and
  * `ai-employee/adapter/aie_adapter.py::register()` (which receives a
    `HookRegistry`, builds the safety-substrate hooks, and installs them).

The contract is held here, in `ai-employee/adapter/`, on purpose. The
adapter side of the integration is what SMD owns end-to-end. The overlay
side ships in the fork and conforms to this interface; the fork is free
to swap its internal implementation without renegotiating the adapter
surface. This is the "stable adapter contract" half of ADR 0015's seam
strategy.

Hook shape
----------

The four hook points cover the four safety-substrate touchpoints Phase A.5
brings online:

  * **pre_tool** - called before any tool executes. The hook receives a
    `ToolCallContext` and either returns silently (the tool proceeds) or
    raises `BlockedToolCall` (the tool is suppressed). This is the runtime
    enforcement seam for trust-ceiling refusals and sticky-stop HARD_STOP.

  * **post_tool** - called after the tool executes (or after the pre-hook
    blocked it). Receives `ToolCallContext` plus a `ToolCallResult`. This
    is the audit emission seam (per-tool `timestamp, customer, skill,
    tool, action class, ceiling decision, outcome` row from issue #842).

  * **refusal** - called when the pre-hook blocked the call. Receives
    enough context for the in-app notification and Captain alert paths
    (delegates to `RefusalHandler` from PR #967 on main).

  * **compaction** - called when Hermes' context manager compacts the
    turn history. Receives the live `PinnedSlots` registry; the hook
    re-injects the pinned slots back into the post-compaction context.
    This is the runtime enforcement seam for safety invariant #4.

Each hook is registered with a `HookRegistry` instance via the overlay's
`register_*_hook()` methods. `aie_adapter.register()` constructs the
hooks and installs them; the overlay's tool-dispatch path invokes them
on the call path.

No autonomous send
------------------

Nothing in this module originates an outbound message. The hooks observe,
classify, and either allow or block. Audit row emission happens via the
existing `AuditLogWriter`; the notification surface is poll-based and out
of scope here. ADR 0005 (reviewer-as-sender) is not relaxed by anything
in this module.

Test isolation
--------------

The module ships an in-memory fake (`FakeHermesRuntime`) suitable for
pytest. Tests can construct a fake, register hooks against it, and drive
tool dispatch synthetically. The fake's `dispatch()` method mirrors the
Hermes runtime's tool-dispatch loop: pre-hook fires, the tool executes
if not blocked, post-hook fires. This is the seam the integration test
in `tests/test_aie_adapter.py` drives.
"""

from __future__ import annotations

import enum
import logging
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional, Protocol


log = logging.getLogger("aie.hermes_hook")


# ---------------------------------------------------------------------------
# Action class - re-declared in the hook surface so the overlay does not
# need to import from `adapter/trust_ceiling.py`. The string values match
# `adapter.trust_ceiling.ActionClass` exactly so the two enums round-trip
# through their `.value`.
# ---------------------------------------------------------------------------


class HookActionClass(str, enum.Enum):
    """Categorization the overlay attaches to a tool call before dispatch.

    Mirrors `adapter.trust_ceiling.ActionClass`. Carried as a separate enum
    here so the overlay side does not pull adapter-internal modules; the
    string values are identical and either side can convert.
    """

    READ = "read"
    INTERNAL_WRITE = "internal_write"
    EXTERNAL_SEND = "external_send"
    COMMITMENT = "commitment"
    DESTRUCTIVE = "destructive"


# ---------------------------------------------------------------------------
# Context objects passed to hooks
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ToolCallContext:
    """Everything a hook needs to classify and audit one tool call.

    Constructed by the overlay's dispatch path. The overlay derives
    `action_class` from the tool's declared metadata (per ADR 0006
    capability contracts) and `ceiling_level` from the resolved
    skill-version pin plus customer.yaml overrides.

    Fields:
        customer - customer slug; matches the D1 binding tenant
        skill_name - skill name from SKILL.md frontmatter
        skill_version - resolved content-hash SHA or version pin
        tool_name - the tool being invoked (e.g. "Email.create_draft")
        action_class - the categorization the overlay attached
        ceiling_level - the trust ceiling configured for the skill
        matter_ref - opaque per-vertical reference (matter id, lead id)
        trace_id - opaque request/turn id for cross-row correlation
        current_turn_approval - True iff the operator approved THIS action
                                in THIS turn (per safety invariant #1)
        arguments - tool arguments; never logged verbatim, may be
                              passed through the digesting path on audit
    """

    customer: str
    skill_name: str
    tool_name: str
    action_class: HookActionClass
    ceiling_level: str
    skill_version: Optional[str] = None
    matter_ref: Optional[str] = None
    trace_id: Optional[str] = None
    current_turn_approval: bool = False
    arguments: Optional[dict] = None


@dataclass(frozen=True)
class ToolCallResult:
    """The outcome of a tool call, fed to post-hook.

    `outcome` is one of "ok" (the tool executed and returned), "error" (the
    tool raised), or "blocked" (the pre-hook raised BlockedToolCall, the
    tool never ran).

    `output_summary` is a short string the post-hook may use for audit
    metadata. The full output never lives here; consumers digest separately
    per the AuditLogWriter contract.
    """

    outcome: str  # "ok" | "error" | "blocked"
    output_summary: Optional[str] = None
    error_type: Optional[str] = None
    duration_ms: Optional[float] = None


# ---------------------------------------------------------------------------
# Block signal - the canonical way a pre-hook stops a tool call
# ---------------------------------------------------------------------------


class BlockedToolCall(Exception):
    """Raised by a pre-tool hook to stop a tool call before execution.

    The overlay's dispatch path catches this exception, treats it as a
    refused call, surfaces the message via post-hook + refusal-hook, and
    proceeds to the next turn without invoking the tool. The Hermes side
    NEVER catches and continues - that is the runtime enforcement
    invariant.

    The `reason` is a closed-vocabulary string from the substrate (e.g.
    one of `DecisionReason.value`s). The `customer_message` is the
    customer-facing wording the refusal handler will surface; it is
    populated lazily by the refusal hook if the pre-hook did not set it.
    """

    def __init__(
        self,
        *,
        reason: str,
        customer_message: Optional[str] = None,
        context: Optional[ToolCallContext] = None,
    ) -> None:
        super().__init__(f"tool call blocked: {reason}")
        self.reason = reason
        self.customer_message = customer_message
        self.context = context


# ---------------------------------------------------------------------------
# Pinned slots - invariant #4 substrate. Survives compaction.
# ---------------------------------------------------------------------------


@dataclass
class PinnedSlots:
    """In-process pinned-slot table. Survives context compaction.

    Per safety invariant #4: "don't act" / "stop" instructions, persona
    identity, reviewer identity, and the customer.yaml signature must
    persist through every compaction event so the post-compaction context
    cannot lose them.

    The pinned-slot table is intentionally a separate data structure from
    the compressible turn history. The compaction hook reads slots from
    this table and re-injects them into the post-compaction context. The
    table itself is never mutated by compaction.

    Slot names are closed-vocabulary keys; values are strings the runtime
    treats as opaque-but-stable. Adding a new slot kind is a one-line
    change here plus an entry in `_DEFAULT_PINNED_SLOT_KEYS` below.
    """

    slots: dict[str, str] = field(default_factory=dict)

    def pin(self, key: str, value: str) -> None:
        """Pin a slot. Idempotent; same key + value = no-op."""
        if not key:
            raise ValueError("pinned-slot key is required")
        if value is None:
            raise ValueError("pinned-slot value is required (use unpin to remove)")
        self.slots[key] = value

    def unpin(self, key: str) -> None:
        """Remove a pinned slot. Captain-controlled in production."""
        self.slots.pop(key, None)

    def get(self, key: str) -> Optional[str]:
        return self.slots.get(key)

    def keys(self) -> list[str]:
        return list(self.slots.keys())

    def snapshot(self) -> dict[str, str]:
        """Return a shallow copy. Compaction hook uses this to re-inject."""
        return dict(self.slots)


# Closed list of slot keys the v1 implementation pins by default. The
# compaction hook re-injects these on every compaction event. Extending
# this list is a structural commitment: any new pinned slot must be
# documented in `docs/specs/ai-employee/aie-adapter-register.md` so
# operators understand what survives compaction.

DEFAULT_PINNED_SLOT_KEYS: tuple[str, ...] = (
    "persona.name",
    "reviewer.identity",
    "customer.yaml.signature",
    "sticky_stop.active",
    "trust_ceiling.locked_skills",
)


# ---------------------------------------------------------------------------
# Trust-ceiling enforcer protocol
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EnforcementDecision:
    """Decision the trust-ceiling enforcer returns for one tool call.

    Mirrors `adapter.trust_ceiling.EnforcementDecision` but lives here so
    the protocol is self-contained on the hook surface.
    """

    allowed: bool
    audit_action: str  # "allow" | "draft" | "refuse"
    reason: str


class TrustCeilingEnforcer(Protocol):
    """The runtime trust-ceiling enforcement contract.

    `enforce()` is the function the pre-tool hook calls for every tool
    call. The PRD names this entry point `trust_ceiling.enforce(customer,
    skill, action_class, ceiling_level)` - the protocol below makes that
    name a typed contract.

    Implementations:

      * `DefaultTrustCeilingEnforcer` (this module): defers to
        `trust_ceiling_log.log_decision` from PR #953 for the audit
        emission, and wraps `adapter.trust_ceiling.enforce()` for the
        decision. Suitable for the integration we are wiring today.

      * Future fork-side implementations may add per-customer policy
        overrides, ceiling promotion gates, or per-tool fine-grained
        rules. The protocol does not constrain those choices.
    """

    def enforce(
        self,
        *,
        customer: str,
        skill: str,
        action_class: HookActionClass,
        ceiling_level: str,
        current_turn_approval: bool = False,
    ) -> EnforcementDecision: ...


# ---------------------------------------------------------------------------
# Hook type aliases - readability for the registry
# ---------------------------------------------------------------------------


PreToolHook = Callable[[ToolCallContext], Awaitable[None]]
"""Pre-tool hook signature. Raise BlockedToolCall to stop the call."""

PostToolHook = Callable[[ToolCallContext, ToolCallResult], Awaitable[None]]
"""Post-tool hook signature. Audit emission lands here."""

RefusalHook = Callable[[ToolCallContext, BlockedToolCall], Awaitable[None]]
"""Refusal hook signature. Called when pre-hook blocked the call."""

CompactionHook = Callable[[PinnedSlots], Awaitable[None]]
"""Compaction hook signature. Re-injects pinned slots after compaction."""


# ---------------------------------------------------------------------------
# Registry - the object aie_adapter.register() receives from the overlay
# ---------------------------------------------------------------------------


class HookRegistry:
    """Registry of safety-substrate hooks the SMD overlay exposes.

    Constructed by the overlay layer at Machine boot. Passed to
    `aie_adapter.register()`, which installs the four hooks.

    Each slot accepts exactly one hook (the safety substrate is the only
    consumer; future expansion can lift this to a list if multi-consumer
    semantics are needed). Re-registering a slot raises - accidental
    re-registration is a bug, not a no-op.

    `dispatch_*` methods are the overlay's view of the registry: the
    overlay's tool-dispatch loop calls them on the call path. The fake
    runtime in tests uses the same methods so the test wiring matches
    production semantics.
    """

    def __init__(self) -> None:
        self._pre_tool: Optional[PreToolHook] = None
        self._post_tool: Optional[PostToolHook] = None
        self._refusal: Optional[RefusalHook] = None
        self._compaction: Optional[CompactionHook] = None
        self._pinned_slots = PinnedSlots()

    # ---- Registration (adapter side) -------------------------------------

    def register_pre_tool(self, hook: PreToolHook) -> None:
        if self._pre_tool is not None:
            raise RuntimeError("pre_tool hook already registered")
        self._pre_tool = hook

    def register_post_tool(self, hook: PostToolHook) -> None:
        if self._post_tool is not None:
            raise RuntimeError("post_tool hook already registered")
        self._post_tool = hook

    def register_refusal(self, hook: RefusalHook) -> None:
        if self._refusal is not None:
            raise RuntimeError("refusal hook already registered")
        self._refusal = hook

    def register_compaction(self, hook: CompactionHook) -> None:
        if self._compaction is not None:
            raise RuntimeError("compaction hook already registered")
        self._compaction = hook

    # ---- Pinned slots (compaction-survival store) ------------------------

    @property
    def pinned_slots(self) -> PinnedSlots:
        return self._pinned_slots

    # ---- Dispatch invocations (overlay side) -----------------------------

    async def dispatch_pre_tool(self, context: ToolCallContext) -> None:
        """Invoke pre-tool hook if registered. Re-raises BlockedToolCall."""
        if self._pre_tool is None:
            return
        await self._pre_tool(context)

    async def dispatch_post_tool(
        self,
        context: ToolCallContext,
        result: ToolCallResult,
    ) -> None:
        """Invoke post-tool hook if registered. Never raises."""
        if self._post_tool is None:
            return
        try:
            await self._post_tool(context, result)
        except Exception as e:  # noqa: BLE001 - post-tool failures must not crash dispatch
            log.exception("post_tool hook raised; ignoring: %s", e)

    async def dispatch_refusal(
        self,
        context: ToolCallContext,
        block: BlockedToolCall,
    ) -> None:
        """Invoke refusal hook if registered. Re-raises on audit failure."""
        if self._refusal is None:
            return
        await self._refusal(context, block)

    async def dispatch_compaction(self) -> None:
        """Invoke compaction hook if registered. Re-raises on failure.

        The compaction hook is responsible for re-injecting pinned slots
        into the post-compaction context. The Hermes runtime calls this
        AFTER its own compaction has run and BEFORE the next turn starts.
        If this hook fails, the runtime must NOT proceed - a context
        without pinned slots is a substrate-violating context.
        """
        if self._compaction is None:
            return
        await self._compaction(self._pinned_slots)


# ---------------------------------------------------------------------------
# Default trust-ceiling enforcer - wraps adapter.trust_ceiling.enforce()
# ---------------------------------------------------------------------------


class DefaultTrustCeilingEnforcer:
    """Thin wrapper around `adapter.trust_ceiling.enforce()` (PR #812).

    The PRD names a `trust_ceiling.enforce(customer, skill, action_class,
    ceiling_level)` entry point that does not yet exist as a free
    function. The existing `adapter/trust_ceiling.py::enforce()` takes a
    similar shape but keys on `Ceiling` and `ActionClass` enums and does
    NOT take a customer parameter (the per-customer scope is implicit at
    Machine level per ADR 0007).

    This class bridges the two: it accepts the PRD-shape arguments,
    translates to the adapter-side enforce(), and returns a hook-side
    decision. The customer parameter is preserved so the overlay can
    cross-check (defense in depth against accidental multi-customer
    invocation, even though the Machine-level isolation already prevents
    it per ADR 0009).

    A future fork-side implementation can subclass or replace this with
    per-customer policy overrides without changing the hook contract.
    """

    def __init__(self) -> None:
        # Lazy-import to avoid pulling adapter internals into the hook
        # surface at module import time. The hook surface must be
        # importable by the overlay side without dragging the adapter's
        # full dependency surface (pyyaml, etc.).
        from adapter.trust_ceiling import (  # noqa: PLC0415
            ActionClass as _AdapterActionClass,
            Ceiling as _AdapterCeiling,
            enforce as _adapter_enforce,
        )

        self._AdapterActionClass = _AdapterActionClass
        self._AdapterCeiling = _AdapterCeiling
        self._adapter_enforce = _adapter_enforce

    def enforce(
        self,
        *,
        customer: str,
        skill: str,
        action_class: HookActionClass,
        ceiling_level: str,
        current_turn_approval: bool = False,
    ) -> EnforcementDecision:
        if not customer:
            raise ValueError("customer is required (defense-in-depth check)")
        if not skill:
            raise ValueError("skill is required")
        adapter_action = self._AdapterActionClass(action_class.value)
        adapter_ceiling = self._AdapterCeiling(ceiling_level)
        adapter_decision = self._adapter_enforce(
            ceiling=adapter_ceiling,
            action=adapter_action,
            skill_name=skill,
            tool_name="",  # tool name lives at the hook layer, not in the policy decision
            current_turn_approval=current_turn_approval,
        )
        return EnforcementDecision(
            allowed=adapter_decision.allowed,
            audit_action=adapter_decision.audit_action,
            reason=adapter_decision.reason,
        )


# ---------------------------------------------------------------------------
# In-memory Hermes-shaped fake runtime - pytest seam for the integration test
# ---------------------------------------------------------------------------


class FakeHermesRuntime:
    """In-memory stand-in for the Hermes tool-dispatch path.

    Suitable for pytest. Construction takes a `HookRegistry`; `dispatch()`
    drives one synthetic tool call through the same call path the
    production Hermes runtime would: pre-hook, tool, post-hook (or
    pre-hook, refusal, post-hook with outcome=blocked).

    The customer-zero smoke test in `tests/test_aie_adapter.py` instantiates
    one of these against the real registered hooks and verifies the end-to-
    end shape.

    The fake is NOT a Hermes mock - the production fork's dispatch is
    inside the upstream `agent/tool_guardrails.py` plus the SMD overlay
    layer. The fake is a contract-conforming approximation that lets us
    exercise the hook surface in isolation.
    """

    def __init__(self, registry: HookRegistry) -> None:
        self._registry = registry

    async def dispatch(
        self,
        *,
        context: ToolCallContext,
        tool_fn: Optional[Callable[..., Awaitable[Optional[str]]]] = None,
    ) -> ToolCallResult:
        """Drive one synthetic tool call. Returns the final result."""
        # Pre-hook. If it raises BlockedToolCall, route to refusal + post.
        try:
            await self._registry.dispatch_pre_tool(context)
        except BlockedToolCall as block:
            await self._registry.dispatch_refusal(context, block)
            result = ToolCallResult(outcome="blocked")
            await self._registry.dispatch_post_tool(context, result)
            return result

        # Tool execution. If no tool_fn, treat as a no-op success.
        try:
            if tool_fn is not None:
                summary = await tool_fn()
            else:
                summary = None
            result = ToolCallResult(outcome="ok", output_summary=summary)
        except Exception as e:  # noqa: BLE001 - surfacing to the post-hook
            result = ToolCallResult(
                outcome="error",
                error_type=type(e).__name__,
            )

        await self._registry.dispatch_post_tool(context, result)
        return result

    async def compact(self) -> None:
        """Drive a synthetic compaction event. Fires the compaction hook."""
        await self._registry.dispatch_compaction()


__all__ = [
    "DEFAULT_PINNED_SLOT_KEYS",
    "BlockedToolCall",
    "CompactionHook",
    "DefaultTrustCeilingEnforcer",
    "EnforcementDecision",
    "FakeHermesRuntime",
    "HookActionClass",
    "HookRegistry",
    "PinnedSlots",
    "PostToolHook",
    "PreToolHook",
    "RefusalHook",
    "ToolCallContext",
    "ToolCallResult",
    "TrustCeilingEnforcer",
]
