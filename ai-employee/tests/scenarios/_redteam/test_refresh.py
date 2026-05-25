"""Tests for ai-employee/tests/scenarios/_redteam/refresh.py.

The refresh script is a TOOL, not a CI gate — it runs on demand to
generate draft variants of the L3 corpus. Tests cover:

  - Variant generation with a fake LLM caller produces expected
    RefreshDraft shape
  - write_drafts emits a *.drafts.json file with the documented shape
  - refresh_corpus iterates the canonical entries + writes draft variants
  - Error paths: non-list caller output rejected, missing entry_key
    rejected
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parent))

from refresh import (  # noqa: E402
    RefreshDraft,
    generate_variants,
    load_corpus,
    refresh_corpus,
    write_drafts,
)


def _fake_caller_returning(variants: list[dict]):
    def caller(prompt: str) -> str:
        return json.dumps(variants)
    return caller


class TestGenerateVariants:
    def test_well_formed_caller_produces_draft(self):
        base = {"attack_id": "ARCH-X-001", "boundary": "test"}
        caller = _fake_caller_returning([
            {"attack_id": "ARCH-X-001-V1", "boundary": "test"},
            {"attack_id": "ARCH-X-001-V2", "boundary": "test"},
        ])
        draft = generate_variants(base_entry=base, caller=caller)
        assert isinstance(draft, RefreshDraft)
        assert draft.base_id == "ARCH-X-001"
        assert len(draft.variants) == 2
        assert draft.source == "llm-variant"

    def test_caller_returning_non_list_rejected(self):
        base = {"attack_id": "ARCH-X-002"}
        caller = _fake_caller_returning({"not": "a list"})  # type: ignore[arg-type]
        with pytest.raises(ValueError, match="non-list"):
            generate_variants(base_entry=base, caller=caller)

    def test_probe_id_used_when_attack_id_missing(self):
        base = {"probe_id": "CHOKE-X-001"}
        caller = _fake_caller_returning([])
        draft = generate_variants(base_entry=base, caller=caller)
        assert draft.base_id == "CHOKE-X-001"


class TestWriteDrafts:
    def test_drafts_file_written_next_to_canonical(self, tmp_path):
        canonical = tmp_path / "attacks.json"
        canonical.write_text("{}", encoding="utf-8")
        drafts = [
            RefreshDraft(
                base_id="ARCH-X-001",
                base_entry={"attack_id": "ARCH-X-001"},
                variants=[{"attack_id": "ARCH-X-001-V1"}],
                generated_at_iso="2026-05-25T18:00:00Z",
                source="llm-variant",
            )
        ]
        path = write_drafts(canonical_path=canonical, drafts=drafts)
        assert path.name == "attacks.drafts.json"
        payload = json.loads(path.read_text())
        assert payload["_canonical_source"] == "attacks.json"
        assert len(payload["drafts"]) == 1
        assert payload["drafts"][0]["base_id"] == "ARCH-X-001"
        assert payload["drafts"][0]["variants"][0]["attack_id"] == "ARCH-X-001-V1"


class TestRefreshCorpus:
    def test_iterates_entries_and_writes_drafts(self, tmp_path):
        canonical = tmp_path / "attacks.json"
        canonical.write_text(
            json.dumps({
                "attacks": [
                    {"attack_id": "ARCH-A", "boundary": "x"},
                    {"attack_id": "ARCH-B", "boundary": "y"},
                ]
            }),
            encoding="utf-8",
        )
        caller = _fake_caller_returning([{"attack_id": "ARCH-A-V1"}])
        path = refresh_corpus(
            canonical_path=canonical,
            caller=caller,
            entry_key="attacks",
        )
        payload = json.loads(path.read_text())
        assert len(payload["drafts"]) == 2
        assert {d["base_id"] for d in payload["drafts"]} == {"ARCH-A", "ARCH-B"}

    def test_missing_entry_key_rejected(self, tmp_path):
        canonical = tmp_path / "x.json"
        canonical.write_text("{}", encoding="utf-8")
        caller = _fake_caller_returning([])
        with pytest.raises(KeyError, match="no 'attacks'"):
            refresh_corpus(
                canonical_path=canonical,
                caller=caller,
                entry_key="attacks",
            )


class TestLoadCorpus:
    def test_loads_committed_architecture_corpus(self):
        path = _HERE.parent / "architecture" / "attacks.json"
        if not path.exists():
            pytest.skip(f"architecture corpus not at {path}")
        corpus = load_corpus(path)
        assert "attacks" in corpus
        assert isinstance(corpus["attacks"], list)

    def test_loads_committed_chokepoints_corpus(self):
        path = _HERE.parent / "chokepoints" / "payloads.json"
        if not path.exists():
            pytest.skip(f"chokepoints corpus not at {path}")
        corpus = load_corpus(path)
        assert "probes" in corpus
        assert isinstance(corpus["probes"], list)
