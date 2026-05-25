"""Tests for the L3 adversarial corpus.

Validates the JSON shape of both files:
  - ai-employee/tests/scenarios/_redteam/architecture/attacks.json
  - ai-employee/tests/scenarios/_redteam/chokepoints/payloads.json

These tests do NOT execute the attacks — that requires the live agent
+ skills wired in CI. The tests verify the corpus is structurally
valid and complete enough to ship to the L3 workflow.

Coverage:
  - Each file parses as JSON
  - Architecture attacks cover all 7 documented boundaries
  - Chokepoint probes cover all 4 documented vectors
  - Every attack/probe has the required keys
  - All refusal codes (where set) are in scenario_schema.KNOWN_REFUSAL_CODES
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))

from scenario_schema import KNOWN_REFUSAL_CODES  # noqa: E402


ARCHITECTURE_PATH = _HERE.parent / "architecture" / "attacks.json"
CHOKEPOINTS_PATH = _HERE.parent / "chokepoints" / "payloads.json"


@pytest.fixture(scope="module")
def architecture():
    return json.loads(ARCHITECTURE_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def chokepoints():
    return json.loads(CHOKEPOINTS_PATH.read_text(encoding="utf-8"))


class TestArchitectureCorpus:
    def test_format_version_present(self, architecture):
        assert architecture["_format_version"] == 1

    def test_attacks_array_present(self, architecture):
        assert "attacks" in architecture
        assert isinstance(architecture["attacks"], list)
        assert len(architecture["attacks"]) >= 7

    def test_each_attack_has_required_keys(self, architecture):
        required = {
            "attack_id",
            "boundary",
            "vector",
            "scenario_text",
            "expected_behavior",
            "expected_refusal_mechanism",
            "rationale",
        }
        for attack in architecture["attacks"]:
            missing = required - set(attack.keys())
            assert not missing, (
                f"attack {attack.get('attack_id', '?')} missing keys: {sorted(missing)}"
            )

    def test_all_seven_boundaries_covered(self, architecture):
        boundaries_in_corpus = {a["boundary"] for a in architecture["attacks"]}
        documented = set(architecture["_boundaries_covered"])
        missing = documented - boundaries_in_corpus
        assert not missing, (
            f"documented boundaries with no attack scenario: {sorted(missing)}"
        )

    def test_refusal_codes_known(self, architecture):
        for attack in architecture["attacks"]:
            code = attack.get("expected_refusal_code")
            if code is None:
                continue
            assert code in KNOWN_REFUSAL_CODES, (
                f"attack {attack['attack_id']} expected_refusal_code "
                f"{code!r} not in KNOWN_REFUSAL_CODES — update "
                f"scenario_schema.KNOWN_REFUSAL_CODES if intentional"
            )

    def test_attack_ids_unique(self, architecture):
        ids = [a["attack_id"] for a in architecture["attacks"]]
        assert len(ids) == len(set(ids)), "duplicate attack_id"


class TestChokepointsCorpus:
    def test_format_version_present(self, chokepoints):
        assert chokepoints["_format_version"] == 1

    def test_probes_array_present(self, chokepoints):
        assert "probes" in chokepoints
        assert isinstance(chokepoints["probes"], list)
        # Plan §"Layer 3 — chokepoint generic injection probes" says 15;
        # v1 ships 12 and Captain extends quarterly per the refresh script.
        assert len(chokepoints["probes"]) >= 10

    def test_each_probe_has_required_keys(self, chokepoints):
        required = {
            "probe_id",
            "vector",
            "chokepoint",
            "payload",
            "expected_refusal_code",
            "expected_behavior",
        }
        for probe in chokepoints["probes"]:
            missing = required - set(probe.keys())
            assert not missing, (
                f"probe {probe.get('probe_id', '?')} missing keys: {sorted(missing)}"
            )

    def test_all_four_vectors_covered(self, chokepoints):
        vectors_in_corpus = {p["vector"] for p in chokepoints["probes"]}
        documented = set(chokepoints["_vectors_covered"])
        missing = documented - vectors_in_corpus
        assert not missing, (
            f"documented vectors with no probe: {sorted(missing)}"
        )

    def test_refusal_codes_known(self, chokepoints):
        for probe in chokepoints["probes"]:
            code = probe.get("expected_refusal_code")
            if code is None:
                continue
            assert code in KNOWN_REFUSAL_CODES, (
                f"probe {probe['probe_id']} expected_refusal_code {code!r} "
                f"not in KNOWN_REFUSAL_CODES"
            )

    def test_probe_ids_unique(self, chokepoints):
        ids = [p["probe_id"] for p in chokepoints["probes"]]
        assert len(ids) == len(set(ids)), "duplicate probe_id"

    def test_payloads_are_non_empty_strings(self, chokepoints):
        for probe in chokepoints["probes"]:
            payload = probe["payload"]
            assert isinstance(payload, str)
            assert payload.strip(), (
                f"probe {probe['probe_id']} has empty payload"
            )
