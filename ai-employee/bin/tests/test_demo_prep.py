"""Tests for ai-employee/bin/lib/demo_prep.py (issue #819).

Coverage:

* Slug guards -- empty / template-prefixed / regex-violating slugs raise
  ``DemoPrepPreflightError`` and never reach the file system.
* Preflight -- missing customer dir / missing customer.yaml raise
  preflight errors mapped to CLI exit 2.
* customer.yaml check -- schema_version, customer_id-matches-slug,
  vertical=law-firm, persona presence, connector presence, memory
  isolation invariants.
* Voice samples -- counts files recursively, hidden files skipped,
  defaults to ``customers/{slug}/voice/``, honors
  ``voice_library.local_samples_path``.
* Memory + voice ingestion -- passes when at least one source_state row
  has ingest_status='ok'; fails when no rows or errored rows; SKIPs
  when no reader is wired.
* Connector smoke -- synthetic backend = no-PM PASS; filevine = invokes
  ``ConnectorSmokeRunner`` and surfaces its result; other adapters =
  SKIP.
* Synthetic matter -- per-customer fixtures dir takes precedence;
  customer.yaml ``demo.matter_fixture`` resolves against allow-listed
  roots; path-traversal attempts are rejected.
* Idempotency -- re-running the runner produces the same report.
* Reporter + exit code helpers.

No external services are reached. The CLI invocation is exercised end-
to-end against a tmp_path customer directory.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

import pytest

_HERE = Path(__file__).resolve()
# ai-employee/ on sys.path so `from bin.lib.demo_prep import ...` resolves.
sys.path.insert(0, str(_HERE.parents[2]))

from bin.lib import demo_prep  # noqa: E402
from bin.lib.demo_prep import (  # noqa: E402
    CheckStatus,
    DemoPrepPreflightError,
    DemoPrepRunner,
    MIN_VOICE_SAMPLES,
    NoOpConnectorSmoke,
    is_template_slug,
    is_valid_slug,
    overall_exit_code,
    render_report,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _yaml_dump(data: dict) -> str:
    """Render a dict to a yaml-compatible string without requiring pyyaml."""
    # The fixture customer.yaml shape is small; render by hand so the
    # tests run on systems without pyyaml. The demo_prep loader uses
    # yaml.safe_load, which is satisfied by a strict YAML subset.
    import yaml
    return yaml.safe_dump(data, sort_keys=False)


def _base_customer_yaml(slug: str) -> dict:
    """Minimal valid-shape customer.yaml dict for the PI firm flow."""
    return {
        "schema_version": 1,
        "customer_id": slug,
        "customer_name": f"Test firm for {slug}",
        "vertical": "law-firm",
        "practice_areas": ["personal-injury-plaintiff"],
        "fly_region": "iad",
        "model": "claude-opus-4-7",
        "hermes_ref": "v2026.5.7",
        "machine": {"size": "shared-cpu-1x", "memory_mb": 1024},
        "users": [
            {"email": "principal@example.test", "role": "principal", "full_name": "Jane Principal"}
        ],
        "personas": [
            {
                "slug": "marcus",
                "status": "active",
                "name": "Marcus",
                "tone": ["plainspoken", "warm-but-professional", "concise"],
                "skills": [
                    {
                        "name": "law-pi-demand-letter-draft",
                        "version": "pending",
                        "trust_ceiling": "draft_for_review",
                        "enabled": True,
                    }
                ],
            }
        ],
        "connectors": {
            "PracticeManagement": {
                "adapter": "synthetic",
                "backend": "synthetic:fixture",
                "enabled": True,
            },
            "Email": {
                "adapter": "synthetic",
                "backend": "synthetic:fixture",
                "enabled": True,
            },
        },
        "scope": {
            "email_folders_visible": ["Inbox"],
            "email_folders_blind": [],
            "email_keyword_blocks": [],
            "domain_blocks": [],
        },
        "escalation": {
            "red_flag_recipients": ["principal@example.test"],
            "failure_recipients": ["principal@example.test"],
        },
        "memory": {
            "d1_namespace": slug,
            "r2_vault_path": f"vaults/{slug}/",
            "vectorize_index": f"hermes-{slug}-vault",
        },
    }


def _seed_customer(
    customers_root: Path,
    slug: str,
    *,
    yaml_override: Optional[dict] = None,
    voice_count: int = MIN_VOICE_SAMPLES,
    seed_fixture: bool = True,
    state_rows: Optional[dict] = None,
) -> Path:
    """Materializes a complete customer directory under ``customers_root``.

    The defaults satisfy every demo-prep check so individual tests can
    flip one knob and assert the corresponding failure.
    """
    customer_dir = customers_root / slug
    customer_dir.mkdir(parents=True)

    yaml_path = customer_dir / "customer.yaml"
    data = yaml_override if yaml_override is not None else _base_customer_yaml(slug)
    yaml_path.write_text(_yaml_dump(data), encoding="utf-8")

    voice_dir = customer_dir / "voice"
    voice_dir.mkdir(parents=True)
    for i in range(voice_count):
        (voice_dir / f"sample-{i:02d}.json").write_text(
            json.dumps({"id": f"sample-{i:02d}"}), encoding="utf-8"
        )

    if seed_fixture:
        fixtures_dir = customer_dir / "fixtures"
        fixtures_dir.mkdir(parents=True)
        (fixtures_dir / "synthetic-matter.json").write_text(
            json.dumps({"matter_id": "syn-001", "client": "Doe, John"}), encoding="utf-8"
        )

    if state_rows is not None:
        (customer_dir / ".demo-prep-state.json").write_text(
            json.dumps(state_rows), encoding="utf-8"
        )

    return customer_dir


# ---------------------------------------------------------------------------
# Stub readers + smoke runners
# ---------------------------------------------------------------------------


class _StaticMemoryReader:
    def __init__(self, rows: list[dict]) -> None:
        self._rows = rows
        self.calls = 0

    def read(self, customer_slug: str) -> list[dict]:
        self.calls += 1
        return list(self._rows)


class _StaticVoiceReader(_StaticMemoryReader):
    pass


class _FailingConnectorSmoke:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def smoke(self, customer_slug: str) -> dict:
        self.calls.append(customer_slug)
        return {"ok": False, "detail": {"reason": "fake_failure"}}


class _PassingConnectorSmoke:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def smoke(self, customer_slug: str) -> dict:
        self.calls.append(customer_slug)
        return {"ok": True, "detail": {"matters_fetched": 3}}


# ---------------------------------------------------------------------------
# Tests: slug guards
# ---------------------------------------------------------------------------


def test_is_template_slug_recognizes_underscore_prefix():
    assert is_template_slug("_template") is True
    assert is_template_slug("_anything") is True
    assert is_template_slug("real-firm") is False
    assert is_template_slug("") is False


def test_is_valid_slug_matches_schema_regex():
    assert is_valid_slug("smd") is True
    assert is_valid_slug("doe-pi-law") is True
    assert is_valid_slug("9-livesmcconnell") is True
    assert is_valid_slug("") is False
    assert is_valid_slug("-leading-dash") is False
    assert is_valid_slug("UPPERCASE") is False
    assert is_valid_slug("has space") is False
    assert is_valid_slug("a" * 33) is False  # 32 char limit


def test_runner_rejects_template_slug(tmp_path):
    with pytest.raises(DemoPrepPreflightError, match="reserved template slug"):
        DemoPrepRunner(customer_slug="_template", customers_root=tmp_path)


def test_runner_rejects_invalid_slug(tmp_path):
    with pytest.raises(DemoPrepPreflightError, match="does not match"):
        DemoPrepRunner(customer_slug="Bad Slug", customers_root=tmp_path)


def test_runner_rejects_empty_slug(tmp_path):
    with pytest.raises(DemoPrepPreflightError, match="must be a non-empty string"):
        DemoPrepRunner(customer_slug="", customers_root=tmp_path)


# ---------------------------------------------------------------------------
# Tests: preflight
# ---------------------------------------------------------------------------


def test_run_raises_when_customer_dir_missing(tmp_path):
    runner = DemoPrepRunner(customer_slug="ghost", customers_root=tmp_path)
    with pytest.raises(DemoPrepPreflightError, match="customer dir not found"):
        runner.run()


def test_run_raises_when_customer_yaml_missing(tmp_path):
    (tmp_path / "ghost").mkdir()
    runner = DemoPrepRunner(customer_slug="ghost", customers_root=tmp_path)
    with pytest.raises(DemoPrepPreflightError, match="customer.yaml not found"):
        runner.run()


def test_run_raises_when_yaml_is_not_a_mapping(tmp_path):
    (tmp_path / "ghost").mkdir()
    (tmp_path / "ghost" / "customer.yaml").write_text("- just\n- a\n- list\n", encoding="utf-8")
    runner = DemoPrepRunner(customer_slug="ghost", customers_root=tmp_path)
    with pytest.raises(DemoPrepPreflightError, match="must parse to a mapping"):
        runner.run()


# ---------------------------------------------------------------------------
# Tests: customer.yaml check
# ---------------------------------------------------------------------------


def test_customer_yaml_passes_on_well_formed_input(tmp_path):
    _seed_customer(tmp_path, "demo-firm")
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    yaml_check = next(r for r in results if r.name == "01_customer_yaml")
    assert yaml_check.status == CheckStatus.PASS
    assert yaml_check.detail["schema_version"] == 1


def test_customer_yaml_fails_when_id_mismatches_slug(tmp_path):
    data = _base_customer_yaml("demo-firm")
    data["customer_id"] = "wrong-id"
    _seed_customer(tmp_path, "demo-firm", yaml_override=data)
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    yaml_check = next(r for r in results if r.name == "01_customer_yaml")
    assert yaml_check.status == CheckStatus.FAIL
    assert any("customer_id" in p for p in yaml_check.detail["problems"])


def test_customer_yaml_fails_when_vertical_is_wrong(tmp_path):
    data = _base_customer_yaml("demo-firm")
    data["vertical"] = "marketing-agency"
    _seed_customer(tmp_path, "demo-firm", yaml_override=data)
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    yaml_check = next(r for r in results if r.name == "01_customer_yaml")
    assert yaml_check.status == CheckStatus.FAIL
    assert any("vertical" in p for p in yaml_check.detail["problems"])


def test_customer_yaml_fails_when_no_active_persona(tmp_path):
    data = _base_customer_yaml("demo-firm")
    data["personas"] = [{"slug": "marcus", "status": "archived", "name": "Marcus", "tone": ["x"], "skills": []}]
    _seed_customer(tmp_path, "demo-firm", yaml_override=data)
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    yaml_check = next(r for r in results if r.name == "01_customer_yaml")
    assert yaml_check.status == CheckStatus.FAIL
    assert any("active" in p for p in yaml_check.detail["problems"])


def test_customer_yaml_fails_on_memory_namespace_drift(tmp_path):
    data = _base_customer_yaml("demo-firm")
    data["memory"]["d1_namespace"] = "different-namespace"
    _seed_customer(tmp_path, "demo-firm", yaml_override=data)
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    yaml_check = next(r for r in results if r.name == "01_customer_yaml")
    assert yaml_check.status == CheckStatus.FAIL
    assert any("d1_namespace" in p for p in yaml_check.detail["problems"])


# ---------------------------------------------------------------------------
# Tests: voice sample check
# ---------------------------------------------------------------------------


def test_voice_samples_passes_at_minimum(tmp_path):
    _seed_customer(tmp_path, "demo-firm", voice_count=MIN_VOICE_SAMPLES)
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    voice_check = next(r for r in results if r.name == "02_voice_samples")
    assert voice_check.status == CheckStatus.PASS
    assert voice_check.detail["sample_count"] == MIN_VOICE_SAMPLES


def test_voice_samples_fails_below_minimum(tmp_path):
    _seed_customer(tmp_path, "demo-firm", voice_count=3)
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    voice_check = next(r for r in results if r.name == "02_voice_samples")
    assert voice_check.status == CheckStatus.FAIL
    assert voice_check.detail["sample_count"] == 3
    assert voice_check.detail["required_minimum"] == MIN_VOICE_SAMPLES


def test_voice_samples_skips_hidden_files(tmp_path):
    customer_dir = _seed_customer(tmp_path, "demo-firm", voice_count=MIN_VOICE_SAMPLES)
    # A hidden file in the voice tree should not count.
    (customer_dir / "voice" / ".DS_Store").write_text("noise", encoding="utf-8")
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    voice_check = next(r for r in results if r.name == "02_voice_samples")
    assert voice_check.detail["sample_count"] == MIN_VOICE_SAMPLES


def test_voice_samples_honors_local_samples_path(tmp_path):
    data = _base_customer_yaml("demo-firm")
    data["voice_library"] = {"local_samples_path": "custom-voice-dir"}
    customer_dir = _seed_customer(
        tmp_path, "demo-firm", yaml_override=data, voice_count=0
    )
    # Default voice/ has nothing; custom-voice-dir has enough.
    custom_dir = customer_dir / "custom-voice-dir"
    custom_dir.mkdir()
    for i in range(MIN_VOICE_SAMPLES):
        (custom_dir / f"sample-{i:02d}.json").write_text("{}", encoding="utf-8")
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    voice_check = next(r for r in results if r.name == "02_voice_samples")
    assert voice_check.status == CheckStatus.PASS
    assert "custom-voice-dir" in voice_check.detail["voice_dir"]


def test_voice_samples_respects_min_override(tmp_path):
    _seed_customer(tmp_path, "demo-firm", voice_count=3)
    runner = DemoPrepRunner(
        customer_slug="demo-firm",
        customers_root=tmp_path,
        min_voice_samples=3,
    )
    results = runner.run()
    voice_check = next(r for r in results if r.name == "02_voice_samples")
    assert voice_check.status == CheckStatus.PASS


# ---------------------------------------------------------------------------
# Tests: memory + voice ingestion checks
# ---------------------------------------------------------------------------


def test_memory_ingestion_skips_when_no_reader(tmp_path):
    _seed_customer(tmp_path, "demo-firm")
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    mem_check = next(r for r in results if r.name == "03_memory_ingestion")
    assert mem_check.status == CheckStatus.SKIP
    voice_check = next(r for r in results if r.name == "04_voice_ingestion")
    assert voice_check.status == CheckStatus.SKIP


def test_memory_ingestion_passes_when_ok_row_present(tmp_path):
    _seed_customer(tmp_path, "demo-firm")
    runner = DemoPrepRunner(
        customer_slug="demo-firm",
        customers_root=tmp_path,
        memory_reader=_StaticMemoryReader([
            {"source_kind": "practice_management", "source_id": "synthetic", "ingest_status": "ok"},
        ]),
        voice_reader=_StaticVoiceReader([
            {"source_kind": "email", "source_id": "synthetic", "ingest_status": "ok"},
        ]),
    )
    results = runner.run()
    mem_check = next(r for r in results if r.name == "03_memory_ingestion")
    voice_check = next(r for r in results if r.name == "04_voice_ingestion")
    assert mem_check.status == CheckStatus.PASS
    assert voice_check.status == CheckStatus.PASS


def test_memory_ingestion_fails_when_snapshot_is_empty(tmp_path):
    # An explicit empty list (snapshot exists but has no rows) is a
    # real failure: the pipeline ran and produced nothing. Distinct
    # from None (no snapshot at all), which is SKIP.
    _seed_customer(tmp_path, "demo-firm")
    runner = DemoPrepRunner(
        customer_slug="demo-firm",
        customers_root=tmp_path,
        memory_reader=_StaticMemoryReader([]),
        voice_reader=_StaticVoiceReader([]),
    )
    results = runner.run()
    mem_check = next(r for r in results if r.name == "03_memory_ingestion")
    voice_check = next(r for r in results if r.name == "04_voice_ingestion")
    assert mem_check.status == CheckStatus.FAIL
    assert voice_check.status == CheckStatus.FAIL


def test_memory_ingestion_fails_on_errored_status(tmp_path):
    _seed_customer(tmp_path, "demo-firm")
    runner = DemoPrepRunner(
        customer_slug="demo-firm",
        customers_root=tmp_path,
        memory_reader=_StaticMemoryReader([
            {"source_kind": "pm", "source_id": "synthetic", "ingest_status": "error"},
        ]),
        voice_reader=_StaticVoiceReader([
            {"source_kind": "email", "source_id": "synthetic", "ingest_status": "error"},
        ]),
    )
    results = runner.run()
    mem_check = next(r for r in results if r.name == "03_memory_ingestion")
    voice_check = next(r for r in results if r.name == "04_voice_ingestion")
    assert mem_check.status == CheckStatus.FAIL
    assert voice_check.status == CheckStatus.FAIL


def test_filesystem_memory_reader_reads_state_snapshot(tmp_path):
    state = {
        "memory_source_state": [
            {"source_kind": "practice_management", "source_id": "synthetic", "ingest_status": "ok"}
        ],
        "voice_source_state": [
            {"source_kind": "email", "source_id": "synthetic", "ingest_status": "ok"}
        ],
    }
    customer_dir = _seed_customer(tmp_path, "demo-firm", state_rows=state)
    memory_reader = demo_prep.FilesystemMemoryReader(customer_dir)
    voice_reader = demo_prep.FilesystemVoiceReader(customer_dir)
    assert memory_reader.read("demo-firm")[0]["ingest_status"] == "ok"
    assert voice_reader.read("demo-firm")[0]["ingest_status"] == "ok"


def test_filesystem_reader_returns_none_when_no_snapshot(tmp_path):
    customer_dir = _seed_customer(tmp_path, "demo-firm")
    memory_reader = demo_prep.FilesystemMemoryReader(customer_dir)
    # No snapshot -- distinguishable from "snapshot present but empty".
    assert memory_reader.read("demo-firm") is None


def test_filesystem_reader_tolerates_bad_json(tmp_path):
    customer_dir = _seed_customer(tmp_path, "demo-firm")
    (customer_dir / ".demo-prep-state.json").write_text("not json {", encoding="utf-8")
    memory_reader = demo_prep.FilesystemMemoryReader(customer_dir)
    assert memory_reader.read("demo-firm") is None


def test_filesystem_reader_returns_empty_list_when_snapshot_explicitly_empty(tmp_path):
    customer_dir = _seed_customer(
        tmp_path, "demo-firm", state_rows={"memory_source_state": []}
    )
    memory_reader = demo_prep.FilesystemMemoryReader(customer_dir)
    # Snapshot present, no rows -- distinguishable from "no snapshot".
    assert memory_reader.read("demo-firm") == []


def test_memory_check_skips_when_reader_returns_none(tmp_path):
    customer_dir = _seed_customer(tmp_path, "demo-firm")
    # FilesystemMemoryReader returns None when no .demo-prep-state.json.
    runner = DemoPrepRunner(
        customer_slug="demo-firm",
        customers_root=tmp_path,
        memory_reader=demo_prep.FilesystemMemoryReader(customer_dir),
        voice_reader=demo_prep.FilesystemVoiceReader(customer_dir),
    )
    results = runner.run()
    mem_check = next(r for r in results if r.name == "03_memory_ingestion")
    voice_check = next(r for r in results if r.name == "04_voice_ingestion")
    assert mem_check.status == CheckStatus.SKIP
    assert voice_check.status == CheckStatus.SKIP


# ---------------------------------------------------------------------------
# Tests: connector smoke
# ---------------------------------------------------------------------------


def test_connector_smoke_passes_for_synthetic_no_pm(tmp_path):
    # The default _base_customer_yaml uses adapter=synthetic, which
    # is the no-PM angle. The smoke runner is never called.
    _seed_customer(tmp_path, "demo-firm")
    fail_runner = _FailingConnectorSmoke()
    runner = DemoPrepRunner(
        customer_slug="demo-firm",
        customers_root=tmp_path,
        connector_smoke=fail_runner,
    )
    results = runner.run()
    conn_check = next(r for r in results if r.name == "05_connector_smoke")
    assert conn_check.status == CheckStatus.PASS
    assert conn_check.detail["shape"] == "no_pm"
    assert fail_runner.calls == []  # synthetic short-circuits


def test_connector_smoke_passes_for_filevine_when_runner_ok(tmp_path):
    data = _base_customer_yaml("demo-firm")
    data["connectors"]["PracticeManagement"] = {
        "adapter": "filevine",
        "backend": "build:filevine",
        "enabled": True,
    }
    _seed_customer(tmp_path, "demo-firm", yaml_override=data)
    pass_runner = _PassingConnectorSmoke()
    runner = DemoPrepRunner(
        customer_slug="demo-firm",
        customers_root=tmp_path,
        connector_smoke=pass_runner,
    )
    results = runner.run()
    conn_check = next(r for r in results if r.name == "05_connector_smoke")
    assert conn_check.status == CheckStatus.PASS
    assert conn_check.detail["shape"] == "filevine"
    assert pass_runner.calls == ["demo-firm"]


def test_connector_smoke_fails_for_filevine_when_runner_fails(tmp_path):
    data = _base_customer_yaml("demo-firm")
    data["connectors"]["PracticeManagement"] = {
        "adapter": "filevine",
        "backend": "build:filevine",
        "enabled": True,
    }
    _seed_customer(tmp_path, "demo-firm", yaml_override=data)
    runner = DemoPrepRunner(
        customer_slug="demo-firm",
        customers_root=tmp_path,
        connector_smoke=_FailingConnectorSmoke(),
    )
    results = runner.run()
    conn_check = next(r for r in results if r.name == "05_connector_smoke")
    assert conn_check.status == CheckStatus.FAIL
    assert conn_check.detail["shape"] == "filevine"


def test_connector_smoke_skips_for_other_pm_adapters(tmp_path):
    data = _base_customer_yaml("demo-firm")
    data["connectors"]["PracticeManagement"] = {
        "adapter": "clio",
        "backend": "composio:clio",
        "enabled": True,
    }
    _seed_customer(tmp_path, "demo-firm", yaml_override=data)
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    conn_check = next(r for r in results if r.name == "05_connector_smoke")
    assert conn_check.status == CheckStatus.SKIP


def test_noop_connector_smoke_always_returns_ok_skipped():
    stub = NoOpConnectorSmoke()
    result = stub.smoke("demo-firm")
    assert result["ok"] is True
    assert result["detail"]["skipped"] is True


# ---------------------------------------------------------------------------
# Tests: synthetic matter fixture
# ---------------------------------------------------------------------------


def test_synthetic_matter_passes_when_per_customer_fixture_present(tmp_path):
    _seed_customer(tmp_path, "demo-firm", seed_fixture=True)
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    fix_check = next(r for r in results if r.name == "06_synthetic_matter")
    assert fix_check.status == CheckStatus.PASS
    assert fix_check.detail["shape"] == "per_customer_fixture_dir"


def test_synthetic_matter_fails_when_no_fixture_present(tmp_path):
    _seed_customer(tmp_path, "demo-firm", seed_fixture=False)
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    fix_check = next(r for r in results if r.name == "06_synthetic_matter")
    assert fix_check.status == CheckStatus.FAIL


def test_synthetic_matter_resolves_via_yaml_demo_matter_fixture(tmp_path):
    data = _base_customer_yaml("demo-firm")
    data["demo"] = {"matter_fixture": "law-firm/synthetic-matter.json"}
    _seed_customer(tmp_path, "demo-firm", yaml_override=data, seed_fixture=False)
    fixture_root = tmp_path / "fixtures"
    (fixture_root / "law-firm").mkdir(parents=True)
    (fixture_root / "law-firm" / "synthetic-matter.json").write_text("{}", encoding="utf-8")
    runner = DemoPrepRunner(
        customer_slug="demo-firm",
        customers_root=tmp_path,
        fixture_roots=(fixture_root,),
    )
    results = runner.run()
    fix_check = next(r for r in results if r.name == "06_synthetic_matter")
    assert fix_check.status == CheckStatus.PASS
    assert fix_check.detail["shape"] == "customer_yaml_demo_fixture"


def test_synthetic_matter_rejects_path_traversal_in_yaml(tmp_path):
    data = _base_customer_yaml("demo-firm")
    data["demo"] = {"matter_fixture": "../../etc/passwd"}
    _seed_customer(tmp_path, "demo-firm", yaml_override=data, seed_fixture=False)
    fixture_root = tmp_path / "fixtures"
    fixture_root.mkdir(parents=True)
    runner = DemoPrepRunner(
        customer_slug="demo-firm",
        customers_root=tmp_path,
        fixture_roots=(fixture_root,),
    )
    results = runner.run()
    fix_check = next(r for r in results if r.name == "06_synthetic_matter")
    assert fix_check.status == CheckStatus.FAIL


# ---------------------------------------------------------------------------
# Tests: idempotency
# ---------------------------------------------------------------------------


def test_runner_is_idempotent(tmp_path):
    _seed_customer(tmp_path, "demo-firm")
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    first = runner.run()
    second = runner.run()
    # Same step names + statuses on both runs.
    assert [(r.name, r.status) for r in first] == [(r.name, r.status) for r in second]


# ---------------------------------------------------------------------------
# Tests: report + exit code
# ---------------------------------------------------------------------------


def test_render_report_includes_per_check_lines_and_summary(tmp_path):
    _seed_customer(tmp_path, "demo-firm")
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    report = render_report(results, customer_slug="demo-firm")
    for r in results:
        assert r.name in report
    assert "summary:" in report


def test_overall_exit_code_zero_on_full_pass(tmp_path):
    _seed_customer(tmp_path, "demo-firm")
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    assert overall_exit_code(results) == 0


def test_overall_exit_code_three_on_check_failure(tmp_path):
    _seed_customer(tmp_path, "demo-firm", voice_count=0)
    runner = DemoPrepRunner(customer_slug="demo-firm", customers_root=tmp_path)
    results = runner.run()
    assert overall_exit_code(results) == 3


# ---------------------------------------------------------------------------
# Tests: CLI entrypoint
# ---------------------------------------------------------------------------


def test_cli_main_returns_zero_on_pass(tmp_path, capsys, monkeypatch):
    customers_root = tmp_path / "customers"
    _seed_customer(customers_root, "demo-firm")

    from bin.lib import demo_prep_cli

    exit_code = demo_prep_cli.main(
        [
            "--firm-slug",
            "demo-firm",
            "--customers-root",
            str(customers_root),
            "--fixture-root",
            str(tmp_path / "fixtures-extra"),
        ]
    )
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "demo-firm" in out
    assert "01_customer_yaml" in out


def test_cli_main_returns_two_on_preflight_fail(tmp_path, capsys):
    customers_root = tmp_path / "customers"
    customers_root.mkdir()

    from bin.lib import demo_prep_cli

    exit_code = demo_prep_cli.main(
        [
            "--firm-slug",
            "_template",
            "--customers-root",
            str(customers_root),
        ]
    )
    assert exit_code == 2
    err = capsys.readouterr().err
    assert "PREFLIGHT FAIL" in err


def test_cli_main_returns_three_on_check_fail(tmp_path, capsys):
    customers_root = tmp_path / "customers"
    _seed_customer(customers_root, "demo-firm", voice_count=0)

    from bin.lib import demo_prep_cli

    exit_code = demo_prep_cli.main(
        [
            "--firm-slug",
            "demo-firm",
            "--customers-root",
            str(customers_root),
        ]
    )
    assert exit_code == 3


# ---------------------------------------------------------------------------
# Tests: template directory is a clean scaffold
# ---------------------------------------------------------------------------


def test_template_directory_exists_with_required_files():
    aie_root = _HERE.parents[2]
    template_dir = aie_root / "customers" / "_template"
    assert template_dir.is_dir(), "template directory is the canonical scaffold"
    assert (template_dir / "dossier.md").is_file()
    assert (template_dir / "customer.yaml").is_file()
    assert (template_dir / "README.md").is_file()


def test_template_dossier_has_required_sections():
    aie_root = _HERE.parents[2]
    dossier = (aie_root / "customers" / "_template" / "dossier.md").read_text(encoding="utf-8")
    # Each numbered section from the issue's dossier shape must be
    # present so Captain has a slot for every required field.
    for header in [
        "## 1. Firm identity",
        "## 2. Partners and decision-makers",
        "## 3. Practice areas",
        "## 4. Recent matters and settlements",
        "## 5. Voice signature",
        "## 6. Hypothesized practice-management stack",
        "## 7. Decision-makers and influencers",
        "## 8. Demo angle",
        "## 9. Pre-meeting checklist",
    ]:
        assert header in dossier, f"dossier missing required header: {header}"


def test_template_customer_yaml_parses_after_slug_substitution():
    # Confirms the template is a syntactically valid YAML doc once the
    # bracketed slug placeholders are substituted with a real slug.
    import yaml

    aie_root = _HERE.parents[2]
    raw = (aie_root / "customers" / "_template" / "customer.yaml").read_text(encoding="utf-8")
    substituted = raw.replace("[FIRM-SLUG]", "demo-firm")
    data = yaml.safe_load(substituted)
    assert isinstance(data, dict)
    assert data["schema_version"] == 1
    assert data["vertical"] == "law-firm"
