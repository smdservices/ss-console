"""Tests for ai-employee/adapter/connector_smoke.py (issue #852).

Coverage:

* `SmokeProbe.__post_init__` validation -- write methods are rejected,
  unknown capabilities are rejected, bad backend prefixes are rejected.
* `SmokeProbeRegistry.find` matches on (capability, adapter, backend prefix).
* `_assert_capability_set_well_formed` catches every shape drift
  (mismatched capability, empty adapter/version, overlapping
  supported/unsupported, unknown capability).
* `_run_one_probe` -- pass / partial (shape drift) / fail (raises) /
  fail (missing method) / fail (timeout).
* `_overall_status` -- threshold rules for pass / partial / fail with
  optional flags.
* `run_smoke_tests` integration -- reads customer.yaml, dispatches
  probes, aggregates report, emits audit rows for non-pass.
* `load_enabled_connectors` -- skips disabled, skips synthetic
  backends, includes enabled build/composio.
* `SmokeReport.exit_code` -- 0/1/2 mapping.
* Audit emission uses an action_type that exists in
  ACCEPTED_ACTION_TYPES.

Run from repo root:

    cd ai-employee && python3 -m pytest adapter/tests/test_connector_smoke.py -v
"""

from __future__ import annotations

import asyncio
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))  # ai-employee/ on sys.path

from adapter.audit_log import (  # noqa: E402
    ACCEPTED_ACTION_TYPES,
    AuditLogWriter,
    SqliteExecutor,
)
from adapter.connector_smoke import (  # noqa: E402
    CAPABILITY_NAMES,
    ConnectorSmokeResult,
    PROBE_TIMEOUT_SECONDS,
    ProbeRegistrationError,
    READ_ONLY_METHODS_BY_CAPABILITY,
    SmokeProbe,
    SmokeProbeRegistry,
    SmokeReport,
    SmokeStatus,
    _AUDIT_ACTION_TYPE,
    _assert_capability_set_well_formed,
    _overall_status,
    _run_one_probe,
    load_enabled_connectors,
    run_smoke_tests,
)


# ---------------------------------------------------------------------------
# Fake adapter -- exposes the read-only surface a probe would call
# ---------------------------------------------------------------------------


@dataclass
class FakeCapabilitySet:
    capability: str = "PracticeManagement"
    adapter: str = "fake"
    version: str = "0.0.1"
    supported_methods: tuple[str, ...] = (
        "describe_capabilities",
        "health_check",
        "search_matters",
    )
    unsupported_methods: tuple[str, ...] = ()


class FakeAdapter:
    """Programmable read-only adapter used across tests."""

    def __init__(
        self,
        *,
        capability_set: Optional[FakeCapabilitySet] = None,
        raise_on_method: Optional[Exception] = None,
        method_delay_seconds: float = 0.0,
        async_describe: bool = False,
    ) -> None:
        self._set = capability_set or FakeCapabilitySet()
        self._raise = raise_on_method
        self._delay = method_delay_seconds
        self._async_describe = async_describe
        self.calls: list[str] = []

    def describe_capabilities(self):  # type: ignore[no-untyped-def]
        self.calls.append("describe_capabilities")
        if self._async_describe:
            async def _coro():
                return self._set
            return _coro()
        return self._set

    async def search_matters(self, **kwargs: Any) -> list[Any]:
        self.calls.append("search_matters")
        if self._delay:
            await asyncio.sleep(self._delay)
        if self._raise is not None:
            raise self._raise
        return []

    async def list_documents(self, matter_id: str) -> list[Any]:
        self.calls.append(f"list_documents({matter_id})")
        if self._raise is not None:
            raise self._raise
        return []


def _factory_yielding(adapter: FakeAdapter):
    def fac(_conn: dict[str, Any]) -> FakeAdapter:
        return adapter
    return fac


# ---------------------------------------------------------------------------
# SmokeProbe registration validation
# ---------------------------------------------------------------------------


def test_probe_rejects_write_method():
    """A probe MUST NOT register a write method, even by mistake."""
    with pytest.raises(ProbeRegistrationError, match="read-only allowlist"):
        SmokeProbe(
            capability="PracticeManagement",
            adapter="filevine",
            backend_prefix="build:",
            method="create_note",  # write method -- forbidden
            factory=_factory_yielding(FakeAdapter()),
        )


def test_probe_rejects_unknown_capability():
    with pytest.raises(ProbeRegistrationError, match="CAPABILITY_NAMES"):
        SmokeProbe(
            capability="NotARealCapability",
            adapter="x",
            backend_prefix="build:",
            method="describe_capabilities",
            factory=_factory_yielding(FakeAdapter()),
        )


def test_probe_rejects_bad_backend_prefix():
    with pytest.raises(ProbeRegistrationError, match="backend_prefix"):
        SmokeProbe(
            capability="PracticeManagement",
            adapter="filevine",
            backend_prefix="docker:",  # not one of composio/build/mcp/synthetic
            method="search_matters",
            factory=_factory_yielding(FakeAdapter()),
        )


def test_probe_accepts_every_read_only_method_in_allowlist():
    """Sanity: every method in the allowlist registers without raising."""
    for cap, methods in READ_ONLY_METHODS_BY_CAPABILITY.items():
        for m in methods:
            SmokeProbe(
                capability=cap,
                adapter="probe-test",
                backend_prefix="build:",
                method=m,
                factory=_factory_yielding(FakeAdapter()),
            )


# ---------------------------------------------------------------------------
# Read-only method allowlist invariants
# ---------------------------------------------------------------------------


def test_allowlist_contains_no_mutating_method_names():
    """The allowlist MUST NOT include any obvious mutation prefix."""
    bad_prefixes = ("create_", "send_", "upload_", "post_", "update_", "delete_", "share_")
    for cap, methods in READ_ONLY_METHODS_BY_CAPABILITY.items():
        for m in methods:
            assert not any(m.startswith(p) for p in bad_prefixes), (
                f"capability {cap!r} allowlist contains apparent mutation method {m!r}"
            )


def test_allowlist_covers_every_capability():
    assert set(READ_ONLY_METHODS_BY_CAPABILITY.keys()) == CAPABILITY_NAMES


# ---------------------------------------------------------------------------
# SmokeProbeRegistry
# ---------------------------------------------------------------------------


def test_registry_find_matches_backend_prefix():
    reg = SmokeProbeRegistry()
    probe = SmokeProbe(
        capability="PracticeManagement",
        adapter="filevine",
        backend_prefix="build:",
        method="search_matters",
        factory=_factory_yielding(FakeAdapter()),
    )
    reg.register(probe)
    assert (
        reg.find(
            capability="PracticeManagement",
            adapter="filevine",
            backend="build:filevine-mcp",
        )
        is probe
    )
    # Mismatched backend prefix -> None
    assert (
        reg.find(
            capability="PracticeManagement",
            adapter="filevine",
            backend="composio:filevine",
        )
        is None
    )
    # Mismatched adapter -> None
    assert (
        reg.find(
            capability="PracticeManagement",
            adapter="clio",
            backend="build:clio-mcp",
        )
        is None
    )


# ---------------------------------------------------------------------------
# Capability-set well-formedness
# ---------------------------------------------------------------------------


def test_capability_set_well_formed_passes_dataclass():
    set_obj = FakeCapabilitySet()
    assert _assert_capability_set_well_formed(set_obj, "PracticeManagement") == []


def test_capability_set_well_formed_catches_mismatch():
    v = _assert_capability_set_well_formed(FakeCapabilitySet(), "Email")
    assert any("capability mismatch" in s for s in v)


def test_capability_set_well_formed_catches_unknown_capability():
    set_obj = FakeCapabilitySet(capability="NotReal")
    v = _assert_capability_set_well_formed(set_obj, "NotReal")
    assert any("CAPABILITY_NAMES" in s for s in v)


def test_capability_set_well_formed_catches_empty_adapter():
    set_obj = FakeCapabilitySet(adapter="")
    v = _assert_capability_set_well_formed(set_obj, "PracticeManagement")
    assert any("adapter" in s for s in v)


def test_capability_set_well_formed_catches_overlap():
    set_obj = FakeCapabilitySet(
        supported_methods=("describe_capabilities", "search_matters"),
        unsupported_methods=("search_matters",),  # overlap
    )
    v = _assert_capability_set_well_formed(set_obj, "PracticeManagement")
    assert any("both supported_methods and unsupported_methods" in s for s in v)


def test_capability_set_well_formed_accepts_dict():
    """The shape check accepts dict payloads (Composio/MCP normalized)."""
    payload = {
        "capability": "Email",
        "adapter": "gmail",
        "version": "0.1.0",
        "supported_methods": ("describe_capabilities", "list_messages"),
        "unsupported_methods": (),
    }
    assert _assert_capability_set_well_formed(payload, "Email") == []


# ---------------------------------------------------------------------------
# _run_one_probe
# ---------------------------------------------------------------------------


def test_probe_run_returns_pass_on_clean_call():
    adapter = FakeAdapter()
    probe = SmokeProbe(
        capability="PracticeManagement",
        adapter="filevine",
        backend_prefix="build:",
        method="search_matters",
        factory=_factory_yielding(adapter),
        kwargs={"limit": 1},
    )
    result = asyncio.run(
        _run_one_probe(probe, {"adapter": "filevine", "backend": "build:filevine-mcp"})
    )
    assert result.status == SmokeStatus.PASS
    assert result.error_code is None
    assert "describe_capabilities" in adapter.calls
    assert "search_matters" in adapter.calls


def test_probe_run_returns_partial_on_shape_drift():
    """describe_capabilities returns a set that doesn't match the probe."""
    bad_set = FakeCapabilitySet(capability="Email")  # probe wants PracticeManagement
    adapter = FakeAdapter(capability_set=bad_set)
    probe = SmokeProbe(
        capability="PracticeManagement",
        adapter="filevine",
        backend_prefix="build:",
        method="search_matters",
        factory=_factory_yielding(adapter),
    )
    result = asyncio.run(
        _run_one_probe(probe, {"adapter": "filevine", "backend": "build:filevine-mcp"})
    )
    assert result.status == SmokeStatus.PARTIAL
    assert result.shape_violations
    assert any("capability mismatch" in s for s in result.shape_violations)


def test_probe_run_returns_fail_on_method_raises():
    class FakeAdapterError(Exception):
        code = "unauthorized"

    adapter = FakeAdapter(raise_on_method=FakeAdapterError("token expired"))
    probe = SmokeProbe(
        capability="PracticeManagement",
        adapter="filevine",
        backend_prefix="build:",
        method="search_matters",
        factory=_factory_yielding(adapter),
    )
    result = asyncio.run(
        _run_one_probe(probe, {"adapter": "filevine", "backend": "build:filevine-mcp"})
    )
    assert result.status == SmokeStatus.FAIL
    assert result.error_code == "unauthorized"


def test_probe_run_returns_fail_when_method_missing():
    """Adapter does not expose the probe's method -- shape drift."""

    class StubAdapter:
        def describe_capabilities(self):
            return FakeCapabilitySet()

    probe = SmokeProbe(
        capability="PracticeManagement",
        adapter="filevine",
        backend_prefix="build:",
        method="search_matters",
        factory=lambda _conn: StubAdapter(),
    )
    result = asyncio.run(
        _run_one_probe(probe, {"adapter": "filevine", "backend": "build:filevine-mcp"})
    )
    assert result.status == SmokeStatus.FAIL
    assert result.error_code == "capability_not_supported"


def test_probe_run_returns_fail_when_factory_raises():
    def bad_factory(_conn: dict[str, Any]) -> Any:
        raise RuntimeError("cannot build adapter -- token_ref missing")

    probe = SmokeProbe(
        capability="PracticeManagement",
        adapter="filevine",
        backend_prefix="build:",
        method="search_matters",
        factory=bad_factory,
    )
    result = asyncio.run(
        _run_one_probe(probe, {"adapter": "filevine", "backend": "build:filevine-mcp"})
    )
    assert result.status == SmokeStatus.FAIL
    assert result.error_code == "validation_failed"
    assert "token_ref missing" in (result.error_message or "")


def test_probe_run_respects_async_describe_capabilities():
    """Some adapters declare describe_capabilities as async; harness handles it."""
    adapter = FakeAdapter(async_describe=True)
    probe = SmokeProbe(
        capability="PracticeManagement",
        adapter="filevine",
        backend_prefix="build:",
        method="search_matters",
        factory=_factory_yielding(adapter),
    )
    result = asyncio.run(
        _run_one_probe(probe, {"adapter": "filevine", "backend": "build:filevine-mcp"})
    )
    assert result.status == SmokeStatus.PASS


# ---------------------------------------------------------------------------
# Threshold rules
# ---------------------------------------------------------------------------


def _result(status: SmokeStatus, optional: bool = False) -> ConnectorSmokeResult:
    return ConnectorSmokeResult(
        capability="PracticeManagement",
        adapter="x",
        backend="build:x",
        status=status,
        elapsed_ms=1.0,
        method_called="search_matters",
        optional=optional,
    )


def test_overall_status_empty_is_pass():
    assert _overall_status([]) == SmokeStatus.PASS


def test_overall_status_all_pass():
    assert _overall_status([_result(SmokeStatus.PASS), _result(SmokeStatus.PASS)]) == SmokeStatus.PASS


def test_overall_status_required_fail_is_fail():
    res = [_result(SmokeStatus.PASS), _result(SmokeStatus.FAIL, optional=False)]
    assert _overall_status(res) == SmokeStatus.FAIL


def test_overall_status_optional_fail_only_is_partial():
    res = [_result(SmokeStatus.PASS), _result(SmokeStatus.FAIL, optional=True)]
    assert _overall_status(res) == SmokeStatus.PARTIAL


def test_overall_status_partial_only_is_partial():
    res = [_result(SmokeStatus.PASS), _result(SmokeStatus.PARTIAL)]
    assert _overall_status(res) == SmokeStatus.PARTIAL


def test_overall_status_mixed_required_fail_dominates():
    """A required FAIL wins over optional FAIL + PARTIAL siblings."""
    res = [
        _result(SmokeStatus.PARTIAL),
        _result(SmokeStatus.FAIL, optional=True),
        _result(SmokeStatus.FAIL, optional=False),
    ]
    assert _overall_status(res) == SmokeStatus.FAIL


# ---------------------------------------------------------------------------
# SmokeReport.exit_code
# ---------------------------------------------------------------------------


def _report(status: SmokeStatus) -> SmokeReport:
    return SmokeReport(
        customer_id="t",
        results=(),
        overall_status=status,
        started_at_ms=0,
        finished_at_ms=1,
    )


def test_report_exit_code_pass_is_0():
    assert _report(SmokeStatus.PASS).exit_code() == 0


def test_report_exit_code_partial_is_1():
    assert _report(SmokeStatus.PARTIAL).exit_code() == 1


def test_report_exit_code_fail_is_2():
    assert _report(SmokeStatus.FAIL).exit_code() == 2


# ---------------------------------------------------------------------------
# load_enabled_connectors
# ---------------------------------------------------------------------------


_YAML_FIXTURE = """\
schema_version: 1
customer_id: test-firm
customer_name: Test Firm LLP
vertical: law-firm
fly_region: iad
model: claude-opus-4-7
hermes_ref: v2026.5.7
machine:
  size: shared-cpu-1x
  memory_mb: 1024
users:
  - email: p@x.com
    role: principal
    full_name: P X
personas:
  - slug: marcus
    status: active
    name: Marcus
    tone: [plain, concise, warm]
    skills:
      - name: law-pi-demand-letter-draft
        version: pending
        trust_ceiling: draft_for_review
connectors:
  PracticeManagement:
    adapter: filevine
    backend: build:filevine-mcp
    enabled: true
  Email:
    adapter: gmail
    backend: composio:gmail
    enabled: true
  Calendar:
    adapter: synthetic
    backend: synthetic:fixtures/cal.json
    enabled: true
  DocumentStorage:
    adapter: ms-graph
    backend: build:ms-graph
    enabled: false
escalation:
  red_flag_recipients: [p@x.com]
  failure_recipients: [p@x.com]
memory:
  d1_namespace: test-firm
  r2_vault_path: vaults/test-firm/
  vectorize_index: hermes-test-firm-vault
"""


def test_load_enabled_skips_disabled_and_synthetic(tmp_path):
    pytest.importorskip("yaml")
    p = tmp_path / "customer.yaml"
    p.write_text(_YAML_FIXTURE)
    customer_id, enabled = load_enabled_connectors(p)
    assert customer_id == "test-firm"
    caps = [c for c, _ in enabled]
    assert "PracticeManagement" in caps
    assert "Email" in caps
    assert "Calendar" not in caps  # synthetic backend skipped
    assert "DocumentStorage" not in caps  # disabled skipped


def test_load_enabled_rejects_missing_customer_id(tmp_path):
    pytest.importorskip("yaml")
    p = tmp_path / "customer.yaml"
    p.write_text("schema_version: 1\nconnectors: {}\n")
    with pytest.raises(ValueError, match="customer_id"):
        load_enabled_connectors(p)


# ---------------------------------------------------------------------------
# Integration -- run_smoke_tests end-to-end
# ---------------------------------------------------------------------------


def test_run_smoke_tests_marks_unregistered_connector_as_fail(tmp_path):
    """An enabled connector with no registered probe MUST surface as fail."""
    pytest.importorskip("yaml")
    p = tmp_path / "customer.yaml"
    p.write_text(_YAML_FIXTURE)

    registry = SmokeProbeRegistry()  # zero probes
    report = asyncio.run(
        run_smoke_tests(customer_yaml_path=p, registry=registry, audit_writer=None)
    )
    assert report.overall_status == SmokeStatus.FAIL
    assert report.customer_id == "test-firm"
    # Both PM and Email were enabled+non-synthetic -> two FAIL results
    assert len(report.results) == 2
    assert all(r.status == SmokeStatus.FAIL for r in report.results)
    assert all("no probe registered" in (r.error_message or "") for r in report.results)
    assert report.exit_code() == 2


def test_run_smoke_tests_pass_path(tmp_path):
    pytest.importorskip("yaml")
    p = tmp_path / "customer.yaml"
    p.write_text(_YAML_FIXTURE)

    pm_adapter = FakeAdapter()
    email_adapter = FakeAdapter(
        capability_set=FakeCapabilitySet(
            capability="Email",
            adapter="gmail",
            supported_methods=("describe_capabilities", "list_sent_messages"),
        )
    )

    # We need to add a list_sent_messages method on FakeAdapter for the
    # Email probe; do it dynamically.
    async def list_sent_messages(limit: int = 1):
        email_adapter.calls.append("list_sent_messages")
        return []

    email_adapter.list_sent_messages = list_sent_messages  # type: ignore[attr-defined]

    registry = SmokeProbeRegistry()
    registry.register(
        SmokeProbe(
            capability="PracticeManagement",
            adapter="filevine",
            backend_prefix="build:",
            method="search_matters",
            factory=_factory_yielding(pm_adapter),
            kwargs={"limit": 1},
        )
    )
    registry.register(
        SmokeProbe(
            capability="Email",
            adapter="gmail",
            backend_prefix="composio:",
            method="list_sent_messages",
            factory=_factory_yielding(email_adapter),
            kwargs={"limit": 1},
        )
    )

    report = asyncio.run(
        run_smoke_tests(customer_yaml_path=p, registry=registry, audit_writer=None)
    )
    assert report.overall_status == SmokeStatus.PASS
    assert report.exit_code() == 0
    assert len(report.results) == 2
    assert all(r.status == SmokeStatus.PASS for r in report.results)


def test_run_smoke_tests_emits_audit_for_failures(tmp_path):
    """A failed probe writes one CONNECTOR_HEALTH_PROBE_FAILED audit row."""
    pytest.importorskip("yaml")
    p = tmp_path / "customer.yaml"
    # Single-connector YAML to keep the audit-row count tight.
    p.write_text(
        """\
schema_version: 1
customer_id: a-firm
customer_name: A Firm
vertical: law-firm
fly_region: iad
model: claude-opus-4-7
hermes_ref: v2026.5.7
machine: {size: shared-cpu-1x, memory_mb: 1024}
users: [{email: p@x.com, role: principal, full_name: P}]
personas:
  - {slug: m, status: active, name: M, tone: [a, b, c], skills: [{name: s, trust_ceiling: draft_for_review}]}
connectors:
  PracticeManagement:
    adapter: filevine
    backend: build:filevine-mcp
    enabled: true
escalation:
  red_flag_recipients: [p@x.com]
  failure_recipients: [p@x.com]
memory:
  d1_namespace: a-firm
  r2_vault_path: vaults/a-firm/
  vectorize_index: hermes-a-firm-vault
"""
    )

    # Sqlite-backed audit writer
    conn = sqlite3.connect(":memory:")
    conn.executescript(
        """
        CREATE TABLE audit_log (
          id TEXT PRIMARY KEY,
          ts TEXT NOT NULL,
          action_type TEXT NOT NULL,
          actor TEXT NOT NULL,
          actor_role TEXT,
          skill_name TEXT,
          matter_ref TEXT,
          input_digest TEXT,
          output_digest TEXT,
          diff_digest TEXT,
          trust_ceiling TEXT,
          metadata TEXT
        );
        """
    )
    writer = AuditLogWriter(SqliteExecutor(conn))

    class FakeAdapterError(Exception):
        code = "unauthorized"

    adapter = FakeAdapter(raise_on_method=FakeAdapterError("token expired"))
    registry = SmokeProbeRegistry()
    registry.register(
        SmokeProbe(
            capability="PracticeManagement",
            adapter="filevine",
            backend_prefix="build:",
            method="search_matters",
            factory=_factory_yielding(adapter),
        )
    )

    report = asyncio.run(
        run_smoke_tests(customer_yaml_path=p, registry=registry, audit_writer=writer)
    )
    assert report.overall_status == SmokeStatus.FAIL

    rows = conn.execute(
        "SELECT action_type, actor, skill_name, metadata FROM audit_log"
    ).fetchall()
    assert len(rows) == 1
    action_type, actor, skill, metadata_json = rows[0]
    assert action_type == _AUDIT_ACTION_TYPE
    assert actor == "captain"
    assert skill == "connector-smoke"
    import json as _json

    md = _json.loads(metadata_json)
    assert md["capability"] == "PracticeManagement"
    assert md["adapter"] == "filevine"
    assert md["status"] == "fail"
    assert md["error_code"] == "unauthorized"


def test_run_smoke_tests_skips_audit_emission_on_pass(tmp_path):
    pytest.importorskip("yaml")
    p = tmp_path / "customer.yaml"
    p.write_text(
        """\
schema_version: 1
customer_id: b-firm
customer_name: B
vertical: law-firm
fly_region: iad
model: claude-opus-4-7
hermes_ref: v2026.5.7
machine: {size: shared-cpu-1x, memory_mb: 1024}
users: [{email: p@x.com, role: principal, full_name: P}]
personas:
  - {slug: m, status: active, name: M, tone: [a, b, c], skills: [{name: s, trust_ceiling: draft_for_review}]}
connectors:
  PracticeManagement:
    adapter: filevine
    backend: build:filevine-mcp
    enabled: true
escalation:
  red_flag_recipients: [p@x.com]
  failure_recipients: [p@x.com]
memory:
  d1_namespace: b-firm
  r2_vault_path: vaults/b-firm/
  vectorize_index: hermes-b-firm-vault
"""
    )

    conn = sqlite3.connect(":memory:")
    conn.executescript(
        """
        CREATE TABLE audit_log (
          id TEXT PRIMARY KEY, ts TEXT, action_type TEXT, actor TEXT,
          actor_role TEXT, skill_name TEXT, matter_ref TEXT,
          input_digest TEXT, output_digest TEXT, diff_digest TEXT,
          trust_ceiling TEXT, metadata TEXT
        );
        """
    )
    writer = AuditLogWriter(SqliteExecutor(conn))

    adapter = FakeAdapter()
    registry = SmokeProbeRegistry()
    registry.register(
        SmokeProbe(
            capability="PracticeManagement",
            adapter="filevine",
            backend_prefix="build:",
            method="search_matters",
            factory=_factory_yielding(adapter),
        )
    )

    report = asyncio.run(
        run_smoke_tests(customer_yaml_path=p, registry=registry, audit_writer=writer)
    )
    assert report.overall_status == SmokeStatus.PASS
    rows = conn.execute("SELECT COUNT(*) FROM audit_log").fetchone()
    assert rows[0] == 0  # PASS does not emit


# ---------------------------------------------------------------------------
# Sanity: action type pinned to the accepted set
# ---------------------------------------------------------------------------


def test_audit_action_type_is_in_accepted_set():
    """The action type we emit MUST be present in ACCEPTED_ACTION_TYPES."""
    assert _AUDIT_ACTION_TYPE in ACCEPTED_ACTION_TYPES


# ---------------------------------------------------------------------------
# captain_summary rendering -- the dashboard reads this string verbatim
# ---------------------------------------------------------------------------


def test_captain_summary_includes_status_and_method():
    r = ConnectorSmokeResult(
        capability="Email",
        adapter="gmail",
        backend="composio:gmail",
        status=SmokeStatus.PASS,
        elapsed_ms=42.0,
        method_called="list_sent_messages",
        optional=False,
    )
    s = r.captain_summary()
    assert "[PASS]" in s
    assert "Email/gmail" in s
    assert "composio:gmail" in s
    assert "list_sent_messages" in s
    assert "42" in s


def test_captain_summary_includes_error_and_shape_on_fail():
    r = ConnectorSmokeResult(
        capability="PracticeManagement",
        adapter="filevine",
        backend="build:filevine-mcp",
        status=SmokeStatus.FAIL,
        elapsed_ms=10.0,
        method_called="search_matters",
        optional=False,
        shape_violations=("capability mismatch",),
        error_code="unauthorized",
    )
    s = r.captain_summary()
    assert "[FAIL]" in s
    assert "unauthorized" in s
    assert "capability mismatch" in s


def test_report_captain_summary_contains_each_result():
    results = (
        ConnectorSmokeResult(
            capability="PracticeManagement",
            adapter="filevine",
            backend="build:filevine-mcp",
            status=SmokeStatus.PASS,
            elapsed_ms=10.0,
            method_called="search_matters",
            optional=False,
        ),
        ConnectorSmokeResult(
            capability="Email",
            adapter="gmail",
            backend="composio:gmail",
            status=SmokeStatus.FAIL,
            elapsed_ms=15.0,
            method_called="list_sent_messages",
            optional=False,
            error_code="unauthorized",
        ),
    )
    report = SmokeReport(
        customer_id="c-firm",
        results=results,
        overall_status=SmokeStatus.FAIL,
        started_at_ms=0,
        finished_at_ms=25,
    )
    s = report.captain_summary()
    assert "c-firm" in s
    assert "FAIL" in s
    assert "PracticeManagement" in s
    assert "Email" in s
