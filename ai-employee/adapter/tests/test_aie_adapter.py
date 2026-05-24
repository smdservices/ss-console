"""Tests for ai-employee/adapter/aie_adapter.py (issue #841).

Integration tests for the rewired `register()` against the in-memory
`FakeHermesRuntime`. Coverage:

  * register() installs all four hooks against a supplied registry.
  * A forbidden action is BLOCKED at runtime: the tool function never
    runs, the audit row records outcome=blocked, the RefusalHandler is
    invoked (when supplied), the customer-facing message is surfaced.
  * An allowed action runs the tool, the post-tool audit row records
    outcome=ok, the trust ceiling is recorded.
  * customer.yaml-derived pinned slots are seeded at register-time;
    the compaction hook re-injects them on a synthetic compaction.
  * Customer-zero smoke test: end-to-end dispatch with all hooks wired
    against the in-memory fake.

Audit isolation uses the in-memory SQLite executor pattern from
test_audit_log.py / test_refusal.py (the established convention).

Run from repo root:

    cd ai-employee && python -m pytest adapter/tests/test_aie_adapter.py -v
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # ai-employee/ on sys.path
sys.path.insert(0, str(_HERE.parents[2] / "safety-substrate"))

from adapter.aie_adapter import register  # noqa: E402
from adapter.audit_log import (  # noqa: E402
    AuditLogWriter,
    SqliteExecutor,
)
from adapter.hermes_hook import (  # noqa: E402
    DEFAULT_PINNED_SLOT_KEYS,
    BlockedToolCall,
    FakeHermesRuntime,
    HookActionClass,
    HookRegistry,
    ToolCallContext,
)
from refusal import (  # noqa: E402
    InMemoryRefusalCounter,
    RefusalHandler,
)


# ---------------------------------------------------------------------------
# Schema setup - mirror the audit_log schema from migration 0001 so tests
# can write rows without shelling out to wrangler. Matches the pattern
# established in test_audit_log.py / test_refusal.py.
# ---------------------------------------------------------------------------


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
        "SELECT id, action_type, actor, actor_role, skill_name, matter_ref, "
        "trust_ceiling, metadata FROM audit_log ORDER BY rowid"
    ).fetchall()
    out = []
    for row in raw:
        (
            id_,
            action_type,
            actor,
            actor_role,
            skill_name,
            matter_ref,
            trust_ceiling,
            metadata,
        ) = row
        out.append(
            {
                "id": id_,
                "action_type": action_type,
                "actor": actor,
                "actor_role": actor_role,
                "skill_name": skill_name,
                "matter_ref": matter_ref,
                "trust_ceiling": trust_ceiling,
                "metadata": json.loads(metadata) if metadata else None,
            }
        )
    return out


def _allowed_ctx(**overrides) -> ToolCallContext:
    base = {
        "customer": "acme",
        "skill_name": "inbox-triage",
        "tool_name": "Email.create_draft",
        "action_class": HookActionClass.INTERNAL_WRITE,
        "ceiling_level": "autonomous",
        "skill_version": "0.1.0",
        "matter_ref": "matter-0001",
        "trace_id": "trace-test-0001",
        "current_turn_approval": False,
    }
    base.update(overrides)
    return ToolCallContext(**base)


def _forbidden_ctx(**overrides) -> ToolCallContext:
    """A commitment action without approval - invariant #3 says refuse."""
    base = {
        "customer": "acme",
        "skill_name": "law-pi-settlement-prep",
        "tool_name": "PracticeManagement.accept_settlement",
        "action_class": HookActionClass.COMMITMENT,
        "ceiling_level": "autonomous",
        "skill_version": "0.1.0",
        "matter_ref": "matter-0002",
        "trace_id": "trace-test-0002",
        "current_turn_approval": False,
    }
    base.update(overrides)
    return ToolCallContext(**base)


# ---------------------------------------------------------------------------
# register() shape
# ---------------------------------------------------------------------------


def test_register_returns_registry_with_all_four_hooks():
    reg = register()  # no overlay registry supplied; one is constructed
    assert isinstance(reg, HookRegistry)
    # Re-registering any hook should fail because register() installed it.
    with pytest.raises(RuntimeError, match="pre_tool"):
        reg.register_pre_tool(lambda ctx: None)  # type: ignore[arg-type]
    with pytest.raises(RuntimeError, match="post_tool"):
        reg.register_post_tool(lambda ctx, r: None)  # type: ignore[arg-type]
    with pytest.raises(RuntimeError, match="refusal"):
        reg.register_refusal(lambda ctx, b: None)  # type: ignore[arg-type]
    with pytest.raises(RuntimeError, match="compaction"):
        reg.register_compaction(lambda s: None)  # type: ignore[arg-type]


def test_register_accepts_existing_registry():
    overlay_registry = HookRegistry()
    returned = register(overlay_registry)
    assert returned is overlay_registry


# ---------------------------------------------------------------------------
# Forbidden action runtime block - the AC test
# ---------------------------------------------------------------------------


def test_forbidden_action_is_blocked_audit_row_records_outcome_blocked():
    """Integration test (AC #5): a forbidden action is actually blocked
    at runtime AND the audit row records the block."""
    writer, conn = _make_writer()
    reg = register(audit_writer=writer)
    runtime = FakeHermesRuntime(reg)

    tool_invocations = 0

    async def tool_fn():
        nonlocal tool_invocations
        tool_invocations += 1
        return "this must not run"

    result = _run(runtime.dispatch(context=_forbidden_ctx(), tool_fn=tool_fn))

    assert tool_invocations == 0, "tool MUST NOT run when ceiling refuses"
    assert result.outcome == "blocked"

    rows = _rows(conn)
    assert len(rows) == 1, "post-tool hook must emit exactly one audit row"
    row = rows[0]
    assert row["action_type"] == "INVARIANT_VIOLATION"
    assert row["actor"] == "agent"
    assert row["actor_role"] == "agent"
    assert row["skill_name"] == "law-pi-settlement-prep"
    assert row["trust_ceiling"] == "autonomous"
    meta = row["metadata"]
    assert meta["per_tool_audit"] is True
    assert meta["customer"] == "acme"
    assert meta["tool"] == "PracticeManagement.accept_settlement"
    assert meta["action_class"] == "commitment"
    assert meta["outcome"] == "blocked"
    assert meta["trace_id"] == "trace-test-0002"


def test_forbidden_action_with_refusal_handler_emits_refusal_audit_rows():
    """When a RefusalHandler is supplied, the substrate writes its own
    customer-notification + (when threshold met) Captain-alert rows in
    addition to the per-tool audit row.

    AC: integration test that simulates a forbidden action and verifies
    (a) the audit row is written, (b) the action is blocked, (c) a
    refusal-handler audit row is also written.
    """
    writer, conn = _make_writer()
    refusal_handler = RefusalHandler(
        audit_writer=writer,
        counter=InMemoryRefusalCounter(),
    )
    reg = register(
        audit_writer=writer,
        refusal_handler=refusal_handler,
    )
    runtime = FakeHermesRuntime(reg)

    tool_calls = 0

    async def tool_fn():
        nonlocal tool_calls
        tool_calls += 1
        return None

    result = _run(runtime.dispatch(context=_forbidden_ctx(), tool_fn=tool_fn))
    assert tool_calls == 0
    assert result.outcome == "blocked"

    rows = _rows(conn)
    # Expected rows in order:
    #   1. RefusalHandler.handle() -> log_decision() canonical trust-
    #      ceiling-decision row (action_type=INVARIANT_VIOLATION,
    #      metadata.trust_ceiling_decision=true, metadata.decision=refuse)
    #   2. RefusalHandler.handle() notification row
    #      (action_type=DRAFT_REJECTED, metadata.refusal_notification=true)
    #   3. post_tool hook per-tool audit row
    #      (action_type=INVARIANT_VIOLATION, metadata.per_tool_audit=true,
    #      metadata.outcome=blocked)
    assert len(rows) == 3, (
        f"expected three audit rows (decision + notification + per-tool); "
        f"got {len(rows)}: {[r['action_type'] for r in rows]}"
    )

    decision_row = rows[0]
    assert decision_row["action_type"] == "INVARIANT_VIOLATION"
    assert decision_row["metadata"]["trust_ceiling_decision"] is True
    assert decision_row["metadata"]["decision"] == "refuse"
    assert decision_row["metadata"]["customer"] == "acme"

    notification_row = rows[1]
    assert notification_row["action_type"] == "DRAFT_REJECTED"
    assert notification_row["metadata"]["refusal_notification"] is True
    assert notification_row["metadata"]["notification_eligible"] is True

    per_tool_row = rows[2]
    assert per_tool_row["action_type"] == "INVARIANT_VIOLATION"
    assert per_tool_row["metadata"]["per_tool_audit"] is True
    assert per_tool_row["metadata"]["outcome"] == "blocked"


# ---------------------------------------------------------------------------
# Allowed action - happy path through the dispatch loop
# ---------------------------------------------------------------------------


def test_allowed_action_runs_tool_and_emits_ok_audit_row():
    writer, conn = _make_writer()
    reg = register(audit_writer=writer)
    runtime = FakeHermesRuntime(reg)

    invocations = 0

    async def tool_fn():
        nonlocal invocations
        invocations += 1
        return "draft created id=abc"

    result = _run(runtime.dispatch(context=_allowed_ctx(), tool_fn=tool_fn))

    assert invocations == 1
    assert result.outcome == "ok"

    rows = _rows(conn)
    assert len(rows) == 1
    row = rows[0]
    assert row["action_type"] == "DRAFT_CREATED"
    meta = row["metadata"]
    assert meta["per_tool_audit"] is True
    assert meta["outcome"] == "ok"
    assert meta["tool"] == "Email.create_draft"
    assert meta["action_class"] == "internal_write"


def test_allowed_action_without_audit_writer_logs_and_returns():
    # Adapter path with no writer (test/local-dev fallback): the dispatch
    # still completes; the post-hook logs-and-skips.
    reg = register(audit_writer=None)
    runtime = FakeHermesRuntime(reg)
    result = _run(runtime.dispatch(context=_allowed_ctx()))
    assert result.outcome == "ok"


# ---------------------------------------------------------------------------
# Pinned slots + compaction
# ---------------------------------------------------------------------------


def test_register_seeds_pinned_slots_from_customer_config(monkeypatch, tmp_path):
    """customer.yaml-derived slots are pinned at register-time."""
    pytest.importorskip("yaml")
    yaml_path = tmp_path / "customer.yaml"
    yaml_path.write_text(
        "customer_id: acme\n"
        "persona:\n"
        "  name: Marcus\n"
        "reviewer:\n"
        "  identity: captain-scott\n"
        "signature: sha256:abcdef\n"
    )
    monkeypatch.setenv("AIE_CUSTOMER_YAML", str(yaml_path))

    reg = register()
    snapshot = reg.pinned_slots.snapshot()
    assert snapshot.get("persona.name") == "Marcus"
    assert snapshot.get("reviewer.identity") == "captain-scott"
    assert snapshot.get("customer.yaml.signature") == "sha256:abcdef"


def test_register_compaction_hook_fires_and_sees_pinned_slots(monkeypatch, tmp_path):
    pytest.importorskip("yaml")
    yaml_path = tmp_path / "customer.yaml"
    yaml_path.write_text(
        "customer_id: acme\n"
        "persona:\n"
        "  name: Marcus\n"
    )
    monkeypatch.setenv("AIE_CUSTOMER_YAML", str(yaml_path))

    reg = register()
    runtime = FakeHermesRuntime(reg)
    # Add a sticky-stop slot AFTER register (simulating substrate state change)
    reg.pinned_slots.pin("sticky_stop.active", "true")
    # Compaction must not blow up; pinned slots survive.
    _run(runtime.compact())
    assert reg.pinned_slots.get("persona.name") == "Marcus"
    assert reg.pinned_slots.get("sticky_stop.active") == "true"


def test_register_handles_missing_customer_yaml(monkeypatch, tmp_path):
    # AIE_CUSTOMER_YAML points at a non-existent path; register() must
    # still install hooks (logs a warning, falls through with empty cfg).
    monkeypatch.setenv("AIE_CUSTOMER_YAML", str(tmp_path / "missing.yaml"))
    reg = register()
    assert reg.pinned_slots.snapshot() == {}


# ---------------------------------------------------------------------------
# Customer-zero smoke test - full end-to-end through every hook
# ---------------------------------------------------------------------------


def test_customer_zero_smoke_end_to_end(monkeypatch, tmp_path):
    """Customer-zero smoke (AC #6): adapter wired, forbidden and allowed
    actions exercise every hook, audit rows land for each."""
    has_yaml = True
    try:
        import yaml  # noqa: F401
    except ImportError:
        has_yaml = False

    if has_yaml:
        yaml_path = tmp_path / "customer.yaml"
        yaml_path.write_text(
            "customer_id: customer-zero\n"
            "persona:\n"
            "  name: Helen\n"
            "reviewer:\n"
            "  identity: captain-scott\n"
        )
        monkeypatch.setenv("AIE_CUSTOMER_YAML", str(yaml_path))

    writer, conn = _make_writer()
    refusal_handler = RefusalHandler(
        audit_writer=writer,
        counter=InMemoryRefusalCounter(),
    )
    reg = register(audit_writer=writer, refusal_handler=refusal_handler)
    runtime = FakeHermesRuntime(reg)

    # Persona + reviewer pinned at boot ONLY when yaml could parse the config.
    if has_yaml:
        assert reg.pinned_slots.get("persona.name") == "Helen"
        assert reg.pinned_slots.get("reviewer.identity") == "captain-scott"

    # 1. Allowed action - internal write at autonomous ceiling
    result = _run(
        runtime.dispatch(
            context=_allowed_ctx(customer="customer-zero"),
            tool_fn=_make_tool_fn("ok"),
        )
    )
    assert result.outcome == "ok"

    # 2. Forbidden action - commitment without approval (refused)
    result = _run(
        runtime.dispatch(
            context=_forbidden_ctx(customer="customer-zero"),
            tool_fn=_make_tool_fn("must not run"),
        )
    )
    assert result.outcome == "blocked"

    # 3. Compaction - pinned slots survive (when slots were seeded)
    _run(runtime.compact())
    if has_yaml:
        assert reg.pinned_slots.get("persona.name") == "Helen"

    rows = _rows(conn)
    action_types = [r["action_type"] for r in rows]
    # Expected ordering:
    #   1. DRAFT_CREATED  (allowed action per-tool audit, outcome=ok)
    #   2. INVARIANT_VIOLATION (refusal canonical decision row)
    #   3. DRAFT_REJECTED (refusal notification row)
    #   4. INVARIANT_VIOLATION (refusal per-tool audit, outcome=blocked)
    assert action_types == [
        "DRAFT_CREATED",
        "INVARIANT_VIOLATION",
        "DRAFT_REJECTED",
        "INVARIANT_VIOLATION",
    ], f"unexpected audit row sequence: {action_types}"

    allowed_meta = rows[0]["metadata"]
    assert allowed_meta["outcome"] == "ok"
    assert allowed_meta["customer"] == "customer-zero"

    blocked_meta = rows[3]["metadata"]
    assert blocked_meta["outcome"] == "blocked"
    assert blocked_meta["customer"] == "customer-zero"


def _make_tool_fn(return_value):
    async def fn():
        return return_value

    return fn


# ---------------------------------------------------------------------------
# SMD overlay surface registration (ADR 0015 - PR 3)
# ---------------------------------------------------------------------------
#
# register() must call smd.hooks.<surface>.register_smd_adapter(...) for
# each overlay surface IN ADDITION to the in-tree HookRegistry wiring,
# and must tolerate three states cleanly:
#
#   1. smd package absent      (dev / test / pre-fork-install)
#   2. smd present but scaffold (PR 1 ships TODO stubs that raise
#                                NotImplementedError)
#   3. smd present and implemented (post-consumer-PRs steady state)
#
# In all three states the in-tree four-hook registration is unconditional
# and must complete. The overlay registration is best-effort and logged.


def _import_aie_adapter_module():
    """Resolve the actual aie_adapter module so monkeypatch can mutate it
    regardless of whether the test imports it as `adapter.aie_adapter` or
    `aie_adapter` depending on PYTHONPATH ordering."""
    import adapter.aie_adapter as mod

    return mod


def test_overlay_registration_absent_smd_package_does_not_break_register(caplog):
    """State 1: smd is not on PYTHONPATH. register() returns a fully-wired
    in-tree registry; the overlay branch is logged at INFO level and
    returns 0 registered surfaces."""
    mod = _import_aie_adapter_module()
    # Sanity: no smd package available in this test environment.
    with pytest.raises(ModuleNotFoundError):
        __import__("smd.hooks.audit_emission")

    with caplog.at_level("INFO", logger="aie.adapter"):
        reg = mod.register()

    assert isinstance(reg, HookRegistry)
    # In-tree four-hook installation still completed: every re-register
    # call should raise because each slot already holds a hook.
    with pytest.raises(RuntimeError, match="pre_tool"):
        reg.register_pre_tool(lambda ctx: None)  # type: ignore[arg-type]

    # The bail-early branch logs once and stops; expect the "0/4 SMD overlay
    # surface(s) bound" line in the summary.
    summary_lines = [r.message for r in caplog.records if "SMD overlay surface" in r.message]
    assert any("0/4 SMD overlay surface(s) bound" in m for m in summary_lines)


def test_overlay_registration_scaffold_only_continues_per_surface(monkeypatch, caplog):
    """State 2: every overlay surface raises NotImplementedError (the
    initial scaffold shipped by PR 1). register() catches each, warns,
    and registered_count is 0."""
    mod = _import_aie_adapter_module()

    fake_modules: dict[str, object] = {}

    class _FakeOverlaySurface:
        def __init__(self, label: str) -> None:
            self.label = label

        def register_smd_adapter(self, registry, *, customer_id):
            raise NotImplementedError(
                f"smd.hooks.{self.label}.register_smd_adapter is a scaffold"
            )

    for module_path, label in mod._OVERLAY_SURFACES:
        fake_modules[module_path] = _FakeOverlaySurface(label)
        monkeypatch.setitem(sys.modules, module_path, fake_modules[module_path])

    with caplog.at_level("WARNING", logger="aie.adapter"):
        reg = mod.register()

    assert isinstance(reg, HookRegistry)
    # In-tree wiring is unaffected.
    with pytest.raises(RuntimeError, match="pre_tool"):
        reg.register_pre_tool(lambda ctx: None)  # type: ignore[arg-type]

    scaffold_warnings = [
        r for r in caplog.records if "is a scaffold" in r.message and r.levelname == "WARNING"
    ]
    assert len(scaffold_warnings) == len(mod._OVERLAY_SURFACES), (
        f"expected one scaffold-warning per surface, got {len(scaffold_warnings)}: "
        f"{[r.message for r in scaffold_warnings]}"
    )


def test_overlay_registration_calls_each_surface_with_registry_and_customer_id(monkeypatch):
    """State 3: implemented overlay surfaces. register_smd_adapter is
    invoked once per surface with (registry, customer_id=...). The
    registry passed to each is the SAME object returned by register()."""
    mod = _import_aie_adapter_module()

    calls: list[tuple[str, object, str]] = []

    class _LiveOverlaySurface:
        def __init__(self, label: str) -> None:
            self.label = label

        def register_smd_adapter(self, registry, *, customer_id):
            calls.append((self.label, registry, customer_id))

    for module_path, label in mod._OVERLAY_SURFACES:
        monkeypatch.setitem(sys.modules, module_path, _LiveOverlaySurface(label))

    reg = mod.register()

    assert isinstance(reg, HookRegistry)
    assert len(calls) == len(mod._OVERLAY_SURFACES), calls
    expected_labels = [label for (_, label) in mod._OVERLAY_SURFACES]
    assert [c[0] for c in calls] == expected_labels
    for _, registry_arg, customer_id_arg in calls:
        assert registry_arg is reg, "overlay call must receive the same registry"
        # customer_id defaults to "unknown" when no customer.yaml is loaded.
        assert isinstance(customer_id_arg, str) and len(customer_id_arg) > 0


def test_overlay_registration_one_scaffold_does_not_block_other_surfaces(monkeypatch):
    """Mixed state: one overlay surface is implemented, one raises
    NotImplementedError, the rest are implemented. register() must still
    invoke the implemented surfaces and skip only the scaffold one."""
    mod = _import_aie_adapter_module()

    successful_labels: list[str] = []

    class _LiveOverlaySurface:
        def __init__(self, label: str) -> None:
            self.label = label

        def register_smd_adapter(self, registry, *, customer_id):
            successful_labels.append(self.label)

    class _ScaffoldOverlaySurface:
        def register_smd_adapter(self, registry, *, customer_id):
            raise NotImplementedError("still a scaffold")

    surfaces = mod._OVERLAY_SURFACES
    scaffold_index = 1  # arbitrary middle surface
    for i, (module_path, label) in enumerate(surfaces):
        if i == scaffold_index:
            monkeypatch.setitem(sys.modules, module_path, _ScaffoldOverlaySurface())
        else:
            monkeypatch.setitem(sys.modules, module_path, _LiveOverlaySurface(label))

    reg = mod.register()

    assert isinstance(reg, HookRegistry)
    expected_successes = [
        label for i, (_, label) in enumerate(surfaces) if i != scaffold_index
    ]
    assert successful_labels == expected_successes, (
        f"expected implemented surfaces to register; got {successful_labels}"
    )


def test_overlay_helper_returns_zero_when_smd_root_missing():
    """The _register_overlay_surface helper bails early on the first
    ModuleNotFoundError because all overlay surfaces share the same root
    package; the helper returns the count of surfaces registered so far
    (0 in this case)."""
    mod = _import_aie_adapter_module()
    # Ensure smd is not on sys.modules.
    for module_path, _ in mod._OVERLAY_SURFACES:
        sys.modules.pop(module_path, None)

    registry = HookRegistry()
    count = mod._register_overlay_surface(registry, customer_id="test-customer")
    assert count == 0
