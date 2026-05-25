"""Tests for ai-employee/tests/scenario_runner.py.

The runner ties scenario_schema + fabrication_check + judge.judge_run
together. Coverage:

  - Fabrication violation → auto-FAIL, judge not invoked
  - Outcome-shape mismatch (expected draft, got refusal) → auto-FAIL
  - Outcome refusal-code mismatch → auto-FAIL
  - Clean output passes through to LLM-judge
  - When anthropic=None and gates pass, result is "review"
  - run_scenario_from_path loads from disk + runs through end-to-end
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parent))
sys.path.insert(0, str(_HERE.parents[1]))

from scenario_runner import (  # noqa: E402
    RunResult,
    run_scenario,
    run_scenario_from_path,
)
from scenario_schema import Scenario, ToolCallExpectation  # noqa: E402


HAIKU_ID = "claude-haiku-4-5-20251001"
OPUS_ID = "claude-opus-4-7"


class FakeCaller:
    def __init__(self, scripts):
        self._scripts = {k: list(v) for k, v in scripts.items()}
        self.calls = []

    def __call__(self, model_id, system_prompt, user_prompt):
        self.calls.append((model_id, system_prompt, user_prompt))
        queue = self._scripts.get(model_id, [])
        if not queue:
            raise AssertionError(f"FakeCaller has no scripted response for {model_id!r}")
        return json.dumps(queue.pop(0))


def _scenario(
    *,
    expected_outcome="draft",
    expected_refusal_code=None,
    judge_axes=None,
    input_available_fields=None,
):
    return Scenario(
        scenario_version=1,
        skill_slug="law-pi-demand-letter-draft",
        fixture_name="test-fixture",
        expected_skill="law-pi-demand-letter-draft",
        expected_outcome=expected_outcome,
        input_available_fields=input_available_fields or [],
        expected_tool_calls=ToolCallExpectation(),
        expected_audit_actions=[],
        expected_memory_writes=[],
        allowed_refusal_triggers=[],
        expected_refusal_code=expected_refusal_code,
        judge_axes=judge_axes or ["voice_fidelity"],
        notes="",
    )


def _clean_haiku_verdict(rubric_verdict="autonomous", confidence=0.95):
    return {
        "rubric_verdict": rubric_verdict,
        "confidence": confidence,
        "per_axis": {
            "voice_fidelity": {"score": 0.9, "classification": "safe", "notes": ""},
        },
        "reasoning": "Clean.",
    }


class TestFabricationGate:
    def test_fabrication_violation_auto_fails(self):
        scenario = _scenario()
        output = {
            "kind": "draft",
            "envelope": {"client_name": "Jane Doe"},  # fabricated
            "_body_text": "Body content.",
        }
        golden = {
            "kind": "draft",
            "envelope": {"client_name": "TBD"},
            "_body_text": "Body content.",
        }
        result = run_scenario(
            scenario=scenario,
            output=output,
            golden=golden,
            anthropic=None,  # judge should NOT be called
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        assert isinstance(result, RunResult)
        assert result.overall == "fail"
        assert result.fabrication.violation_detected is True
        assert result.verdict is None

    def test_fabrication_respects_input_available_fields(self):
        scenario = _scenario(input_available_fields=["client_name"])
        output = {
            "kind": "draft",
            "envelope": {"client_name": "Janet Holloway"},
            "_body_text": "Body.",
        }
        golden = {
            "kind": "draft",
            "envelope": {"client_name": "TBD"},  # but input supplies it
            "_body_text": "Body.",
        }
        caller = FakeCaller({HAIKU_ID: [_clean_haiku_verdict()]})
        result = run_scenario(
            scenario=scenario,
            output=output,
            golden=golden,
            anthropic=caller,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        # No fabrication since client_name is in input_available_fields.
        assert result.fabrication.violation_detected is False
        # Judge was invoked.
        assert result.verdict is not None


class TestOutcomeShape:
    def test_expected_draft_but_got_refusal_fails(self):
        scenario = _scenario(expected_outcome="draft")
        output = {
            "kind": "refusal",
            "refusal": {"code": "citation_in_source"},
        }
        golden = {
            "kind": "draft",
            "envelope": {"client_name": "Smith"},
            "_body_text": "Body.",
        }
        result = run_scenario(
            scenario=scenario,
            output=output,
            golden=golden,
            anthropic=None,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        assert result.overall == "fail"
        assert "expected draft outcome" in (result.outcome_mismatch_reason or "")
        assert result.verdict is None

    def test_refusal_code_mismatch_fails(self):
        scenario = _scenario(
            expected_outcome="refusal",
            expected_refusal_code="citation_in_source",
        )
        output = {
            "kind": "refusal",
            "refusal": {"code": "prompt_injection"},
        }
        golden = {
            "kind": "refusal",
            "refusal": {"code": "citation_in_source"},
        }
        result = run_scenario(
            scenario=scenario,
            output=output,
            golden=golden,
            anthropic=None,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        assert result.overall == "fail"
        assert "expected refusal code" in (result.outcome_mismatch_reason or "")

    def test_matching_refusal_code_passes_to_judge(self):
        scenario = _scenario(
            expected_outcome="refusal",
            expected_refusal_code="citation_in_source",
            judge_axes=["refusal_correctness"],
        )
        output = {
            "kind": "refusal",
            "refusal": {"code": "citation_in_source"},
        }
        golden = {
            "kind": "refusal",
            "refusal": {"code": "citation_in_source"},
        }
        opus_verdict = {
            "rubric_verdict": "autonomous",
            "confidence": 0.95,
            "per_axis": {
                "refusal_correctness": {
                    "score": 0.95,
                    "classification": "safe",
                    "notes": "Correct refusal.",
                },
            },
            "reasoning": "Correct.",
        }
        # refusal_correctness is safety-critical → escalates to Opus.
        caller = FakeCaller({
            HAIKU_ID: [opus_verdict],
            OPUS_ID: [opus_verdict],
        })
        result = run_scenario(
            scenario=scenario,
            output=output,
            golden=golden,
            anthropic=caller,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        assert result.overall == "pass"
        assert result.verdict is not None
        # Should have escalated to Opus.
        assert result.verdict.judge_model == OPUS_ID


class TestCleanPath:
    def test_clean_output_passes_to_judge(self):
        scenario = _scenario()
        output = {
            "kind": "draft",
            "envelope": {"client_name": "TBD"},
            "_body_text": "Body with TBD.",
        }
        golden = {
            "kind": "draft",
            "envelope": {"client_name": "TBD"},
            "_body_text": "Body with TBD.",
        }
        caller = FakeCaller({HAIKU_ID: [_clean_haiku_verdict()]})
        result = run_scenario(
            scenario=scenario,
            output=output,
            golden=golden,
            anthropic=caller,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        assert result.overall == "pass"
        assert result.verdict is not None
        assert result.verdict.judge_model == HAIKU_ID

    def test_anthropic_none_yields_review_when_gates_pass(self):
        scenario = _scenario()
        output = {
            "kind": "draft",
            "envelope": {"client_name": "TBD"},
            "_body_text": "Body.",
        }
        golden = {
            "kind": "draft",
            "envelope": {"client_name": "TBD"},
            "_body_text": "Body.",
        }
        result = run_scenario(
            scenario=scenario,
            output=output,
            golden=golden,
            anthropic=None,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        assert result.overall == "review"
        assert result.verdict is None


class TestLoadFromPath:
    def test_run_scenario_from_path_anchor_fixture(self):
        scenario_path = (
            _HERE.parents[1]
            / "skills"
            / "law-pi-demand-letter-draft"
            / "fixtures"
            / "01-clean-matter.scenario.json"
        )
        if not scenario_path.exists():
            pytest.skip(f"anchor scenario not at {scenario_path}")
        golden_path = (
            _HERE.parent
            / "golden"
            / "law-pi-demand-letter-draft"
            / "01-clean-matter.json"
        )
        if not golden_path.exists():
            pytest.skip(f"anchor golden not at {golden_path}")
        golden = json.loads(golden_path.read_text())
        # Use golden as the agent output (clean replay).
        result = run_scenario_from_path(
            scenario_path=scenario_path,
            output=golden,
            golden=golden,
            anthropic=None,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        # No fabrication, no outcome mismatch, no judge → review (caller decides).
        assert result.overall == "review"
        assert result.fabrication.violation_detected is False
        assert result.scenario.expected_skill == "law-pi-demand-letter-draft"


if __name__ == "__main__":
    sys.exit(pytest.main([str(_HERE), "-v"]))
