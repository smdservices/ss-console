"""Scenario runner — ties scenario_schema + fabrication_check + judge together.

For one fixture, given the scenario JSON path and the agent's actual output
(extracted in the same shape as the existing golden), produce a ``RunResult``
that captures:

  1. The deterministic ``fabrication_check`` finding. If fabrication is
     detected, the LLM-judge is NOT invoked; the verdict is auto-FAIL with
     confidence 1.0.
  2. The LLM-judge verdict (only when fabrication did not trip the gate).
  3. A flat overall status: ``pass`` / ``fail`` / ``review``.

This module is the seam between the existing pure-deterministic regression
harness (``skill_regression.py``, no LLM, golden snapshots) and the new
scenario layer (LLM-judge against rubric). The existing harness is
unchanged — PRs that don't touch a ``.scenario.json`` skip this path.

Outcome-shape check (additional to fabrication + LLM judge):

  - If ``scenario.expected_outcome == "draft"``: the agent output's ``kind``
    must be ``"draft"`` (i.e., the golden has an envelope).
  - If ``scenario.expected_outcome == "refusal"``: the agent output's
    ``kind`` must be ``"refusal"`` AND the refusal code must match
    ``scenario.expected_refusal_code``.

Outcome mismatches are auto-FAIL with confidence 1.0; the LLM-judge is not
invoked.

Tool-call and audit-action expectations:

  This runner does NOT verify tool calls or audit rows — those are surfaced
  by the agent's actual emitted audit log, which is checked by a separate
  audit-log assertion layer (L1 in the plan). The scenario carries the
  expectations as a hand-off to that layer. ``RunResult.scenario`` is
  returned so the caller can route those checks.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from judging import fabrication_check, judge as judge_mod
from judging.fabrication_check import FabricationFinding
from judging.judge import AnthropicCaller, ScenarioBundle, Verdict

import scenario_schema
from scenario_schema import Scenario


OverallStatus = Literal["pass", "fail", "review"]


@dataclass(frozen=True)
class RunResult:
    """Composite result of one scenario run."""

    overall: OverallStatus
    fabrication: FabricationFinding
    outcome_mismatch_reason: str | None  # not None when outcome shape was wrong
    verdict: Verdict | None  # None when fabrication or outcome auto-FAILed
    scenario: Scenario


def _check_outcome_shape(
    scenario: Scenario, output: Mapping[str, Any]
) -> str | None:
    """Return a string describing the mismatch, or None if outcome shape matches.

    ``output`` follows the existing golden shape from ``skill_regression.py``:
    a dict with ``kind`` = ``"draft"`` (with envelope) or ``"refusal"`` (with
    refusal dict).
    """
    kind = output.get("kind")
    if scenario.expected_outcome == "draft":
        if kind != "draft":
            return f"expected draft outcome, agent produced kind={kind!r}"
        return None
    if scenario.expected_outcome == "refusal":
        if kind != "refusal":
            return f"expected refusal outcome, agent produced kind={kind!r}"
        refusal = output.get("refusal") or {}
        actual_code = refusal.get("code")
        if actual_code != scenario.expected_refusal_code:
            return (
                f"expected refusal code {scenario.expected_refusal_code!r}, "
                f"agent refused with {actual_code!r}"
            )
        return None
    return f"unknown expected_outcome: {scenario.expected_outcome!r}"


def _load_rubric_excerpt(rubric_path: Path | None) -> str:
    """Read the grading rubric. The judge prompts a slice of it.

    Default path: ``ai-employee/grading/rubric.md``. Falls back to a
    one-line placeholder when the file is absent (test environments).
    """
    if rubric_path is None:
        return "(rubric excerpt unavailable; judge falls back to inline rubric)"
    if not rubric_path.exists():
        return "(rubric file not found at expected path)"
    return rubric_path.read_text(encoding="utf-8")


def run_scenario(
    *,
    scenario: Scenario,
    output: Mapping[str, Any],
    golden: Mapping[str, Any],
    anthropic: AnthropicCaller | None,
    haiku_model_id: str,
    opus_model_id: str,
    rubric_path: Path | None = None,
) -> RunResult:
    """Execute the scenario-layer verdict pipeline.

    Order:
      1. fabrication_check.check(output, golden, input_available_fields).
         Auto-FAIL if violation_detected.
      2. Outcome-shape check. Auto-FAIL on mismatch.
      3. LLM-judge via judge.judge_run with axes = scenario.judge_axes.
         The caller MUST provide an ``anthropic`` callable; ``None`` is
         allowed only when both prior gates auto-FAILed (lets test code
         exercise the auto-FAIL paths without wiring a model).

    Returns a RunResult. The caller can compute its own composite gate (e.g.,
    AND with tool-call + audit-row assertions) using the bundled scenario
    field.
    """
    finding = fabrication_check.check(
        output=output,
        golden=golden,
        input_available_fields=scenario.input_available_fields,
    )
    if finding.violation_detected:
        return RunResult(
            overall="fail",
            fabrication=finding,
            outcome_mismatch_reason=None,
            verdict=None,
            scenario=scenario,
        )

    outcome_mismatch = _check_outcome_shape(scenario, output)
    if outcome_mismatch is not None:
        return RunResult(
            overall="fail",
            fabrication=finding,
            outcome_mismatch_reason=outcome_mismatch,
            verdict=None,
            scenario=scenario,
        )

    if anthropic is None:
        # Both deterministic gates passed but caller did not wire the LLM.
        # Treat as "review" — caller has to decide whether to invoke or skip.
        return RunResult(
            overall="review",
            fabrication=finding,
            outcome_mismatch_reason=None,
            verdict=None,
            scenario=scenario,
        )

    bundle = ScenarioBundle(
        skill_slug=scenario.skill_slug,
        fixture_name=scenario.fixture_name,
        axes=scenario.judge_axes,
        rubric_excerpt=_load_rubric_excerpt(rubric_path),
    )
    verdict = judge_mod.judge_run(
        scenario=bundle,
        output=output,
        golden=golden,
        anthropic=anthropic,
        haiku_model_id=haiku_model_id,
        opus_model_id=opus_model_id,
    )
    return RunResult(
        overall=verdict.overall,
        fabrication=finding,
        outcome_mismatch_reason=None,
        verdict=verdict,
        scenario=scenario,
    )


def run_scenario_from_path(
    *,
    scenario_path: Path,
    output: Mapping[str, Any],
    golden: Mapping[str, Any],
    anthropic: AnthropicCaller | None,
    haiku_model_id: str,
    opus_model_id: str,
    rubric_path: Path | None = None,
) -> RunResult:
    """Convenience wrapper that loads the scenario JSON from disk first."""
    scenario = scenario_schema.load(scenario_path)
    return run_scenario(
        scenario=scenario,
        output=output,
        golden=golden,
        anthropic=anthropic,
        haiku_model_id=haiku_model_id,
        opus_model_id=opus_model_id,
        rubric_path=rubric_path,
    )
