"""Scenario format v1 — sibling-file extension to the existing golden harness.

Per the test plan v2 §"Layer 2 — Behavioral regression" and Simplifier #4 from
the plan critique:

  The existing golden harness pairs ``<fixture>.yaml`` (input matter data) with
  a reference ``<fixture>-draft.md`` (or ``-memo.md`` / ``-refusal.md``) and a
  golden ``<fixture>.json`` (extracted envelope + body fingerprint OR refusal
  shape). The scenario format v2 does NOT replace any of those files. It ADDS
  one sibling JSON per fixture at ``<fixture>.scenario.json`` carrying scenario-
  level metadata the existing harness does not encode:

    - which skill should be selected for this input
    - which input fields the scenario considers available (vs. TBD)
    - which tool calls must / must not happen
    - which audit row action_types must be emitted
    - which Honcho conclusions may be written
    - which refusal triggers are allowed (for refusal fixtures)
    - which axes the LLM-judge should grade

The new scenario runner (``scenario_runner.py``) reads the scenario JSON +
the existing golden + the agent's actual output, and runs both the
deterministic fabrication checker (with ``input_available_fields`` passed
through) and the LLM-judge (with ``judge_axes`` passed through).

The existing ``skill_regression.py`` harness is completely untouched. The new
runner is additive: PRs that don't touch a scenario JSON skip the new path.

Schema versioning:

  ``scenario_version: 1`` is the v1 spec below. Any breaking change bumps the
  version and the runner branches on it. Adding new optional fields is non-
  breaking and stays at v1.

Outcome kinds:

  ``"draft"`` — skill produces a draft (Email.create_draft or matter memo).
  ``"refusal"`` — skill refuses with a documented refusal code (citation in
  source, prompt injection, fabrication probe trip, etc.).

Authoring rule for ``input_available_fields``:

  List every envelope or body field for which the input ARTIFACTS supply a
  real value the skill can legitimately source from. Fields NOT in the list
  must be TBD in the golden — if the agent renders a value at one of those
  fields, the fabrication checker auto-FAILs.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

SCENARIO_VERSION = 1

# Standard refusal codes from ai-employee/skills/*/references/. The list is
# intentionally a small enum; new refusal codes are added here when a new
# refusal path lands in a skill's reference policy.
KNOWN_REFUSAL_CODES: frozenset[str] = frozenset(
    {
        "citation_in_source",
        "prompt_injection",
        "fabrication_probe",
        "trust_ceiling_breach",
        "out_of_scope_matter",
        "missing_required_input",
        "ambiguous_classification",
    }
)

ScenarioOutcome = Literal["draft", "refusal"]


@dataclass(frozen=True)
class ToolCallExpectation:
    """Which tool calls the scenario expects vs. forbids.

    must_call: tool names that MUST appear in the audit log for the run.
    must_not_call: tool names that MUST NOT appear in the audit log.

    Tool names are colon-namespaced (e.g., ``Email.create_draft``,
    ``PracticeManagement.read_matter``) matching the capability-adapter
    contract in ``src/lib/ai-employee/capabilities/``.
    """

    must_call: list[str] = field(default_factory=list)
    must_not_call: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Scenario:
    """The full scenario metadata for one fixture.

    Lives at ``ai-employee/skills/<skill>/fixtures/<fixture>.scenario.json``
    alongside the existing input YAML and reference MD.
    """

    scenario_version: int
    skill_slug: str
    fixture_name: str
    expected_skill: str  # selector simulation: which skill should win
    expected_outcome: ScenarioOutcome
    input_available_fields: list[str] = field(default_factory=list)
    expected_tool_calls: ToolCallExpectation = field(default_factory=ToolCallExpectation)
    expected_audit_actions: list[str] = field(default_factory=list)
    expected_memory_writes: list[dict[str, Any]] = field(default_factory=list)
    allowed_refusal_triggers: list[str] = field(default_factory=list)
    expected_refusal_code: str | None = None  # required when outcome == "refusal"
    judge_axes: list[str] = field(default_factory=list)
    notes: str = ""


class ScenarioValidationError(ValueError):
    """Raised when a scenario JSON fails schema validation."""


def _require(payload: dict, key: str, scenario_path: Path | str) -> Any:
    if key not in payload:
        raise ScenarioValidationError(
            f"scenario at {scenario_path} missing required field: {key}"
        )
    return payload[key]


def parse(payload: dict, *, scenario_path: Path | str = "<unknown>") -> Scenario:
    """Parse a JSON payload into a Scenario, validating the shape.

    Raises ScenarioValidationError on any structural problem. Unknown extra
    fields are allowed (forward-compat); the parser logs a debug note but
    does not fail. Known fields with wrong types DO fail.
    """
    version = _require(payload, "scenario_version", scenario_path)
    if version != SCENARIO_VERSION:
        raise ScenarioValidationError(
            f"scenario at {scenario_path} has unsupported version {version!r} "
            f"(this parser handles v{SCENARIO_VERSION} only)"
        )

    skill_slug = _require(payload, "skill_slug", scenario_path)
    fixture_name = _require(payload, "fixture_name", scenario_path)
    expected_skill = _require(payload, "expected_skill", scenario_path)
    expected_outcome = _require(payload, "expected_outcome", scenario_path)
    if expected_outcome not in ("draft", "refusal"):
        raise ScenarioValidationError(
            f"scenario at {scenario_path} expected_outcome must be "
            f"'draft' or 'refusal', got {expected_outcome!r}"
        )

    tool_calls_raw = payload.get("expected_tool_calls", {}) or {}
    if not isinstance(tool_calls_raw, dict):
        raise ScenarioValidationError(
            f"scenario at {scenario_path} expected_tool_calls must be an object"
        )
    expected_tool_calls = ToolCallExpectation(
        must_call=list(tool_calls_raw.get("must_call", []) or []),
        must_not_call=list(tool_calls_raw.get("must_not_call", []) or []),
    )

    expected_refusal_code = payload.get("expected_refusal_code")
    if expected_outcome == "refusal":
        if not expected_refusal_code:
            raise ScenarioValidationError(
                f"scenario at {scenario_path} outcome=refusal requires "
                f"expected_refusal_code"
            )
        if expected_refusal_code not in KNOWN_REFUSAL_CODES:
            raise ScenarioValidationError(
                f"scenario at {scenario_path} expected_refusal_code "
                f"{expected_refusal_code!r} not in KNOWN_REFUSAL_CODES"
            )

    # Memory writes shape check: each entry must be a dict with at least
    # "peer" and either "conclusion_text" or "raw_observation" keys. We don't
    # enforce the full Honcho schema here; the memory-mirror tests will.
    for i, w in enumerate(payload.get("expected_memory_writes", []) or []):
        if not isinstance(w, dict):
            raise ScenarioValidationError(
                f"scenario at {scenario_path} expected_memory_writes[{i}] "
                f"must be an object"
            )
        if "peer" not in w:
            raise ScenarioValidationError(
                f"scenario at {scenario_path} expected_memory_writes[{i}] "
                f"missing required key 'peer'"
            )

    return Scenario(
        scenario_version=version,
        skill_slug=skill_slug,
        fixture_name=fixture_name,
        expected_skill=expected_skill,
        expected_outcome=expected_outcome,
        input_available_fields=list(payload.get("input_available_fields", []) or []),
        expected_tool_calls=expected_tool_calls,
        expected_audit_actions=list(payload.get("expected_audit_actions", []) or []),
        expected_memory_writes=list(payload.get("expected_memory_writes", []) or []),
        allowed_refusal_triggers=list(payload.get("allowed_refusal_triggers", []) or []),
        expected_refusal_code=expected_refusal_code,
        judge_axes=list(payload.get("judge_axes", []) or []),
        notes=str(payload.get("notes", "")),
    )


def load(scenario_path: Path) -> Scenario:
    """Load and validate a scenario JSON from disk."""
    if not scenario_path.exists():
        raise ScenarioValidationError(
            f"scenario file does not exist: {scenario_path}"
        )
    payload = json.loads(scenario_path.read_text(encoding="utf-8"))
    return parse(payload, scenario_path=scenario_path)


def scenario_path_for(fixture_dir: Path, fixture_name: str) -> Path:
    """Convention: scenario JSON lives at <fixtures>/<fixture_name>.scenario.json."""
    return fixture_dir / f"{fixture_name}.scenario.json"
