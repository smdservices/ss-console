"""Per-tool audit emission points (issue #842).

Thickens the post-tool audit emission landed by PR [#981] (aie_adapter
register + hermes_hook surface) with three things the Hermes overlay needs
on the dispatch path:

  1. A closed-vocabulary registry mapping every known tool name to its
     `HookActionClass`. The trust-ceiling enforcer keys on action class,
     so the registry IS the routing table that decides whether a tool
     call gets `READ`-treatment, `INTERNAL_WRITE`-treatment, etc.
  2. A closed BANNED-tools set. Any tool name in BANNED raises
     `BannedToolError` from `classify_tool()`; it never reaches the
     trust-ceiling enforcer at all. Pattern-A capabilities (per
     [ADR 0005](../../docs/adr/0005-reviewer-as-sender.md) +
     [capability-contracts.md](../../docs/specs/ai-employee/capability-contracts.md))
     forbid autonomous send / autonomous money-movement; those tool
     names live in BANNED so the substrate cannot route them even if a
     misconfigured registry tried to.
  3. Helpers that produce a `ToolCallResult` with `metadata.duration_ms`
     measured by a per-call timer (`ToolCallTimer`), and emit the
     `per_tool_audit=true` row through the existing `AuditLogWriter`
     with scope-aware metadata (matter_id / customer_segment lifted from
     `ToolCallContext.arguments`).

The module is intentionally pure: it does NOT touch `audit_log.py`,
`aie_adapter.py`, or `hermes_hook.py` (on main from #981). The hook layer
imports from here; this module never reaches into the hook layer's
internals. That keeps the v1 contract from #981 stable while giving the
overlay's dispatch path everything it needs to thicken per-tool emission.

No autonomous send
------------------

Nothing in this module originates an outbound action. It classifies,
times, formats audit metadata, and writes one row through the existing
writer. The BANNED set is the hard guarantee that no autonomous-send
tool name can be routed through this surface.

Compaction interaction
----------------------

Per `hermes_hook.py`'s compaction hook from #981, transient per-call
state (timers, registry lookups, scope metadata) must NOT live in
context that compaction can compress. Everything in this module is
either constructed from a `ToolCallContext` (the explicit shape the
overlay passes in) or returned to the caller; no module-level mutable
state, no hidden per-customer caches.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping, Optional

from .hermes_hook import HookActionClass, ToolCallContext, ToolCallResult

log = logging.getLogger("aie.audit_emit_points")


# ---------------------------------------------------------------------------
# Banned tools - Pattern A / Pattern B forbidden capabilities
#
# Source of truth: capability-contracts.md and ADR 0005. Email send is the
# canonical Pattern-A forbidden capability (autonomous outbound from the
# agent identity); money-movement tools are the canonical destructive
# never-autonomous capabilities.
#
# A tool name in this set NEVER reaches trust-ceiling enforcement. The
# `classify_tool()` helper raises `BannedToolError` immediately; the
# overlay's dispatch path is expected to translate that into a refusal
# audit row + customer-facing notification via the existing refusal hook.
# ---------------------------------------------------------------------------


BANNED_TOOLS: frozenset[str] = frozenset(
    {
        # Pattern A - autonomous outbound from the agent identity. ADR 0005
        # locks reviewer-as-sender; the agent NEVER sends from its own
        # identity. The draft-creation path is allowed (DRAFT_CREATE);
        # the send path is permanently banned at this layer.
        "email_send",
        "email_send_message",
        "email_reply",
        "email_reply_all",
        "email_forward",
        # SMS / messaging - same rationale as email_send. Pattern A.
        "sms_send",
        "sms_send_message",
        # Money movement - never autonomous. The substrate offers no
        # destructive ceiling that admits these.
        "payments_initiate_transfer",
        "payments_send_payment",
        "payments_refund",
        "payments_authorize_charge",
        "payments_void_authorization",
        # Calendar / matter destructive - irreversible state changes.
        "calendar_delete_event",
        "practice_management_delete_matter",
        "practice_management_close_matter_permanent",
        # Connector-level destructive operations.
        "connector_revoke_oauth",
        "connector_unbind_permanent",
    }
)


# ---------------------------------------------------------------------------
# Tool-name -> action_class registry
#
# Keys: every tool name the v1 capability surface exposes (read /
# internal-write / destructive). Email send + money movement are
# DELIBERATELY ABSENT from this map and present in BANNED_TOOLS instead -
# adding them here is a P0 doctrine violation. The presence of a tool
# name in this registry is the only mechanism by which a tool gets a
# non-default action class.
#
# Naming convention: snake_case, capability-prefixed (email_, sms_,
# calendar_, practice_management_, payments_, connector_, memory_,
# voice_). Matches the capability-contracts.md vocabulary.
#
# Unknown tools: default to READ via classify_tool() and tag
# metadata.unmapped_tool=true. The audit-review surface can filter on
# that flag to catch tools added without registry updates.
# ---------------------------------------------------------------------------


_RAW_TOOL_ACTION_CLASS_MAP: dict[str, HookActionClass] = {
    # ------------------------------------------------------------------
    # Email - read-only + draft-creation only. SEND is BANNED.
    # ------------------------------------------------------------------
    "email_list_messages": HookActionClass.READ,
    "email_get_message": HookActionClass.READ,
    "email_search": HookActionClass.READ,
    "email_get_thread": HookActionClass.READ,
    "email_list_labels": HookActionClass.READ,
    "email_create_draft": HookActionClass.INTERNAL_WRITE,
    "email_update_draft": HookActionClass.INTERNAL_WRITE,
    "email_delete_draft": HookActionClass.INTERNAL_WRITE,
    # ------------------------------------------------------------------
    # SMS - read-only + draft-creation only. SEND is BANNED.
    # ------------------------------------------------------------------
    "sms_list_messages": HookActionClass.READ,
    "sms_get_message": HookActionClass.READ,
    "sms_create_draft": HookActionClass.INTERNAL_WRITE,
    # ------------------------------------------------------------------
    # Calendar - read + non-destructive scheduling state changes.
    # delete_event is destructive and lives in BANNED.
    # ------------------------------------------------------------------
    "calendar_list_events": HookActionClass.READ,
    "calendar_get_event": HookActionClass.READ,
    "calendar_search_events": HookActionClass.READ,
    "calendar_check_availability": HookActionClass.READ,
    "calendar_create_event_draft": HookActionClass.INTERNAL_WRITE,
    "calendar_propose_time": HookActionClass.COMMITMENT,
    "calendar_respond_invitation_draft": HookActionClass.INTERNAL_WRITE,
    # ------------------------------------------------------------------
    # Practice management - read + non-destructive matter updates.
    # delete_matter + close_matter_permanent are in BANNED.
    # ------------------------------------------------------------------
    "practice_management_search_matters": HookActionClass.READ,
    "practice_management_get_matter": HookActionClass.READ,
    "practice_management_list_documents": HookActionClass.READ,
    "practice_management_get_document": HookActionClass.READ,
    "practice_management_list_tasks": HookActionClass.READ,
    "practice_management_create_note": HookActionClass.INTERNAL_WRITE,
    "practice_management_create_task_draft": HookActionClass.INTERNAL_WRITE,
    "practice_management_update_matter_field": HookActionClass.INTERNAL_WRITE,
    "practice_management_open_matter_draft": HookActionClass.COMMITMENT,
    # ------------------------------------------------------------------
    # Memory - the substrate's own knowledge store. Read-only via this
    # registry. The memory-rule write paths are administrative, not
    # tool-call paths, and go through a different audit surface.
    # ------------------------------------------------------------------
    "memory_search": HookActionClass.READ,
    "memory_get_rule": HookActionClass.READ,
    "memory_list_rules": HookActionClass.READ,
    # ------------------------------------------------------------------
    # Voice gate - read-only against the voice corpus.
    # ------------------------------------------------------------------
    "voice_score_draft": HookActionClass.READ,
    "voice_list_judge_history": HookActionClass.READ,
    # ------------------------------------------------------------------
    # Connector lifecycle - read-only here. Binding / unbinding go
    # through administrative flows (not tool calls); unbind_permanent
    # is in BANNED as a defense-in-depth marker.
    # ------------------------------------------------------------------
    "connector_get_status": HookActionClass.READ,
    "connector_list_bindings": HookActionClass.READ,
}


# Public read-only view. Callers must not mutate the registry at runtime;
# changes ship as a PR + test + spec update. MappingProxyType raises
# TypeError on any mutation attempt, making the constraint enforceable
# rather than aspirational.
TOOL_ACTION_CLASS_MAP: Mapping[str, HookActionClass] = MappingProxyType(
    _RAW_TOOL_ACTION_CLASS_MAP
)


# ---------------------------------------------------------------------------
# Banned tool error - raised by classify_tool() for any BANNED tool name
# ---------------------------------------------------------------------------


class BannedToolError(Exception):
    """Raised when a tool name appears in `BANNED_TOOLS`.

    The overlay's dispatch path MUST translate this to a refusal audit
    row + customer-facing notification (via the existing refusal hook),
    and the tool MUST NOT execute. This is an invariant: a banned tool
    name is structurally forbidden from running, regardless of ceiling
    level, current-turn approval, or skill-version pin.

    `tool_name` carries the offending name for audit metadata.
    `reason` is a closed string ("banned_tool_pattern_a" for autonomous
    send, "banned_tool_destructive" for irreversible money / data ops).
    """

    def __init__(self, *, tool_name: str, reason: str = "banned_tool") -> None:
        super().__init__(f"tool {tool_name!r} is banned: {reason}")
        self.tool_name = tool_name
        self.reason = reason


# Reason classification for BANNED tool names. The dispatch path uses
# this to render a more specific customer message ("autonomous send is
# disabled" vs "destructive operation is disabled") without needing a
# second lookup.

_BANNED_REASON: dict[str, str] = {
    "email_send": "banned_tool_pattern_a",
    "email_send_message": "banned_tool_pattern_a",
    "email_reply": "banned_tool_pattern_a",
    "email_reply_all": "banned_tool_pattern_a",
    "email_forward": "banned_tool_pattern_a",
    "sms_send": "banned_tool_pattern_a",
    "sms_send_message": "banned_tool_pattern_a",
    "payments_initiate_transfer": "banned_tool_destructive",
    "payments_send_payment": "banned_tool_destructive",
    "payments_refund": "banned_tool_destructive",
    "payments_authorize_charge": "banned_tool_destructive",
    "payments_void_authorization": "banned_tool_destructive",
    "calendar_delete_event": "banned_tool_destructive",
    "practice_management_delete_matter": "banned_tool_destructive",
    "practice_management_close_matter_permanent": "banned_tool_destructive",
    "connector_revoke_oauth": "banned_tool_destructive",
    "connector_unbind_permanent": "banned_tool_destructive",
}


# ---------------------------------------------------------------------------
# Classification helper
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ToolClassification:
    """Outcome of `classify_tool()`.

    `action_class` is the action class the trust-ceiling enforcer should
    use for this tool call. `unmapped` is True if the tool name was not
    in `TOOL_ACTION_CLASS_MAP` (the helper returned the READ default).
    The audit emitter copies `unmapped` into `metadata.unmapped_tool` so
    audit review can catch new tools missing from the registry.
    """

    action_class: HookActionClass
    unmapped: bool


def classify_tool(tool_name: str) -> ToolClassification:
    """Map a tool name to its action class.

    Behavior:
      * If `tool_name` is in `BANNED_TOOLS`, raise `BannedToolError`.
        The overlay catches and translates to a refusal; the tool MUST
        NOT execute.
      * If `tool_name` is in `TOOL_ACTION_CLASS_MAP`, return
        `ToolClassification(action_class=mapped, unmapped=False)`.
      * Otherwise, return `ToolClassification(action_class=READ,
        unmapped=True)` and emit a warning log. The default-to-READ
        choice is the safest fallback: an unmapped tool that turns out
        to be a write or destructive is caught by the enforcer or the
        BANNED check above; defaulting to a higher class would refuse
        legitimate read tools that simply lack registry entries.
    """
    if not tool_name:
        raise ValueError("tool_name is required")

    if tool_name in BANNED_TOOLS:
        reason = _BANNED_REASON.get(tool_name, "banned_tool")
        raise BannedToolError(tool_name=tool_name, reason=reason)

    mapped = _RAW_TOOL_ACTION_CLASS_MAP.get(tool_name)
    if mapped is not None:
        return ToolClassification(action_class=mapped, unmapped=False)

    log.warning(
        "classify_tool: tool_name=%s not in TOOL_ACTION_CLASS_MAP; "
        "defaulting to READ and tagging metadata.unmapped_tool=true",
        tool_name,
    )
    return ToolClassification(action_class=HookActionClass.READ, unmapped=True)


# ---------------------------------------------------------------------------
# Per-tool latency timer
#
# The hermes_hook v1 `ToolCallResult` already carries an optional
# `duration_ms`. Issue #842 promotes this from optional-by-construction
# to measured-by-the-hook. `ToolCallTimer` is the explicit measurement
# surface; the post-tool emitter writes its value into
# metadata.duration_ms.
#
# Why a context-manager-shaped class instead of `time.perf_counter()`
# inline at the call site: every overlay implementation will need the
# same monotonic-clock + ms-precision behavior, and putting it in one
# place keeps the cost-telemetry pipeline (#804) and sticky-stop's
# time-budget condition (#843) consistent. Both consume duration_ms.
# ---------------------------------------------------------------------------


class ToolCallTimer:
    """Monotonic per-tool-call latency timer. Millisecond precision.

    Usage from the overlay's dispatch path:

        timer = ToolCallTimer().start()
        try:
            result = await tool_fn(...)
        finally:
            duration_ms = timer.stop()

    The timer is single-shot. Calling `stop()` twice raises; that catches
    bugs where the overlay accidentally double-reports for the same call.
    """

    __slots__ = ("_started_perf", "_duration_ms")

    def __init__(self) -> None:
        self._started_perf: Optional[float] = None
        self._duration_ms: Optional[float] = None

    def start(self) -> "ToolCallTimer":
        """Begin timing. Returns self so callers can chain."""
        if self._started_perf is not None:
            raise RuntimeError("ToolCallTimer.start called twice on the same timer")
        self._started_perf = time.perf_counter()
        return self

    def stop(self) -> float:
        """Finish timing and return elapsed milliseconds.

        Raises RuntimeError if start() was never called or stop() was
        already called. Returns the float ms value; the caller stores
        it in `metadata.duration_ms`.
        """
        if self._started_perf is None:
            raise RuntimeError("ToolCallTimer.stop called before start")
        if self._duration_ms is not None:
            raise RuntimeError("ToolCallTimer.stop called twice")
        elapsed = (time.perf_counter() - self._started_perf) * 1000.0
        self._duration_ms = elapsed
        return elapsed

    @property
    def duration_ms(self) -> Optional[float]:
        """Read the last-measured duration. None if stop() has not run."""
        return self._duration_ms


# ---------------------------------------------------------------------------
# Scope-aware metadata extraction
#
# The audit row's metadata payload carries opaque identifiers when the
# tool's arguments contain them: `matter_id` (per-vertical matter id,
# law firms) and `customer_segment` (cohort tag for cross-customer
# aggregation). These let the audit-viewer dashboard drill from the
# customer view to the matter view without scanning unrelated rows.
#
# The shape comes from `ToolCallContext.arguments`, which the overlay
# populates with the tool's invocation arguments. Arguments are NOT
# logged verbatim; only the closed-set scope keys are lifted into
# metadata. Other arguments stay in the payload-digest path on the
# AuditLogWriter side.
# ---------------------------------------------------------------------------


_SCOPE_KEYS: tuple[str, ...] = ("matter_id", "customer_segment")


def extract_scope_metadata(context: ToolCallContext) -> dict[str, str]:
    """Lift scope-aware fields out of `context.arguments` into metadata.

    Returns a dict with at most the keys in `_SCOPE_KEYS`. Missing or
    None values are omitted. Non-string values are coerced via `str()`
    so the audit row stays JSON-serializable; the dashboard treats
    these as opaque strings.
    """
    args = context.arguments
    if not args:
        return {}
    out: dict[str, str] = {}
    for key in _SCOPE_KEYS:
        value = args.get(key)
        if value is None:
            continue
        out[key] = str(value)
    return out


# ---------------------------------------------------------------------------
# Audit metadata builder
#
# The post-tool hook in aie_adapter.py (on main from #981) already
# constructs a `per_tool_audit` metadata dict inline. This helper
# centralizes the shape so future emit sites (cost-telemetry #804,
# fork-side overlay) produce structurally identical rows. The function
# is pure - it does not write to the audit log itself; the caller passes
# the returned dict to AuditEvent.metadata.
#
# Canonical keys (consumers of audit_log.metadata depend on these
# being stable):
#   - per_tool_audit:       True
#   - customer:             str (customer slug)
#   - skill:                str
#   - skill_version:        str | None
#   - tool:                 str
#   - action_class:         str (HookActionClass value)
#   - ceiling_level:        str
#   - outcome:              str ("ok" | "error" | "blocked")
#   - error_type:           str | None
#   - duration_ms:          float | None
#   - trace_id:             str | None
#   - unmapped_tool:        True iff the tool was not in the registry
#   - banned_tool:          True iff the tool was banned (set by caller)
#   - banned_reason:        str (set when banned_tool is True)
#   - matter_id:            str (set when context.arguments has one)
#   - customer_segment:     str (set when context.arguments has one)
# ---------------------------------------------------------------------------


def build_per_tool_metadata(
    *,
    context: ToolCallContext,
    result: ToolCallResult,
    unmapped: bool = False,
    banned_reason: Optional[str] = None,
) -> dict:
    """Build the canonical `metadata` dict for one per-tool audit row.

    Required:
        context        - the `ToolCallContext` the hook received
        result         - the `ToolCallResult` from the dispatch path

    Optional:
        unmapped       - True iff the tool was not in
                         `TOOL_ACTION_CLASS_MAP`; tags the row so audit
                         review can catch new tools missing from the
                         registry
        banned_reason  - non-None means the tool was BANNED and the
                         overlay translated to a blocked outcome.
                         The reason ("banned_tool_pattern_a" /
                         "banned_tool_destructive") lands in metadata
                         so the dashboard can distinguish banned-tool
                         refusals from trust-ceiling refusals
    """
    metadata: dict = {
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
    }

    if unmapped:
        metadata["unmapped_tool"] = True

    if banned_reason is not None:
        metadata["banned_tool"] = True
        metadata["banned_reason"] = banned_reason

    scope = extract_scope_metadata(context)
    if scope:
        metadata.update(scope)

    return metadata


# ---------------------------------------------------------------------------
# Public re-exports
# ---------------------------------------------------------------------------


__all__ = [
    "BANNED_TOOLS",
    "BannedToolError",
    "TOOL_ACTION_CLASS_MAP",
    "ToolCallTimer",
    "ToolClassification",
    "build_per_tool_metadata",
    "classify_tool",
    "extract_scope_metadata",
]
