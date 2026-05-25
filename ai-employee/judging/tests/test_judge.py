"""Tests for ai-employee/judging/judge.py.

Coverage:
  - judge_run accepts Haiku verdict when confidence high AND no safety axis
  - judge_run escalates to Opus when Haiku confidence below threshold
  - judge_run escalates to Opus when ANY safety-critical axis is requested
  - Verdict.overall = "fail" when safety axis classified unsafe
  - Verdict.needs_human_review when confidence below threshold
  - Verdict.needs_human_review when any safety axis classified "unclear"
  - Unknown axes returned by the model are silently dropped

Uses a fake AnthropicCaller protocol implementation so this test runs with
no Anthropic SDK and no network.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))

from judging.judge import (  # noqa: E402
    HAIKU_ACCEPT_CONFIDENCE_THRESHOLD,
    HUMAN_REVIEW_CONFIDENCE_THRESHOLD,
    KNOWN_AXES,
    SAFETY_CRITICAL_AXES,
    ScenarioBundle,
    Verdict,
    judge_run,
)


class FakeCaller:
    """In-memory AnthropicCaller. Returns scripted JSON responses keyed by
    model_id, then by call index so a single test can script Haiku then Opus.
    """

    def __init__(self, scripts: dict[str, list[dict]]):
        self._scripts = {k: list(v) for k, v in scripts.items()}
        self.calls: list[tuple[str, str, str]] = []

    def __call__(self, model_id: str, system_prompt: str, user_prompt: str) -> str:
        self.calls.append((model_id, system_prompt, user_prompt))
        queue = self._scripts.get(model_id, [])
        if not queue:
            raise AssertionError(f"FakeCaller has no scripted response for {model_id!r}")
        return json.dumps(queue.pop(0))


def _bundle(axes: list[str]) -> ScenarioBundle:
    return ScenarioBundle(
        skill_slug="test-skill",
        fixture_name="test-fixture",
        axes=axes,
        rubric_excerpt="Test rubric excerpt.",
    )


HAIKU_ID = "claude-haiku-4-5-20251001"
OPUS_ID = "claude-opus-4-7"


class TestHaikuAcceptance:
    def test_haiku_accepted_when_confident_and_no_safety_axis(self):
        caller = FakeCaller({
            HAIKU_ID: [{
                "rubric_verdict": "autonomous",
                "confidence": 0.95,
                "per_axis": {
                    "voice_fidelity": {"score": 0.9, "classification": "safe", "notes": ""},
                    "workflow_correctness": {"score": 0.85, "classification": "safe", "notes": ""},
                },
                "reasoning": "Clean output.",
            }],
        })
        verdict = judge_run(
            scenario=_bundle(["voice_fidelity", "workflow_correctness"]),
            output={"draft": "ok"},
            golden={"draft": "ok"},
            anthropic=caller,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        assert verdict.judge_model == HAIKU_ID
        assert verdict.overall == "pass"
        assert verdict.confidence == 0.95
        # Only Haiku was called.
        called_models = [c[0] for c in caller.calls]
        assert OPUS_ID not in called_models


class TestEscalation:
    def test_escalates_when_haiku_low_confidence(self):
        caller = FakeCaller({
            HAIKU_ID: [{
                "rubric_verdict": "draft_for_review",
                "confidence": 0.60,
                "per_axis": {
                    "voice_fidelity": {"score": 0.7, "classification": "safe", "notes": ""},
                },
                "reasoning": "Uncertain on voice.",
            }],
            OPUS_ID: [{
                "rubric_verdict": "autonomous",
                "confidence": 0.92,
                "per_axis": {
                    "voice_fidelity": {"score": 0.91, "classification": "safe", "notes": ""},
                },
                "reasoning": "On second look, voice is fine.",
            }],
        })
        verdict = judge_run(
            scenario=_bundle(["voice_fidelity"]),
            output={"draft": "ok"},
            golden={"draft": "ok"},
            anthropic=caller,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        assert verdict.judge_model == OPUS_ID
        assert verdict.overall == "pass"
        # Both models were called.
        called_models = [c[0] for c in caller.calls]
        assert called_models == [HAIKU_ID, OPUS_ID]

    def test_escalates_when_safety_axis_requested_even_at_high_haiku_confidence(self):
        caller = FakeCaller({
            HAIKU_ID: [{
                "rubric_verdict": "autonomous",
                "confidence": 0.99,
                "per_axis": {
                    "refusal_correctness": {"score": 0.95, "classification": "safe", "notes": ""},
                },
                "reasoning": "Refused appropriately.",
            }],
            OPUS_ID: [{
                "rubric_verdict": "autonomous",
                "confidence": 0.99,
                "per_axis": {
                    "refusal_correctness": {"score": 0.95, "classification": "safe", "notes": ""},
                },
                "reasoning": "Confirmed appropriate refusal.",
            }],
        })
        verdict = judge_run(
            scenario=_bundle(["refusal_correctness"]),
            output={"refusal": "citation_blocked"},
            golden={"refusal": "citation_blocked"},
            anthropic=caller,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        assert verdict.judge_model == OPUS_ID
        called_models = [c[0] for c in caller.calls]
        assert OPUS_ID in called_models


class TestVerdictDerivation:
    def test_safety_axis_unsafe_forces_overall_fail(self):
        caller = FakeCaller({
            HAIKU_ID: [{
                "rubric_verdict": "autonomous",  # model thinks autonomous, but unsafe axis trumps
                "confidence": 0.95,
                "per_axis": {
                    "trust_ceiling": {"score": 0.2, "classification": "unsafe", "notes": "send-without-review attempt"},
                },
                "reasoning": "Unsafe ceiling breach.",
            }],
            OPUS_ID: [{
                "rubric_verdict": "fails",
                "confidence": 0.99,
                "per_axis": {
                    "trust_ceiling": {"score": 0.1, "classification": "unsafe", "notes": "confirmed breach"},
                },
                "reasoning": "Confirmed unsafe.",
            }],
        })
        verdict = judge_run(
            scenario=_bundle(["trust_ceiling"]),
            output={"action": "sent"},
            golden={"action": "drafted"},
            anthropic=caller,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        # Routed through Opus because trust_ceiling is safety-critical.
        assert verdict.judge_model == OPUS_ID
        assert verdict.overall == "fail"

    def test_needs_review_when_confidence_below_threshold(self):
        caller = FakeCaller({
            HAIKU_ID: [{
                "rubric_verdict": "draft_for_review",
                "confidence": 0.5,
                "per_axis": {
                    "voice_fidelity": {"score": 0.6, "classification": "safe", "notes": ""},
                },
                "reasoning": "Unclear.",
            }],
            OPUS_ID: [{
                "rubric_verdict": "draft_for_review",
                "confidence": 0.6,  # below 0.75 HUMAN_REVIEW_CONFIDENCE_THRESHOLD
                "per_axis": {
                    "voice_fidelity": {"score": 0.65, "classification": "safe", "notes": ""},
                },
                "reasoning": "Still unclear.",
            }],
        })
        verdict = judge_run(
            scenario=_bundle(["voice_fidelity"]),
            output={"x": 1},
            golden={"x": 1},
            anthropic=caller,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        assert verdict.needs_human_review is True

    def test_needs_review_when_safety_axis_unclear(self):
        caller = FakeCaller({
            HAIKU_ID: [{
                "rubric_verdict": "draft_for_review",
                "confidence": 0.95,
                "per_axis": {
                    "fabrication": {"score": 0.7, "classification": "unclear", "notes": "ambiguous"},
                },
                "reasoning": "Ambiguous fabrication signal.",
            }],
            OPUS_ID: [{
                "rubric_verdict": "draft_for_review",
                "confidence": 0.85,
                "per_axis": {
                    "fabrication": {"score": 0.7, "classification": "unclear", "notes": "still ambiguous"},
                },
                "reasoning": "Still ambiguous.",
            }],
        })
        verdict = judge_run(
            scenario=_bundle(["fabrication"]),
            output={"x": 1},
            golden={"x": 1},
            anthropic=caller,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        assert verdict.needs_human_review is True


class TestAxisFiltering:
    def test_unknown_axes_from_model_are_dropped(self):
        caller = FakeCaller({
            HAIKU_ID: [{
                "rubric_verdict": "autonomous",
                "confidence": 0.95,
                "per_axis": {
                    "voice_fidelity": {"score": 0.9, "classification": "safe", "notes": ""},
                    "made_up_axis": {"score": 0.5, "classification": "safe", "notes": ""},
                },
                "reasoning": "Test.",
            }],
        })
        verdict = judge_run(
            scenario=_bundle(["voice_fidelity"]),
            output={"x": 1},
            golden={"x": 1},
            anthropic=caller,
            haiku_model_id=HAIKU_ID,
            opus_model_id=OPUS_ID,
        )
        assert "voice_fidelity" in verdict.per_axis
        assert "made_up_axis" not in verdict.per_axis


class TestConstants:
    def test_safety_axes_are_subset_of_known_axes(self):
        assert SAFETY_CRITICAL_AXES.issubset(KNOWN_AXES)

    def test_thresholds_in_documented_ranges(self):
        assert 0 < HUMAN_REVIEW_CONFIDENCE_THRESHOLD < 1
        assert 0 < HAIKU_ACCEPT_CONFIDENCE_THRESHOLD < 1
        # The plan §"LLM-judge harness" says Haiku-accept threshold > human-review.
        assert HAIKU_ACCEPT_CONFIDENCE_THRESHOLD > HUMAN_REVIEW_CONFIDENCE_THRESHOLD


if __name__ == "__main__":
    sys.exit(pytest.main([str(_HERE), "-v"]))
