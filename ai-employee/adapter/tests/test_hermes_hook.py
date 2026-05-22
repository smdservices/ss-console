"""Tests for ai-employee/adapter/hermes_hook.py (issue #841).

Covers the typed hook surface that mirrors Hermes' `tool_guardrails.py`
expected interface:

  * HookRegistry registration semantics (one consumer per slot, no
    silent re-registration).
  * BlockedToolCall propagation through the FakeHermesRuntime.dispatch
    path (pre-hook raises -> refusal hook fires -> post-hook sees
    outcome=blocked).
  * Post-tool hook failures do not crash dispatch.
  * Compaction hook fires; pinned slots survive a synthetic compaction.
  * PinnedSlots invariants: pin/unpin, snapshot independence.
  * DefaultTrustCeilingEnforcer translates HookActionClass and
    ceiling_level strings to the adapter's enum types and returns an
    EnforcementDecision shape.

Run from repo root:

    cd ai-employee && python -m pytest adapter/tests/test_hermes_hook.py -v
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # ai-employee/ on sys.path

from adapter.hermes_hook import (  # noqa: E402
    DEFAULT_PINNED_SLOT_KEYS,
    BlockedToolCall,
    DefaultTrustCeilingEnforcer,
    EnforcementDecision,
    FakeHermesRuntime,
    HookActionClass,
    HookRegistry,
    PinnedSlots,
    ToolCallContext,
    ToolCallResult,
)


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _ctx(**overrides) -> ToolCallContext:
    base = {
        "customer": "acme",
        "skill_name": "inbox-triage",
        "tool_name": "Email.create_draft",
        "action_class": HookActionClass.INTERNAL_WRITE,
        "ceiling_level": "autonomous",
        "skill_version": "0.1.0",
        "matter_ref": None,
        "trace_id": "trace-test-0001",
        "current_turn_approval": False,
    }
    base.update(overrides)
    return ToolCallContext(**base)


# ---------------------------------------------------------------------------
# HookRegistry registration semantics
# ---------------------------------------------------------------------------


def test_registry_starts_empty_no_hooks_registered():
    reg = HookRegistry()
    assert reg.pinned_slots.snapshot() == {}
    # All dispatch_* methods are no-ops when no hooks are registered.
    _run(reg.dispatch_pre_tool(_ctx()))
    _run(reg.dispatch_post_tool(_ctx(), ToolCallResult(outcome="ok")))
    _run(reg.dispatch_refusal(_ctx(), BlockedToolCall(reason="x")))
    _run(reg.dispatch_compaction())


def test_registry_rejects_double_registration():
    reg = HookRegistry()

    async def hook(ctx):
        return None

    reg.register_pre_tool(hook)
    with pytest.raises(RuntimeError, match="pre_tool hook already registered"):
        reg.register_pre_tool(hook)


def test_registry_rejects_double_post_tool_registration():
    reg = HookRegistry()

    async def hook(ctx, result):
        return None

    reg.register_post_tool(hook)
    with pytest.raises(RuntimeError, match="post_tool hook already registered"):
        reg.register_post_tool(hook)


# ---------------------------------------------------------------------------
# BlockedToolCall + refusal flow
# ---------------------------------------------------------------------------


def test_blocked_tool_call_routes_to_refusal_and_post_with_outcome_blocked():
    reg = HookRegistry()
    refusal_calls: list[tuple[ToolCallContext, BlockedToolCall]] = []
    post_calls: list[tuple[ToolCallContext, ToolCallResult]] = []

    async def pre(ctx):
        raise BlockedToolCall(reason="commitment_no_approval", context=ctx)

    async def refusal(ctx, block):
        refusal_calls.append((ctx, block))

    async def post(ctx, result):
        post_calls.append((ctx, result))

    reg.register_pre_tool(pre)
    reg.register_refusal(refusal)
    reg.register_post_tool(post)

    runtime = FakeHermesRuntime(reg)
    tool_invocations = 0

    async def tool_fn():
        nonlocal tool_invocations
        tool_invocations += 1
        return "should not be called"

    result = _run(runtime.dispatch(context=_ctx(), tool_fn=tool_fn))
    assert tool_invocations == 0  # tool MUST NOT run when pre blocks
    assert result.outcome == "blocked"
    assert len(refusal_calls) == 1
    assert refusal_calls[0][1].reason == "commitment_no_approval"
    assert len(post_calls) == 1
    assert post_calls[0][1].outcome == "blocked"


def test_allowed_tool_call_runs_and_post_sees_ok():
    reg = HookRegistry()
    pre_calls = []
    post_calls = []

    async def pre(ctx):
        pre_calls.append(ctx)

    async def post(ctx, result):
        post_calls.append((ctx, result))

    reg.register_pre_tool(pre)
    reg.register_post_tool(post)

    runtime = FakeHermesRuntime(reg)

    async def tool_fn():
        return "delivered"

    result = _run(runtime.dispatch(context=_ctx(), tool_fn=tool_fn))
    assert result.outcome == "ok"
    assert result.output_summary == "delivered"
    assert len(pre_calls) == 1
    assert len(post_calls) == 1
    assert post_calls[0][1].outcome == "ok"


def test_tool_exception_routes_to_post_with_outcome_error():
    reg = HookRegistry()
    post_calls = []

    async def post(ctx, result):
        post_calls.append(result)

    reg.register_post_tool(post)

    runtime = FakeHermesRuntime(reg)

    async def tool_fn():
        raise RuntimeError("vendor down")

    result = _run(runtime.dispatch(context=_ctx(), tool_fn=tool_fn))
    assert result.outcome == "error"
    assert result.error_type == "RuntimeError"
    assert len(post_calls) == 1
    assert post_calls[0].outcome == "error"


def test_post_tool_hook_exception_does_not_crash_dispatch():
    reg = HookRegistry()

    async def post(ctx, result):
        raise RuntimeError("audit write blew up")

    reg.register_post_tool(post)
    runtime = FakeHermesRuntime(reg)
    # Should not raise even though the hook does.
    result = _run(runtime.dispatch(context=_ctx()))
    assert result.outcome == "ok"


# ---------------------------------------------------------------------------
# Compaction hook + pinned slots
# ---------------------------------------------------------------------------


def test_compaction_hook_receives_current_pinned_slots():
    reg = HookRegistry()
    reg.pinned_slots.pin("persona.name", "Marcus")
    reg.pinned_slots.pin("reviewer.identity", "captain-scott")

    captured: list[dict[str, str]] = []

    async def compact_hook(slots):
        captured.append(slots.snapshot())

    reg.register_compaction(compact_hook)

    runtime = FakeHermesRuntime(reg)
    _run(runtime.compact())

    assert len(captured) == 1
    snapshot = captured[0]
    assert snapshot["persona.name"] == "Marcus"
    assert snapshot["reviewer.identity"] == "captain-scott"


def test_pinned_slots_survive_simulated_compaction():
    """Pinned slots are NOT cleared by the compaction hook firing.

    Invariant #4: the pinned-slot table is a separate data structure
    from the compressible turn history. Compaction does not touch it.
    """
    reg = HookRegistry()
    reg.pinned_slots.pin("sticky_stop.active", "true")

    async def compact_hook(slots):
        # The hook is allowed to READ the slot table; it must not clear
        # the substrate copy.
        snapshot = slots.snapshot()
        assert snapshot["sticky_stop.active"] == "true"

    reg.register_compaction(compact_hook)
    runtime = FakeHermesRuntime(reg)

    _run(runtime.compact())
    _run(runtime.compact())  # second compaction; slot still present

    assert reg.pinned_slots.get("sticky_stop.active") == "true"


def test_pinned_slots_pin_unpin_get():
    slots = PinnedSlots()
    assert slots.get("k") is None
    slots.pin("k", "v1")
    assert slots.get("k") == "v1"
    slots.pin("k", "v2")  # idempotent overwrite
    assert slots.get("k") == "v2"
    assert slots.keys() == ["k"]
    slots.unpin("k")
    assert slots.get("k") is None


def test_pinned_slots_reject_empty_key_and_none_value():
    slots = PinnedSlots()
    with pytest.raises(ValueError, match="key is required"):
        slots.pin("", "v")
    with pytest.raises(ValueError, match="value is required"):
        slots.pin("k", None)  # type: ignore[arg-type]


def test_pinned_slots_snapshot_is_independent_copy():
    slots = PinnedSlots()
    slots.pin("k", "v")
    snapshot = slots.snapshot()
    snapshot["k"] = "mutated"
    assert slots.get("k") == "v"


def test_default_pinned_slot_keys_includes_invariant_4_essentials():
    # Documents the closed v1 set. Adding to this list is a structural
    # commitment that must be reflected in the spec doc.
    assert "persona.name" in DEFAULT_PINNED_SLOT_KEYS
    assert "reviewer.identity" in DEFAULT_PINNED_SLOT_KEYS
    assert "sticky_stop.active" in DEFAULT_PINNED_SLOT_KEYS


# ---------------------------------------------------------------------------
# DefaultTrustCeilingEnforcer translation layer
# ---------------------------------------------------------------------------


def test_default_enforcer_allows_read_action_at_any_ceiling():
    enforcer = DefaultTrustCeilingEnforcer()
    decision = enforcer.enforce(
        customer="acme",
        skill="inbox-triage",
        action_class=HookActionClass.READ,
        ceiling_level="draft_for_review",
    )
    assert decision.allowed is True
    assert decision.audit_action == "allow"


def test_default_enforcer_refuses_destructive_at_draft_ceiling():
    enforcer = DefaultTrustCeilingEnforcer()
    decision = enforcer.enforce(
        customer="acme",
        skill="inbox-triage",
        action_class=HookActionClass.DESTRUCTIVE,
        ceiling_level="draft_for_review",
    )
    assert decision.allowed is False
    assert decision.audit_action == "refuse"
    assert "draft_for_review" in decision.reason


def test_default_enforcer_refuses_commitment_without_approval():
    enforcer = DefaultTrustCeilingEnforcer()
    decision = enforcer.enforce(
        customer="acme",
        skill="settlement-negotiation",
        action_class=HookActionClass.COMMITMENT,
        ceiling_level="autonomous",
        current_turn_approval=False,
    )
    assert decision.allowed is False
    assert "commitment" in decision.reason


def test_default_enforcer_allows_commitment_with_approval():
    enforcer = DefaultTrustCeilingEnforcer()
    decision = enforcer.enforce(
        customer="acme",
        skill="settlement-negotiation",
        action_class=HookActionClass.COMMITMENT,
        ceiling_level="autonomous",
        current_turn_approval=True,
    )
    assert decision.allowed is True


def test_default_enforcer_rejects_empty_customer():
    enforcer = DefaultTrustCeilingEnforcer()
    with pytest.raises(ValueError, match="customer is required"):
        enforcer.enforce(
            customer="",
            skill="inbox-triage",
            action_class=HookActionClass.READ,
            ceiling_level="autonomous",
        )


def test_default_enforcer_rejects_empty_skill():
    enforcer = DefaultTrustCeilingEnforcer()
    with pytest.raises(ValueError, match="skill is required"):
        enforcer.enforce(
            customer="acme",
            skill="",
            action_class=HookActionClass.READ,
            ceiling_level="autonomous",
        )


def test_default_enforcer_rejects_invalid_ceiling_level():
    enforcer = DefaultTrustCeilingEnforcer()
    with pytest.raises(ValueError):
        enforcer.enforce(
            customer="acme",
            skill="inbox-triage",
            action_class=HookActionClass.READ,
            ceiling_level="not_a_real_ceiling",
        )


# ---------------------------------------------------------------------------
# HookActionClass value parity with adapter.trust_ceiling.ActionClass
# ---------------------------------------------------------------------------


def test_hook_action_class_round_trips_through_adapter_enum():
    from adapter.trust_ceiling import ActionClass  # noqa: PLC0415

    for hook_value in HookActionClass:
        adapter_value = ActionClass(hook_value.value)
        # Round-trip: hook -> string -> adapter -> string -> hook
        assert HookActionClass(adapter_value.value) is hook_value


# ---------------------------------------------------------------------------
# EnforcementDecision dataclass shape
# ---------------------------------------------------------------------------


def test_enforcement_decision_is_immutable():
    decision = EnforcementDecision(allowed=True, audit_action="allow", reason="r")
    with pytest.raises(Exception):
        decision.allowed = False  # type: ignore[misc]
