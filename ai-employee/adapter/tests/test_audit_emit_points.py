"""Tests for ai-employee/adapter/audit_emit_points.py (issue #842).

Covers:

  * Registry: every key maps to a `HookActionClass`, no overlap with
    BANNED_TOOLS, registry is immutable at runtime.
  * Banned tools: every BANNED tool raises BannedToolError on classify;
    BannedToolError carries a closed-vocabulary reason; the canonical
    email_send / payments_initiate_transfer cases are tested explicitly.
  * Unknown tools: default to READ + tag metadata.unmapped_tool=true.
  * Latency timer: monotonic, single-shot, raises on misuse.
  * Scope-aware metadata: lifts matter_id / customer_segment from
    `context.arguments`; missing values are omitted.
  * Metadata builder: produces the canonical key set; unmapped + banned
    flags appear when requested; scope keys merge cleanly.
  * Integration: builder output writes through the real
    `AuditLogWriter` against an in-memory SQLite executor, mirroring the
    pattern in `test_aie_adapter.py`. Asserts the row schema lands.

Run from repo root:

    cd ai-employee && python -m pytest adapter/tests/test_audit_emit_points.py -v
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
import time
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # ai-employee/ on sys.path

from adapter.audit_emit_points import (  # noqa: E402
    BANNED_TOOLS,
    TOOL_ACTION_CLASS_MAP,
    BannedToolError,
    ToolCallTimer,
    ToolClassification,
    build_per_tool_metadata,
    classify_tool,
    extract_scope_metadata,
)
from adapter.audit_log import (  # noqa: E402
    ActorRole,
    AuditEvent,
    AuditLogWriter,
    SqliteExecutor,
)
from adapter.hermes_hook import (  # noqa: E402
    HookActionClass,
    ToolCallContext,
    ToolCallResult,
)


_AUDIT_SCHEMA = """
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  ts            TEXT NOT NULL,
  action_type   TEXT NOT NULL,
  actor         TEXT NOT NULL,
  actor_role    TEXT,
  skill_name    TEXT,
  matter_ref    TEXT,
  input_digest  TEXT,
  output_digest TEXT,
  diff_digest   TEXT,
  trust_ceiling TEXT,
  metadata      TEXT
);
"""


def _make_audit_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.executescript(_AUDIT_SCHEMA)
    return conn


def _make_writer() -> tuple[AuditLogWriter, sqlite3.Connection]:
    conn = _make_audit_conn()
    return AuditLogWriter(SqliteExecutor(conn)), conn


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _rows(conn: sqlite3.Connection) -> list[dict]:
    cur = conn.cursor()
    raw = cur.execute(
        "SELECT id, ts, action_type, actor, actor_role, skill_name, "
        "matter_ref, trust_ceiling, metadata FROM audit_log ORDER BY id"
    ).fetchall()
    return [
        {
            "id": r[0],
            "ts": r[1],
            "action_type": r[2],
            "actor": r[3],
            "actor_role": r[4],
            "skill_name": r[5],
            "matter_ref": r[6],
            "trust_ceiling": r[7],
            "metadata": json.loads(r[8]) if r[8] else None,
        }
        for r in raw
    ]


def _ctx(**overrides) -> ToolCallContext:
    base = {
        "customer": "acme",
        "skill_name": "inbox-triage",
        "tool_name": "email_create_draft",
        "action_class": HookActionClass.INTERNAL_WRITE,
        "ceiling_level": "draft_for_review",
        "skill_version": "0.1.0",
        "matter_ref": "matter-9001",
        "trace_id": "trace-test-0001",
        "current_turn_approval": False,
        "arguments": None,
    }
    base.update(overrides)
    return ToolCallContext(**base)


# ---------------------------------------------------------------------------
# Registry invariants
# ---------------------------------------------------------------------------


def test_registry_is_nonempty():
    assert len(TOOL_ACTION_CLASS_MAP) > 0


def test_registry_values_are_hook_action_class():
    for name, value in TOOL_ACTION_CLASS_MAP.items():
        assert isinstance(value, HookActionClass), (
            f"registry value for {name!r} is not a HookActionClass"
        )


def test_registry_and_banned_sets_are_disjoint():
    """No tool name appears in both the registry and BANNED_TOOLS.

    Adding a banned tool to the registry is a P0 doctrine violation:
    it would allow the trust-ceiling enforcer to make a decision about
    a tool name the substrate considers structurally forbidden.
    """
    overlap = set(TOOL_ACTION_CLASS_MAP.keys()) & set(BANNED_TOOLS)
    assert overlap == set(), (
        f"tool names appear in BOTH TOOL_ACTION_CLASS_MAP and "
        f"BANNED_TOOLS - this is a doctrine violation: {sorted(overlap)}"
    )


def test_registry_is_immutable_at_runtime():
    """Callers must not mutate the registry; changes ship as PRs."""
    with pytest.raises(TypeError):
        TOOL_ACTION_CLASS_MAP["new_tool"] = HookActionClass.READ  # type: ignore[index]


def test_email_send_is_banned_not_in_registry():
    """The canonical Pattern A check: email_send is BANNED, not mapped."""
    assert "email_send" in BANNED_TOOLS
    assert "email_send" not in TOOL_ACTION_CLASS_MAP


def test_email_create_draft_is_internal_write():
    """The canonical allowed path: draft creation is INTERNAL_WRITE."""
    assert TOOL_ACTION_CLASS_MAP["email_create_draft"] is HookActionClass.INTERNAL_WRITE


def test_practice_management_search_is_read():
    """Read-only matter access stays READ."""
    assert (
        TOOL_ACTION_CLASS_MAP["practice_management_search_matters"]
        is HookActionClass.READ
    )


def test_payments_initiate_transfer_is_banned():
    """Money movement is permanently banned."""
    assert "payments_initiate_transfer" in BANNED_TOOLS
    assert "payments_initiate_transfer" not in TOOL_ACTION_CLASS_MAP


# ---------------------------------------------------------------------------
# classify_tool() behavior
# ---------------------------------------------------------------------------


def test_classify_tool_returns_registry_value_for_known_tool():
    cls = classify_tool("email_create_draft")
    assert cls.action_class is HookActionClass.INTERNAL_WRITE
    assert cls.unmapped is False


def test_classify_tool_returns_read_default_for_unknown_tool():
    cls = classify_tool("some_brand_new_tool")
    assert cls.action_class is HookActionClass.READ
    assert cls.unmapped is True


def test_classify_tool_raises_banned_for_email_send():
    with pytest.raises(BannedToolError) as exc:
        classify_tool("email_send")
    assert exc.value.tool_name == "email_send"
    assert exc.value.reason == "banned_tool_pattern_a"


def test_classify_tool_raises_banned_for_payments_initiate_transfer():
    with pytest.raises(BannedToolError) as exc:
        classify_tool("payments_initiate_transfer")
    assert exc.value.tool_name == "payments_initiate_transfer"
    assert exc.value.reason == "banned_tool_destructive"


def test_classify_tool_raises_for_every_banned_tool():
    """Exhaustive: every BANNED tool must raise from classify_tool."""
    for name in BANNED_TOOLS:
        with pytest.raises(BannedToolError):
            classify_tool(name)


def test_classify_tool_rejects_empty_name():
    with pytest.raises(ValueError, match="tool_name is required"):
        classify_tool("")


def test_banned_error_message_includes_reason():
    """BannedToolError.__str__ surfaces the reason so audit metadata is
    readable in logs."""
    err = BannedToolError(tool_name="email_send", reason="banned_tool_pattern_a")
    assert "email_send" in str(err)
    assert "banned_tool_pattern_a" in str(err)


# ---------------------------------------------------------------------------
# ToolCallTimer
# ---------------------------------------------------------------------------


def test_timer_measures_elapsed_ms():
    timer = ToolCallTimer().start()
    time.sleep(0.005)  # 5ms; CI clock noise puts the lower bound around 4ms
    elapsed = timer.stop()
    assert elapsed >= 4.0, f"expected >= 4ms, got {elapsed}"
    assert elapsed < 200.0, f"expected < 200ms, got {elapsed}"
    assert timer.duration_ms == elapsed


def test_timer_duration_is_none_before_stop():
    timer = ToolCallTimer().start()
    assert timer.duration_ms is None
    timer.stop()


def test_timer_start_twice_raises():
    timer = ToolCallTimer().start()
    with pytest.raises(RuntimeError, match="start called twice"):
        timer.start()


def test_timer_stop_before_start_raises():
    timer = ToolCallTimer()
    with pytest.raises(RuntimeError, match="stop called before start"):
        timer.stop()


def test_timer_stop_twice_raises():
    timer = ToolCallTimer().start()
    timer.stop()
    with pytest.raises(RuntimeError, match="stop called twice"):
        timer.stop()


# ---------------------------------------------------------------------------
# extract_scope_metadata
# ---------------------------------------------------------------------------


def test_extract_scope_metadata_returns_empty_when_no_arguments():
    assert extract_scope_metadata(_ctx(arguments=None)) == {}


def test_extract_scope_metadata_returns_empty_when_arguments_lack_scope_keys():
    ctx = _ctx(arguments={"unrelated": "value", "subject": "Hi"})
    assert extract_scope_metadata(ctx) == {}


def test_extract_scope_metadata_lifts_matter_id():
    ctx = _ctx(arguments={"matter_id": "matter-42", "body": "ignored"})
    assert extract_scope_metadata(ctx) == {"matter_id": "matter-42"}


def test_extract_scope_metadata_lifts_customer_segment():
    ctx = _ctx(arguments={"customer_segment": "cohort-a"})
    assert extract_scope_metadata(ctx) == {"customer_segment": "cohort-a"}


def test_extract_scope_metadata_lifts_both_keys():
    ctx = _ctx(
        arguments={
            "matter_id": "matter-7",
            "customer_segment": "cohort-b",
            "to": "ignored@example.com",
        }
    )
    out = extract_scope_metadata(ctx)
    assert out == {"matter_id": "matter-7", "customer_segment": "cohort-b"}


def test_extract_scope_metadata_coerces_non_string_values():
    ctx = _ctx(arguments={"matter_id": 12345, "customer_segment": True})
    out = extract_scope_metadata(ctx)
    assert out == {"matter_id": "12345", "customer_segment": "True"}


def test_extract_scope_metadata_omits_none_values():
    ctx = _ctx(arguments={"matter_id": None, "customer_segment": "cohort-c"})
    assert extract_scope_metadata(ctx) == {"customer_segment": "cohort-c"}


# ---------------------------------------------------------------------------
# build_per_tool_metadata
# ---------------------------------------------------------------------------


def test_build_metadata_canonical_keys_present():
    md = build_per_tool_metadata(
        context=_ctx(),
        result=ToolCallResult(outcome="ok", duration_ms=12.5),
    )
    for key in (
        "per_tool_audit",
        "customer",
        "skill",
        "skill_version",
        "tool",
        "action_class",
        "ceiling_level",
        "outcome",
        "error_type",
        "duration_ms",
        "trace_id",
    ):
        assert key in md, f"canonical key {key!r} missing from metadata"
    assert md["per_tool_audit"] is True
    assert md["customer"] == "acme"
    assert md["tool"] == "email_create_draft"
    assert md["action_class"] == HookActionClass.INTERNAL_WRITE.value
    assert md["outcome"] == "ok"
    assert md["duration_ms"] == 12.5
    assert md["trace_id"] == "trace-test-0001"


def test_build_metadata_no_unmapped_or_banned_flags_by_default():
    md = build_per_tool_metadata(
        context=_ctx(),
        result=ToolCallResult(outcome="ok"),
    )
    assert "unmapped_tool" not in md
    assert "banned_tool" not in md
    assert "banned_reason" not in md


def test_build_metadata_tags_unmapped_tool():
    md = build_per_tool_metadata(
        context=_ctx(tool_name="some_brand_new_tool"),
        result=ToolCallResult(outcome="ok"),
        unmapped=True,
    )
    assert md["unmapped_tool"] is True


def test_build_metadata_tags_banned_tool():
    md = build_per_tool_metadata(
        context=_ctx(tool_name="email_send"),
        result=ToolCallResult(outcome="blocked"),
        banned_reason="banned_tool_pattern_a",
    )
    assert md["banned_tool"] is True
    assert md["banned_reason"] == "banned_tool_pattern_a"
    assert md["outcome"] == "blocked"


def test_build_metadata_merges_scope_keys():
    md = build_per_tool_metadata(
        context=_ctx(arguments={"matter_id": "matter-42"}),
        result=ToolCallResult(outcome="ok"),
    )
    assert md["matter_id"] == "matter-42"


def test_build_metadata_error_outcome_carries_error_type():
    md = build_per_tool_metadata(
        context=_ctx(),
        result=ToolCallResult(outcome="error", error_type="VendorTimeout"),
    )
    assert md["outcome"] == "error"
    assert md["error_type"] == "VendorTimeout"


def test_build_metadata_blocked_outcome_for_banned_tool():
    md = build_per_tool_metadata(
        context=_ctx(tool_name="payments_initiate_transfer"),
        result=ToolCallResult(outcome="blocked"),
        banned_reason="banned_tool_destructive",
    )
    assert md["outcome"] == "blocked"
    assert md["banned_tool"] is True
    assert md["banned_reason"] == "banned_tool_destructive"


# ---------------------------------------------------------------------------
# Integration: builder output writes through the real AuditLogWriter
# ---------------------------------------------------------------------------


def test_metadata_writes_through_real_audit_log_writer():
    writer, conn = _make_writer()
    ctx = _ctx(
        tool_name="email_create_draft",
        arguments={"matter_id": "matter-42", "customer_segment": "cohort-a"},
    )
    result = ToolCallResult(outcome="ok", duration_ms=8.25)
    metadata = build_per_tool_metadata(context=ctx, result=result)

    audit_id = _run(
        writer.write(
            AuditEvent(
                action_type="DRAFT_CREATED",
                actor="agent",
                actor_role=ActorRole.AGENT,
                skill_name=ctx.skill_name,
                matter_ref=ctx.matter_ref,
                trust_ceiling=ctx.ceiling_level,
                metadata=metadata,
            )
        )
    )

    assert audit_id  # ULID returned
    rows = _rows(conn)
    assert len(rows) == 1
    row = rows[0]
    assert row["action_type"] == "DRAFT_CREATED"
    assert row["actor_role"] == "agent"
    assert row["skill_name"] == "inbox-triage"
    assert row["matter_ref"] == "matter-9001"
    assert row["trust_ceiling"] == "draft_for_review"
    md = row["metadata"]
    assert md["per_tool_audit"] is True
    assert md["tool"] == "email_create_draft"
    assert md["matter_id"] == "matter-42"
    assert md["customer_segment"] == "cohort-a"
    assert md["duration_ms"] == 8.25


def test_banned_tool_blocked_row_records_banned_metadata():
    """End-to-end: a banned tool produces a blocked audit row whose
    metadata.banned_tool=true and metadata.banned_reason names the
    Pattern."""
    writer, conn = _make_writer()
    ctx = _ctx(tool_name="email_send", action_class=HookActionClass.EXTERNAL_SEND)
    # The overlay would have caught BannedToolError, translated to a
    # blocked result, then called build_per_tool_metadata with
    # banned_reason set. Simulate that:
    try:
        classify_tool(ctx.tool_name)
    except BannedToolError as exc:
        result = ToolCallResult(outcome="blocked")
        metadata = build_per_tool_metadata(
            context=ctx,
            result=result,
            banned_reason=exc.reason,
        )
    else:  # pragma: no cover - classify_tool must raise here
        pytest.fail("expected BannedToolError for email_send")

    _run(
        writer.write(
            AuditEvent(
                action_type="INVARIANT_VIOLATION",
                actor="agent",
                actor_role=ActorRole.AGENT,
                skill_name=ctx.skill_name,
                metadata=metadata,
            )
        )
    )

    rows = _rows(conn)
    assert len(rows) == 1
    md = rows[0]["metadata"]
    assert md["banned_tool"] is True
    assert md["banned_reason"] == "banned_tool_pattern_a"
    assert md["outcome"] == "blocked"
    assert md["tool"] == "email_send"


# ---------------------------------------------------------------------------
# No-autonomous-send invariants
# ---------------------------------------------------------------------------


def test_no_send_tool_appears_in_registry():
    """Defense-in-depth: no tool name suggesting autonomous send may be
    in TOOL_ACTION_CLASS_MAP. Adding one is a doctrine violation.
    """
    forbidden_substrings = ("_send", "_send_", "send_message")
    for name in TOOL_ACTION_CLASS_MAP.keys():
        for substr in forbidden_substrings:
            assert substr not in name, (
                f"tool name {name!r} contains forbidden substring {substr!r}; "
                "autonomous send is BANNED and must not appear in the registry"
            )
