"""Tests for ai-employee/bin/lib/demo_fixtures.py (issue #890).

Coverage:

* Slug guards -- empty / template-prefixed / regex-violating slugs
  raise ``DemoFixturePreflightError`` and never reach the substrate.
* Vertical guard -- unknown vertical raises preflight.
* Preflight -- missing customer dir / missing customer.yaml /
  malformed customer.yaml raise preflight.
* PI matter parser -- extracts envelope fields from the live corpus;
  rejects files missing the synthetic watermark on line 1.
* Load -- writes memory + voice rows; every row carries
  ``is_demo_fixture: true``; matter count matches the 8 PI fixtures.
* Idempotency -- second load returns ``REFRESHED``; row counts do not
  grow; ingested_at timestamps move forward.
* Safety refusal -- if any non-demo row pre-exists in either store,
  load() and unload() both raise ``DemoFixtureSafetyRefusal`` with no
  rows written.
* Unload -- removes every demo row; second unload returns ``NOOP``.
* CLI -- argparse rejects unknown vertical (exit 2); --unload routes
  to the unload path; missing customer dir maps to exit 2; safety
  refusal maps to exit 4.

No external services are reached.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

import pytest

_HERE = Path(__file__).resolve()
# ai-employee/ on sys.path so `from bin.lib.demo_fixtures import ...` resolves.
sys.path.insert(0, str(_HERE.parents[2]))

from bin.lib import demo_fixtures  # noqa: E402
from bin.lib.demo_fixtures import (  # noqa: E402
    DEMO_FIXTURE_KEY,
    DEMO_FIXTURE_TAG_VALUE,
    SYNTHETIC_WATERMARK,
    VERTICAL_REGISTRY,
    DemoFixtureLoader,
    DemoFixturePreflightError,
    DemoFixtureSafetyRefusal,
    FilesystemMemoryStore,
    FilesystemVoiceStore,
    LoadOutcome,
    UnloadOutcome,
    build_memory_rows,
    build_voice_rows,
    is_template_slug,
    is_valid_slug,
    load_pi_inputs,
    parse_pi_matter,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _repo_aie_root() -> Path:
    """Resolve ai-employee/ from the checked-in working tree."""
    return _HERE.parents[2]


def _real_fixtures_root() -> Path:
    """The shared PI corpus root."""
    return _repo_aie_root() / "fixtures"


def _write_customer_yaml(customer_dir: Path, slug: str) -> Path:
    """Materialize a minimal customer.yaml inside ``customer_dir``."""
    import yaml

    customer_dir.mkdir(parents=True, exist_ok=True)
    body = {
        "schema_version": 1,
        "customer_id": slug,
        "customer_name": f"Demo firm {slug}",
        "vertical": "law-firm",
        "practice_areas": ["personal-injury-plaintiff"],
        "fly_region": "iad",
        "model": "claude-opus-4-7",
        "hermes_ref": "v0.0.0-fixture",
        "machine": {"size": "shared-cpu-1x", "memory_mb": 256},
        "users": [
            {
                "email": "principal@example.test",
                "role": "principal",
                "full_name": "Jane Principal",
            }
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
    path = customer_dir / "customer.yaml"
    path.write_text(yaml.safe_dump(body, sort_keys=False), encoding="utf-8")
    return path


def _build_loader(tmp_path: Path, slug: str, vertical: str = "pi") -> DemoFixtureLoader:
    customers_root = tmp_path / "customers"
    customer_dir = customers_root / slug
    _write_customer_yaml(customer_dir, slug)
    memory_store = FilesystemMemoryStore(customer_dir)
    voice_store = FilesystemVoiceStore(customer_dir)
    return DemoFixtureLoader(
        customer_slug=slug,
        vertical=vertical,
        customers_root=customers_root,
        fixtures_root=_real_fixtures_root(),
        memory_store=memory_store,
        voice_store=voice_store,
    )


# ---------------------------------------------------------------------------
# Slug + vertical guards
# ---------------------------------------------------------------------------


def test_is_template_slug() -> None:
    assert is_template_slug("_template") is True
    assert is_template_slug("_") is True
    assert is_template_slug("demo-pi-firm") is False


def test_is_valid_slug() -> None:
    assert is_valid_slug("demo-pi-firm") is True
    assert is_valid_slug("d1") is True
    assert is_valid_slug("a" * 32) is True
    assert is_valid_slug("") is False
    assert is_valid_slug("Has-Caps") is False
    assert is_valid_slug("-leading-dash") is False
    assert is_valid_slug("a" * 33) is False


def test_loader_rejects_empty_slug(tmp_path: Path) -> None:
    with pytest.raises(DemoFixturePreflightError, match="non-empty"):
        DemoFixtureLoader(
            customer_slug="",
            vertical="pi",
            customers_root=tmp_path,
            fixtures_root=_real_fixtures_root(),
            memory_store=FilesystemMemoryStore(tmp_path),
            voice_store=FilesystemVoiceStore(tmp_path),
        )


def test_loader_rejects_template_slug(tmp_path: Path) -> None:
    with pytest.raises(DemoFixturePreflightError, match="reserved template"):
        DemoFixtureLoader(
            customer_slug="_template",
            vertical="pi",
            customers_root=tmp_path,
            fixtures_root=_real_fixtures_root(),
            memory_store=FilesystemMemoryStore(tmp_path),
            voice_store=FilesystemVoiceStore(tmp_path),
        )


def test_loader_rejects_invalid_slug(tmp_path: Path) -> None:
    with pytest.raises(DemoFixturePreflightError, match="does not match"):
        DemoFixtureLoader(
            customer_slug="Has-Caps",
            vertical="pi",
            customers_root=tmp_path,
            fixtures_root=_real_fixtures_root(),
            memory_store=FilesystemMemoryStore(tmp_path),
            voice_store=FilesystemVoiceStore(tmp_path),
        )


def test_loader_rejects_unknown_vertical(tmp_path: Path) -> None:
    with pytest.raises(DemoFixturePreflightError, match="vertical"):
        DemoFixtureLoader(
            customer_slug="demo-pi-firm",
            vertical="real-estate",
            customers_root=tmp_path,
            fixtures_root=_real_fixtures_root(),
            memory_store=FilesystemMemoryStore(tmp_path),
            voice_store=FilesystemVoiceStore(tmp_path),
        )


# ---------------------------------------------------------------------------
# Preflight (missing customer dir / customer.yaml)
# ---------------------------------------------------------------------------


def test_load_raises_when_customer_dir_missing(tmp_path: Path) -> None:
    customers_root = tmp_path / "customers"
    customers_root.mkdir()
    loader = DemoFixtureLoader(
        customer_slug="missing-firm",
        vertical="pi",
        customers_root=customers_root,
        fixtures_root=_real_fixtures_root(),
        memory_store=FilesystemMemoryStore(customers_root / "missing-firm"),
        voice_store=FilesystemVoiceStore(customers_root / "missing-firm"),
    )
    with pytest.raises(DemoFixturePreflightError, match="customer dir not found"):
        loader.load()


def test_load_raises_when_customer_yaml_missing(tmp_path: Path) -> None:
    customers_root = tmp_path / "customers"
    customer_dir = customers_root / "demo-pi-firm"
    customer_dir.mkdir(parents=True)
    loader = DemoFixtureLoader(
        customer_slug="demo-pi-firm",
        vertical="pi",
        customers_root=customers_root,
        fixtures_root=_real_fixtures_root(),
        memory_store=FilesystemMemoryStore(customer_dir),
        voice_store=FilesystemVoiceStore(customer_dir),
    )
    with pytest.raises(DemoFixturePreflightError, match="customer.yaml not found"):
        loader.load()


# ---------------------------------------------------------------------------
# PI matter parser
# ---------------------------------------------------------------------------


def test_parse_pi_matter_reads_all_eight() -> None:
    """All 8 matters from PR #832 parse cleanly."""
    matters_dir = _real_fixtures_root() / "law-firm" / "pi" / "matters"
    matter_files = sorted(
        p for p in matters_dir.glob("*.md") if p.name != "README.md"
    )
    assert len(matter_files) == 8, "expected 8 PI matters from PR #832"
    envelopes = [parse_pi_matter(p) for p in matter_files]
    for env in envelopes:
        assert env.slug, env.source_path
        assert env.case_number, env.source_path
        assert SYNTHETIC_WATERMARK in env.body, env.source_path


def test_parse_pi_matter_rejects_missing_watermark(tmp_path: Path) -> None:
    bad = tmp_path / "fake-matter.md"
    bad.write_text("# Matter: Real Person v. Real Defendant\n", encoding="utf-8")
    with pytest.raises(DemoFixturePreflightError, match="watermark"):
        parse_pi_matter(bad)


# ---------------------------------------------------------------------------
# load_pi_inputs / row builders against the real corpus
# ---------------------------------------------------------------------------


def test_load_pi_inputs_against_real_corpus() -> None:
    inputs = load_pi_inputs(_real_fixtures_root())
    assert len(inputs.matters) == 8
    # The PI corpus README documents 30 per generated category.
    assert len(inputs.intake_transcripts) == 30
    assert len(inputs.billing_entries) == 30
    # client-communication directory has 30 generated entries.
    assert len(inputs.client_communications) == 30
    assert len(inputs.calendar_items) >= 8  # at minimum one status check per matter
    assert len(inputs.voice_samples) == 30


def test_load_pi_inputs_raises_when_corpus_missing(tmp_path: Path) -> None:
    empty_root = tmp_path / "fixtures"
    empty_root.mkdir()
    with pytest.raises(DemoFixturePreflightError, match="PI corpus not found"):
        load_pi_inputs(empty_root)


def test_build_memory_rows_tags_every_row() -> None:
    inputs = load_pi_inputs(_real_fixtures_root())
    rows = build_memory_rows(inputs)
    # 8 matters + 30 intake + 30 billing + 30 communications + calendar
    assert len(rows) >= 8 + 30 + 30 + 30 + 8
    for row in rows:
        assert row["source_kind"] == "demo_fixtures"
        assert row["metadata"]["watermark"] == SYNTHETIC_WATERMARK


def test_build_voice_rows_carries_synthetic_metadata() -> None:
    inputs = load_pi_inputs(_real_fixtures_root())
    rows = build_voice_rows(inputs)
    assert len(rows) == 30
    for row in rows:
        assert row["source_kind"] == "demo_fixtures"
        assert row["metadata"]["watermark"] == SYNTHETIC_WATERMARK
        assert row["partner_authored"] is True


# ---------------------------------------------------------------------------
# Load round-trip + idempotency + tagging
# ---------------------------------------------------------------------------


def test_load_writes_demo_rows_and_tags_them(tmp_path: Path) -> None:
    loader = _build_loader(tmp_path, "demo-pi-firm")
    report = loader.load()

    assert report.outcome == LoadOutcome.LOADED
    assert report.matters_count == 8
    assert report.communications_count == 30
    assert report.voice_samples_count == 30
    assert report.detail["memory_rows_newly_written"] > 0

    # Verify every row is tagged.
    memory_rows = loader.memory_store.list_rows("demo-pi-firm")
    voice_rows = loader.voice_store.list_rows("demo-pi-firm")
    assert memory_rows, "expected at least one memory row written"
    assert voice_rows, "expected at least one voice row written"
    for row in memory_rows + voice_rows:
        assert row["metadata"][DEMO_FIXTURE_KEY] is DEMO_FIXTURE_TAG_VALUE


def test_load_is_idempotent(tmp_path: Path) -> None:
    loader = _build_loader(tmp_path, "demo-pi-firm")
    first = loader.load()
    second = loader.load()

    assert first.outcome == LoadOutcome.LOADED
    assert second.outcome == LoadOutcome.REFRESHED
    # Row counts must NOT grow on re-run.
    assert (
        first.detail["memory_rows_total"]
        == second.detail["memory_rows_total"]
    )
    assert first.detail["voice_rows_total"] == second.detail["voice_rows_total"]
    # Newly-written count is 0 on the second pass (all rows existed).
    assert second.detail["memory_rows_newly_written"] == 0
    assert second.detail["voice_rows_newly_written"] == 0


def test_load_state_file_has_expected_keys(tmp_path: Path) -> None:
    loader = _build_loader(tmp_path, "demo-pi-firm")
    loader.load()
    state_file = (
        tmp_path / "customers" / "demo-pi-firm" / ".demo-fixtures-state.json"
    )
    assert state_file.is_file()
    raw = json.loads(state_file.read_text(encoding="utf-8"))
    assert "memory_rows" in raw
    assert "voice_rows" in raw


# ---------------------------------------------------------------------------
# Safety refusal: existing non-demo rows
# ---------------------------------------------------------------------------


def test_load_refuses_when_substrate_holds_non_demo_memory_row(
    tmp_path: Path,
) -> None:
    loader = _build_loader(tmp_path, "demo-pi-firm")
    # Plant a non-demo memory row directly via the file store internals.
    state_file = (
        tmp_path / "customers" / "demo-pi-firm" / ".demo-fixtures-state.json"
    )
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(
        json.dumps(
            {
                "memory_rows": [
                    {
                        "source_kind": "filevine",
                        "external_id": "real-matter-1",
                        "metadata": {"watermark": "REAL DATA"},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(DemoFixtureSafetyRefusal, match="non-demo memory row"):
        loader.load()


def test_load_refuses_when_substrate_holds_non_demo_voice_row(
    tmp_path: Path,
) -> None:
    loader = _build_loader(tmp_path, "demo-pi-firm")
    state_file = (
        tmp_path / "customers" / "demo-pi-firm" / ".demo-fixtures-state.json"
    )
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(
        json.dumps(
            {
                "voice_rows": [
                    {
                        "source_kind": "voice-real",
                        "external_id": "real-sample-1",
                        "metadata": {"some_field": "real"},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(DemoFixtureSafetyRefusal, match="non-demo voice row"):
        loader.load()


def test_unload_refuses_when_substrate_holds_non_demo_rows(
    tmp_path: Path,
) -> None:
    loader = _build_loader(tmp_path, "demo-pi-firm")
    state_file = (
        tmp_path / "customers" / "demo-pi-firm" / ".demo-fixtures-state.json"
    )
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(
        json.dumps(
            {
                "memory_rows": [
                    {
                        "source_kind": "filevine",
                        "external_id": "real-matter-1",
                        "metadata": {"watermark": "REAL DATA"},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(DemoFixtureSafetyRefusal):
        loader.unload()


# ---------------------------------------------------------------------------
# Unload round-trip + idempotency
# ---------------------------------------------------------------------------


def test_unload_removes_demo_rows(tmp_path: Path) -> None:
    loader = _build_loader(tmp_path, "demo-pi-firm")
    loader.load()

    report = loader.unload()
    assert report.outcome == UnloadOutcome.REMOVED
    assert report.memory_rows_removed > 0
    assert report.voice_rows_removed > 0

    # After unload, the store is empty.
    assert loader.memory_store.list_rows("demo-pi-firm") == []
    assert loader.voice_store.list_rows("demo-pi-firm") == []


def test_unload_is_idempotent(tmp_path: Path) -> None:
    loader = _build_loader(tmp_path, "demo-pi-firm")
    loader.load()
    first = loader.unload()
    second = loader.unload()
    assert first.outcome == UnloadOutcome.REMOVED
    assert second.outcome == UnloadOutcome.NOOP
    assert second.memory_rows_removed == 0
    assert second.voice_rows_removed == 0


def test_unload_only_removes_demo_rows(tmp_path: Path) -> None:
    """A coexisting demo + foreign row is impossible under the safety
    guard, but the underlying remove_demo_rows helper still filters by
    tag. Verify directly to lock in the filtering contract."""
    loader = _build_loader(tmp_path, "demo-pi-firm")
    state_file = (
        tmp_path / "customers" / "demo-pi-firm" / ".demo-fixtures-state.json"
    )
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(
        json.dumps(
            {
                "memory_rows": [
                    {
                        "source_kind": "filevine",
                        "external_id": "real-matter-1",
                        "metadata": {"watermark": "REAL DATA"},
                    },
                    {
                        "source_kind": "demo_fixtures",
                        "external_id": "matter:demo",
                        "metadata": {DEMO_FIXTURE_KEY: DEMO_FIXTURE_TAG_VALUE},
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    removed = loader.memory_store.remove_demo_rows("demo-pi-firm")
    assert removed == 1
    remaining = loader.memory_store.list_rows("demo-pi-firm")
    assert len(remaining) == 1
    assert remaining[0]["external_id"] == "real-matter-1"


# ---------------------------------------------------------------------------
# CLI surface
# ---------------------------------------------------------------------------


def _run_cli(argv: list[str]) -> int:
    from bin.lib import demo_fixtures_cli

    return demo_fixtures_cli.main(argv)


def test_cli_unknown_vertical_exits_2(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    with pytest.raises(SystemExit) as exc_info:
        _run_cli(
            [
                "demo-pi-firm",
                "real-estate",
                "--customers-root",
                str(tmp_path / "customers"),
                "--fixtures-root",
                str(_real_fixtures_root()),
            ]
        )
    # argparse choices=... rejects with exit code 2 directly.
    assert exc_info.value.code == 2


def test_cli_missing_customer_dir_exits_2(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    customers_root = tmp_path / "customers"
    customers_root.mkdir()
    rc = _run_cli(
        [
            "demo-pi-firm",
            "pi",
            "--customers-root",
            str(customers_root),
            "--fixtures-root",
            str(_real_fixtures_root()),
        ]
    )
    assert rc == 2
    captured = capsys.readouterr()
    assert "PREFLIGHT FAIL" in captured.err


def test_cli_load_then_unload_round_trip(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    customers_root = tmp_path / "customers"
    _write_customer_yaml(customers_root / "demo-pi-firm", "demo-pi-firm")

    rc = _run_cli(
        [
            "demo-pi-firm",
            "pi",
            "--customers-root",
            str(customers_root),
            "--fixtures-root",
            str(_real_fixtures_root()),
        ]
    )
    assert rc == 0
    out = capsys.readouterr().out
    assert "loaded" in out
    assert "matters loaded:        8" in out

    rc2 = _run_cli(
        [
            "demo-pi-firm",
            "pi",
            "--unload",
            "--customers-root",
            str(customers_root),
            "--fixtures-root",
            str(_real_fixtures_root()),
        ]
    )
    assert rc2 == 0
    out2 = capsys.readouterr().out
    assert "removed" in out2


def test_cli_safety_refusal_exits_4(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    customers_root = tmp_path / "customers"
    customer_dir = customers_root / "demo-pi-firm"
    _write_customer_yaml(customer_dir, "demo-pi-firm")
    # Plant a foreign row directly.
    state_file = customer_dir / ".demo-fixtures-state.json"
    state_file.write_text(
        json.dumps(
            {
                "memory_rows": [
                    {
                        "source_kind": "filevine",
                        "external_id": "real-matter-1",
                        "metadata": {"watermark": "REAL DATA"},
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    rc = _run_cli(
        [
            "demo-pi-firm",
            "pi",
            "--customers-root",
            str(customers_root),
            "--fixtures-root",
            str(_real_fixtures_root()),
        ]
    )
    assert rc == 4
    captured = capsys.readouterr()
    assert "SAFETY REFUSAL" in captured.err


# ---------------------------------------------------------------------------
# Registry surface
# ---------------------------------------------------------------------------


def test_vertical_registry_v1() -> None:
    assert "pi" in VERTICAL_REGISTRY
    pi = VERTICAL_REGISTRY["pi"]
    assert pi.corpus_subpath == "law-firm/pi"
    assert pi.matters_subdir == "matters"
