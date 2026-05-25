"""Tests for ai-employee/tests/scenario_schema.py.

The scenario schema is the v1 sibling-file format for scenario-level
metadata (input_available_fields, expected_tool_calls, judge_axes, etc.).

Coverage:
  - parse() accepts a well-formed draft scenario
  - parse() accepts a well-formed refusal scenario
  - parse() rejects missing required fields
  - parse() rejects an unknown scenario_version
  - parse() rejects expected_outcome != draft|refusal
  - parse() rejects refusal scenarios missing expected_refusal_code
  - parse() rejects unknown refusal codes
  - parse() rejects malformed expected_tool_calls / expected_memory_writes
  - parse() preserves notes and forward-compat unknown fields
  - load() reads from disk and parses the two anchor fixtures we shipped
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parent))

from scenario_schema import (  # noqa: E402
    SCENARIO_VERSION,
    Scenario,
    ScenarioValidationError,
    ToolCallExpectation,
    load,
    parse,
    scenario_path_for,
)


REPO_ROOT = _HERE.parents[2]
DEMAND_LETTER_FIXTURES = (
    REPO_ROOT
    / "ai-employee"
    / "skills"
    / "law-pi-demand-letter-draft"
    / "fixtures"
)


def _draft_payload(**overrides):
    base = {
        "scenario_version": SCENARIO_VERSION,
        "skill_slug": "law-pi-demand-letter-draft",
        "fixture_name": "01-clean-matter",
        "expected_skill": "law-pi-demand-letter-draft",
        "expected_outcome": "draft",
        "input_available_fields": ["client_name"],
        "expected_tool_calls": {
            "must_call": ["Email.create_draft"],
            "must_not_call": ["Email.send"],
        },
        "expected_audit_actions": ["DRAFT_CREATED"],
        "judge_axes": ["voice_fidelity"],
    }
    base.update(overrides)
    return base


def _refusal_payload(**overrides):
    base = {
        "scenario_version": SCENARIO_VERSION,
        "skill_slug": "law-pi-demand-letter-draft",
        "fixture_name": "03-citation-in-source-matter",
        "expected_skill": "law-pi-demand-letter-draft",
        "expected_outcome": "refusal",
        "allowed_refusal_triggers": ["citation_in_source"],
        "expected_refusal_code": "citation_in_source",
        "expected_audit_actions": ["SKILL_REFUSED"],
        "judge_axes": ["refusal_correctness"],
    }
    base.update(overrides)
    return base


class TestParseDraft:
    def test_well_formed_draft_parses(self):
        scenario = parse(_draft_payload())
        assert isinstance(scenario, Scenario)
        assert scenario.expected_outcome == "draft"
        assert scenario.expected_refusal_code is None

    def test_input_available_fields_default_empty(self):
        payload = _draft_payload()
        del payload["input_available_fields"]
        scenario = parse(payload)
        assert scenario.input_available_fields == []

    def test_tool_calls_parsed(self):
        scenario = parse(_draft_payload())
        assert isinstance(scenario.expected_tool_calls, ToolCallExpectation)
        assert "Email.create_draft" in scenario.expected_tool_calls.must_call
        assert "Email.send" in scenario.expected_tool_calls.must_not_call

    def test_tool_calls_default_to_empty(self):
        payload = _draft_payload()
        del payload["expected_tool_calls"]
        scenario = parse(payload)
        assert scenario.expected_tool_calls.must_call == []
        assert scenario.expected_tool_calls.must_not_call == []


class TestParseRefusal:
    def test_well_formed_refusal_parses(self):
        scenario = parse(_refusal_payload())
        assert scenario.expected_outcome == "refusal"
        assert scenario.expected_refusal_code == "citation_in_source"

    def test_refusal_without_code_rejected(self):
        payload = _refusal_payload()
        del payload["expected_refusal_code"]
        with pytest.raises(ScenarioValidationError, match="expected_refusal_code"):
            parse(payload)

    def test_refusal_with_unknown_code_rejected(self):
        payload = _refusal_payload(expected_refusal_code="some_made_up_code")
        with pytest.raises(ScenarioValidationError, match="not in KNOWN_REFUSAL_CODES"):
            parse(payload)


class TestRequiredFields:
    @pytest.mark.parametrize(
        "missing_key",
        [
            "scenario_version",
            "skill_slug",
            "fixture_name",
            "expected_skill",
            "expected_outcome",
        ],
    )
    def test_missing_required_field_rejected(self, missing_key):
        payload = _draft_payload()
        del payload[missing_key]
        with pytest.raises(ScenarioValidationError, match=missing_key):
            parse(payload)

    def test_unsupported_version_rejected(self):
        payload = _draft_payload(scenario_version=99)
        with pytest.raises(ScenarioValidationError, match="unsupported version"):
            parse(payload)

    def test_bad_outcome_value_rejected(self):
        payload = _draft_payload(expected_outcome="something_else")
        with pytest.raises(ScenarioValidationError, match="expected_outcome must be"):
            parse(payload)


class TestStructuralValidation:
    def test_tool_calls_must_be_object(self):
        payload = _draft_payload(expected_tool_calls=["bad", "shape"])
        with pytest.raises(ScenarioValidationError, match="expected_tool_calls"):
            parse(payload)

    def test_memory_write_must_be_object(self):
        payload = _draft_payload(expected_memory_writes=["string-not-object"])
        with pytest.raises(ScenarioValidationError, match="expected_memory_writes"):
            parse(payload)

    def test_memory_write_requires_peer(self):
        payload = _draft_payload(
            expected_memory_writes=[{"conclusion_text": "foo"}]
        )
        with pytest.raises(ScenarioValidationError, match="peer"):
            parse(payload)

    def test_memory_write_with_peer_accepted(self):
        payload = _draft_payload(
            expected_memory_writes=[
                {"peer": "client-alpha", "conclusion_text": "Smith prefers email."}
            ]
        )
        scenario = parse(payload)
        assert len(scenario.expected_memory_writes) == 1


class TestForwardCompat:
    def test_unknown_field_does_not_break_parse(self):
        payload = _draft_payload(future_field_we_dont_know_about="value")
        scenario = parse(payload)
        assert scenario.skill_slug == "law-pi-demand-letter-draft"

    def test_notes_preserved(self):
        payload = _draft_payload(notes="Detailed authoring rationale here.")
        scenario = parse(payload)
        assert scenario.notes == "Detailed authoring rationale here."


class TestLoadFromDisk:
    """Loads the two anchor scenario JSONs we shipped for law-pi-demand-letter-draft."""

    def test_anchor_draft_loads(self):
        path = DEMAND_LETTER_FIXTURES / "01-clean-matter.scenario.json"
        if not path.exists():
            pytest.skip(f"anchor fixture not present at {path}")
        scenario = load(path)
        assert scenario.expected_outcome == "draft"
        assert "client_name" in scenario.input_available_fields
        assert "Email.create_draft" in scenario.expected_tool_calls.must_call
        assert "Email.send" in scenario.expected_tool_calls.must_not_call

    def test_anchor_refusal_loads(self):
        path = DEMAND_LETTER_FIXTURES / "03-citation-in-source-matter.scenario.json"
        if not path.exists():
            pytest.skip(f"anchor fixture not present at {path}")
        scenario = load(path)
        assert scenario.expected_outcome == "refusal"
        assert scenario.expected_refusal_code == "citation_in_source"
        assert "refusal_correctness" in scenario.judge_axes

    def test_load_missing_file_raises(self, tmp_path):
        with pytest.raises(ScenarioValidationError, match="does not exist"):
            load(tmp_path / "nope.scenario.json")

    def test_scenario_path_for_convention(self, tmp_path):
        path = scenario_path_for(tmp_path, "01-clean-matter")
        assert path.name == "01-clean-matter.scenario.json"
        assert path.parent == tmp_path


if __name__ == "__main__":
    sys.exit(pytest.main([str(_HERE), "-v"]))
