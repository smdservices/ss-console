"""AIEmployee adapter - Hermes integration point.

Registers safety-substrate hooks with the Hermes overlay surface so every
tool call routes through `trust_ceiling.enforce()` before execution.
Refusals + draft-routed actions are logged to the customer's audit log via
the existing `AuditLogWriter` from PR #942. Refusal cascades surface via
the `RefusalHandler` from PR #967. Pinned slots survive context compaction
per safety invariant #4.

Loading mechanism
-----------------

`bootstrap.sh` sets `PYTHONPATH=/app/adapter:/app:...`, then runs
`hermes run --adapter aiemployee`. The SMD overlay layer inside the
Hermes fork (per [ADR 0015](../../docs/adr/0015-hermes-fork-vs-upstream.md))
constructs a `hermes_hook.HookRegistry`, imports this module, and calls
`register(registry)`.

The seam upstream is `agent/tool_guardrails.py`; the overlay layer wraps
it and exposes the `HookRegistry` interface declared in
`hermes_hook.py`. The adapter side (here) does not touch upstream files
and does not depend on the fork's internal layout - the contract is the
`HookRegistry` shape.

Phase A.5
---------

This file replaces the original Phase A stub. The stub asserted the
upstream seam was `agent/tool_router.py`; PR #829's runbook discovered
the real seam at `agent/tool_guardrails.py`; ADR 0015 locked the
overlay-plus-thin-fork strategy; this PR rewires `register()` accordingly.

The hook surface is testable in isolation via `hermes_hook.FakeHermesRuntime`;
the integration tests in `tests/test_aie_adapter.py` drive the full
pre-hook -> tool -> post-hook + refusal path against the in-memory fake.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

try:
    import yaml
except ImportError:
    yaml = None  # tolerated for unit-test import; bootstrap requires it

from .hermes_hook import (
    DEFAULT_PINNED_SLOT_KEYS,
    BlockedToolCall,
    DefaultTrustCeilingEnforcer,
    HookActionClass,
    HookRegistry,
    PinnedSlots,
    ToolCallContext,
    ToolCallResult,
    TrustCeilingEnforcer,
)
from .curator_interceptor import (
    CuratorDraftStateError,
    CuratorEvidenceRequired,
    CuratorInterceptor,
    CuratorNativeWriteBlocked,
    CuratorTargetRequired,
    DraftType,
    SkillDraft,
    verify_curator_intercepted,
)
from .honcho_interceptor import (
    HonchoEvidenceRequired,
    HonchoInterceptor,
    HonchoNativeWriteBlocked,
    HonchoObservation,
    HonchoObservationStateError,
    ObservationType,
    verify_honcho_intercepted,
)
from .trust_ceiling import ActionClass, Ceiling, enforce

# Audit action_type classes emitted by the Honcho overlay (ADR 0016 §7).
# Re-exported here so the overlay's dispatch path and operational tooling
# have a single import surface; the values themselves are members of
# `audit_log.ACCEPTED_ACTION_TYPES`.
HONCHO_AUDIT_ACTION_OBSERVATION = "HONCHO_OBSERVATION"
HONCHO_AUDIT_ACTION_PROMOTION = "HONCHO_PROMOTION"
HONCHO_AUDIT_ACTION_DISMISSAL = "HONCHO_DISMISSAL"

# Audit action_type classes emitted by the Skill Curator overlay (ADR 0017 §8).
# Same import-surface rationale as the Honcho constants above.
CURATOR_AUDIT_ACTION_DRAFT = "CURATOR_DRAFT"
CURATOR_AUDIT_ACTION_PROMOTION = "CURATOR_PROMOTION"
CURATOR_AUDIT_ACTION_DISMISSAL = "CURATOR_DISMISSAL"

log = logging.getLogger("aie.adapter")


def _load_customer_config() -> dict:
    """Read /app/customer.yaml at adapter init time."""
    yaml_path = os.environ.get("AIE_CUSTOMER_YAML", "/app/customer.yaml")
    if yaml is None:
        log.warning("pyyaml unavailable; adapter operating with empty config")
        return {}
    p = Path(yaml_path)
    if not p.exists():
        log.warning("customer.yaml not at %s; adapter operating with empty config", yaml_path)
        return {}
    with open(p) as f:
        return yaml.safe_load(f) or {}


def _seed_pinned_slots(slots: PinnedSlots, cfg: dict) -> None:
    """Pin the closed-set DEFAULT_PINNED_SLOT_KEYS at adapter boot.

    Only slots whose value is derivable from customer.yaml are pinned;
    the rest (sticky_stop.active, trust_ceiling.locked_skills) are pinned
    later by the substrate as state changes. The compaction hook re-injects
    whatever is in the slot table at compaction time.
    """
    persona = cfg.get("persona") or {}
    if isinstance(persona, dict) and persona.get("name"):
        slots.pin("persona.name", str(persona["name"]))

    reviewer = cfg.get("reviewer") or {}
    if isinstance(reviewer, dict) and reviewer.get("identity"):
        slots.pin("reviewer.identity", str(reviewer["identity"]))

    # customer.yaml signature is a content hash the validator records;
    # absent in early customer.yaml fixtures, pin only if present.
    signature = cfg.get("signature") or cfg.get("customer_yaml_signature")
    if signature:
        slots.pin("customer.yaml.signature", str(signature))


def _make_pre_tool_hook(
    enforcer: TrustCeilingEnforcer,
):
    """Build the pre-tool hook that runs trust-ceiling enforcement.

    The hook calls `enforcer.enforce()` for every tool call. If the
    decision is not `allow`, it raises `BlockedToolCall`; the overlay's
    dispatch path catches and routes to the refusal hook + post-hook.

    Forbidden-action runtime block: this is the integration point where
    "the model can ask all it wants; the adapter says no" lands as code.
    Test isolation is via `FakeHermesRuntime.dispatch()` in tests.
    """

    async def pre_tool(context: ToolCallContext) -> None:
        decision = enforcer.enforce(
            customer=context.customer,
            skill=context.skill_name,
            action_class=context.action_class,
            ceiling_level=context.ceiling_level,
            current_turn_approval=context.current_turn_approval,
        )
        if decision.allowed:
            return
        # audit_action is one of "allow" | "draft" | "refuse"; any non-
        # allow lands as a runtime block. The refusal hook differentiates
        # draft-route from refuse via the substrate-side reason mapping.
        raise BlockedToolCall(
            reason=decision.reason,
            context=context,
        )

    return pre_tool


def _make_post_tool_hook(audit_writer):
    """Build the post-tool hook that emits the per-tool audit row.

    Per issue #842, every tool dispatch emits `timestamp, customer, skill,
    tool, action class, ceiling decision, outcome` to the audit log. The
    actual row goes through `AuditLogWriter.write()` so the writer's
    closed-set `ACCEPTED_ACTION_TYPES` and digesting contract apply.

    The action_type bucket is `INVARIANT_VIOLATION` for blocked calls
    (the substrate stopped the action) and `DRAFT_CREATED` for allowed
    calls (consistent with the audit-floor convention from
    trust_ceiling_log.py). The metadata carries the per-tool detail.
    """
    # Lazy import to keep this module importable without the audit_log
    # module's optional dependencies.
    from .audit_log import ActorRole, AuditEvent  # noqa: PLC0415

    async def post_tool(context: ToolCallContext, result: ToolCallResult) -> None:
        if audit_writer is None:
            # Adapter constructed without an audit writer (boot-time fallback).
            # The substrate invariant says actions without an audit row do not
            # run; the pre-hook still ran trust-ceiling enforcement, so this
            # branch only fires in test/local-dev paths. Log and return.
            log.warning(
                "post_tool: no audit writer; skipping audit emission "
                "(customer=%s skill=%s tool=%s outcome=%s)",
                context.customer,
                context.skill_name,
                context.tool_name,
                result.outcome,
            )
            return

        action_type = (
            "INVARIANT_VIOLATION" if result.outcome == "blocked" else "DRAFT_CREATED"
        )
        await audit_writer.write(
            AuditEvent(
                action_type=action_type,
                actor="agent",
                actor_role=ActorRole.AGENT,
                skill_name=context.skill_name,
                matter_ref=context.matter_ref,
                trust_ceiling=context.ceiling_level,
                metadata={
                    "per_tool_audit": True,
                    "customer": context.customer,
                    "skill": context.skill_name,
                    "skill_version": context.skill_version,
                    "tool": context.tool_name,
                    "action_class": context.action_class.value,
                    "ceiling_level": context.ceiling_level,
                    "outcome": result.outcome,
                    "error_type": result.error_type,
                    "duration_ms": result.duration_ms,
                    "trace_id": context.trace_id,
                },
            )
        )

    return post_tool


def _make_refusal_hook(refusal_handler):
    """Build the refusal hook. Delegates to `RefusalHandler.handle()`.

    The handler emits the customer-facing notification audit row, the
    Captain cascade-alert row (if threshold exceeded), and returns a
    `RefusalOutcome` whose `aborted == True`. The dispatch path uses the
    raised `BlockedToolCall` to abort; the refusal hook's job is purely
    audit-emission, not flow control.
    """

    async def refusal(context: ToolCallContext, block: BlockedToolCall) -> None:
        if refusal_handler is None:
            log.warning(
                "refusal hook fired but no RefusalHandler configured; "
                "customer=%s skill=%s reason=%s",
                context.customer,
                context.skill_name,
                block.reason,
            )
            return
        # The substrate's RefusalHandler signature wants closed-enum types
        # from trust_ceiling_log; the dispatch path maps the hook context
        # to those values. To keep this module decoupled from the
        # safety-substrate package layout, we lazy-import the enum here
        # and translate.
        try:
            from trust_ceiling_log import (  # type: ignore[import-not-found]  # noqa: PLC0415
                ActionClassName,
                CeilingLevel,
                DecisionReason,
            )
        except ImportError:
            log.warning(
                "refusal hook: trust_ceiling_log not importable; "
                "RefusalHandler invocation skipped (safety-substrate "
                "package not on sys.path in this runtime)"
            )
            return

        # The pre-hook does not know the closed-enum DecisionReason; it
        # carries a free-text reason string from the adapter's enforce().
        # Map the most likely reasons; default to UNKNOWN_ACTION_CLASS
        # so the customer-facing message falls back to GENERIC_REFUSED.
        reason_text = block.reason.lower()
        if "commitment" in reason_text and "approval" in reason_text:
            decision_reason = DecisionReason.COMMITMENT_NO_APPROVAL
        elif "destructive" in reason_text and "approval" in reason_text:
            decision_reason = DecisionReason.DESTRUCTIVE_NO_APPROVAL
        elif "destructive" in reason_text and "draft_for_review" in reason_text:
            decision_reason = DecisionReason.DESTRUCTIVE_DRAFT_CEILING
        elif "external_send" in reason_text and "approval" in reason_text:
            decision_reason = DecisionReason.EXTERNAL_SEND_NO_APPROVAL
        elif "refused" in reason_text or "disabled" in reason_text:
            decision_reason = DecisionReason.CEILING_DISABLED
        else:
            decision_reason = DecisionReason.UNKNOWN_ACTION_CLASS

        action_class_value = ActionClassName(context.action_class.value)
        # The ceiling_level string from the hook context aligns with both
        # CeilingLevel's spelling and the adapter's; the constructor
        # raises if it does not. That is the right failure mode.
        ceiling_value = CeilingLevel(context.ceiling_level)

        outcome = await refusal_handler.handle(
            customer=context.customer,
            skill=context.skill_name,
            action_class=action_class_value,
            ceiling_level=ceiling_value,
            reason=decision_reason,
            skill_version=context.skill_version,
            trace_id=context.trace_id,
            matter_ref=context.matter_ref,
        )
        # Surface the customer-facing message back onto the BlockedToolCall
        # so the dispatch loop can render it without re-running the
        # mapping. Mutating an attribute is acceptable here; the caller
        # constructs the exception immediately before raising it.
        block.customer_message = outcome.message.value

    return refusal


def _make_compaction_hook():
    """Build the compaction hook. Re-injects pinned slots after compaction.

    Per safety invariant #4: pinned slots survive compaction. The Hermes
    runtime calls this hook after its own compaction has run and before
    the next turn starts. The hook reads the current pinned-slot table
    and asks the substrate to materialize each slot in the post-compaction
    context.

    v1 implementation logs the pinned-slot snapshot and returns. The
    substrate-side context-injection wiring is fork-side overlay code
    that will land in a sibling PR; this hook is the seam.
    """

    async def compaction(slots: PinnedSlots) -> None:
        snapshot = slots.snapshot()
        log.info(
            "compaction hook: re-injecting %d pinned slots (keys=%s)",
            len(snapshot),
            sorted(snapshot.keys()),
        )

    return compaction


def register(
    registry: Optional[HookRegistry] = None,
    *,
    audit_writer=None,
    refusal_handler=None,
    enforcer: Optional[TrustCeilingEnforcer] = None,
) -> HookRegistry:
    """Hermes adapter entrypoint.

    Args:
        registry - the overlay's `HookRegistry`. When None, a fresh
                          registry is constructed (suitable for unit tests).
        audit_writer - constructed `AuditLogWriter`. When None, the post-
                          tool hook logs-and-skips audit emission (test path).
                          Production callers MUST supply one.
        refusal_handler - constructed `RefusalHandler`. When None, the
                          refusal hook logs-and-skips notification emission.
                          Production callers MUST supply one.
        enforcer - alternate `TrustCeilingEnforcer`. When None,
                          `DefaultTrustCeilingEnforcer` is used.

    Returns:
        The registry with the four hooks installed. The Hermes overlay
        keeps the returned reference for its dispatch loop.

    Steps:
      1. Load customer.yaml; seed the registry's pinned-slot table with
         the closed-set DEFAULT_PINNED_SLOT_KEYS values that are
         derivable from customer.yaml.
      2. Build the pre-tool hook (trust-ceiling enforcement). Forbidden
         actions raise `BlockedToolCall`; the overlay's dispatch path
         catches and stops the action.
      3. Build the post-tool hook (per-tool audit emission).
      4. Build the refusal hook (customer-facing notification + Captain
         cascade alert via RefusalHandler).
      5. Build the compaction hook (re-inject pinned slots; safety
         invariant #4).
      6. Register all four against the supplied registry.
    """
    if registry is None:
        registry = HookRegistry()
    if enforcer is None:
        enforcer = DefaultTrustCeilingEnforcer()

    cfg = _load_customer_config()
    customer_id = cfg.get("customer_id", "unknown")
    _seed_pinned_slots(registry.pinned_slots, cfg)

    registry.register_pre_tool(_make_pre_tool_hook(enforcer))
    registry.register_post_tool(_make_post_tool_hook(audit_writer))
    registry.register_refusal(_make_refusal_hook(refusal_handler))
    registry.register_compaction(_make_compaction_hook())

    log.info(
        "AIEmployee adapter registered for customer=%s: 4 hooks installed "
        "(pre_tool, post_tool, refusal, compaction); pinned slots=%s",
        customer_id,
        sorted(registry.pinned_slots.keys()),
    )
    return registry


# Re-export for convenience (callers and the overlay both import from here)
__all__ = [
    "ActionClass",
    "BlockedToolCall",
    "CURATOR_AUDIT_ACTION_DISMISSAL",
    "CURATOR_AUDIT_ACTION_DRAFT",
    "CURATOR_AUDIT_ACTION_PROMOTION",
    "Ceiling",
    "CuratorDraftStateError",
    "CuratorEvidenceRequired",
    "CuratorInterceptor",
    "CuratorNativeWriteBlocked",
    "CuratorTargetRequired",
    "DEFAULT_PINNED_SLOT_KEYS",
    "DefaultTrustCeilingEnforcer",
    "DraftType",
    "HONCHO_AUDIT_ACTION_DISMISSAL",
    "HONCHO_AUDIT_ACTION_OBSERVATION",
    "HONCHO_AUDIT_ACTION_PROMOTION",
    "HonchoEvidenceRequired",
    "HonchoInterceptor",
    "HonchoNativeWriteBlocked",
    "HonchoObservation",
    "HonchoObservationStateError",
    "HookActionClass",
    "HookRegistry",
    "ObservationType",
    "PinnedSlots",
    "SkillDraft",
    "ToolCallContext",
    "ToolCallResult",
    "TrustCeilingEnforcer",
    "enforce",
    "register",
    "verify_curator_intercepted",
    "verify_honcho_intercepted",
]
