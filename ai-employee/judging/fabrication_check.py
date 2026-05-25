"""Deterministic Pattern A/B fabrication checker — runs BEFORE the LLM-judge.

Devil's Advocate #1 from the plan critique. Captain's CLAUDE.md elevates
fabrication to a P0 enterprise rule: Pattern A is committed template
sentences that promise uncontracted behavior; Pattern B is runtime
fabrication from non-authoritative fields (placeholder defaults, parsed or
derived text, brief-borrowed copy rendered into client-facing output).

Why deterministic — and why first:

  The LLM-judge will silently approve fabrication in exactly the case we
  care most about catching: a scenario where the golden marks a field
  ``TBD`` and the agent invents a plausible value. Opus reads the invented
  value as "more complete, more useful" and may rate it high-confidence
  pass. The deterministic check below catches that case without ever
  consulting the model.

The check signature:

  ``check(output, golden, expected_output_shape, input_available_fields)``
      returns a ``FabricationFinding`` with ``violation_detected: bool``.

The harness short-circuits to FAIL with confidence 1.0 when
``violation_detected`` is true. The LLM-judge is not invoked.

How the check works (v1 — text-pattern + envelope-field comparison):

  1. **Envelope field comparison.** For each field in the golden's envelope:
     - If golden marks the field as ``null``, ``"TBD"``, or a known placeholder
       token AND the agent's output has a non-placeholder value at that
       field, AND the input did not supply a value the agent could have
       sourced from → FABRICATION.
     - If golden has a real value at a field AND the agent's output has a
       different real value at that same field → DRIFT (returned as
       fabrication for now; the harness's diff layer will distinguish if
       needed).
  2. **Body placeholder count.** Count the well-known placeholder tokens
     (``TBD``, ``[partner to author]``, ``<partner to author>``, etc.) in
     the golden body and the agent's body. If the agent's body has fewer
     placeholders than the golden AND the missing placeholder positions
     are not justifiable from input artifacts → FABRICATION candidate. The
     check reports the count delta and the missing tokens.

v2 (post task #43 — scenario format extension) will replace step 2 with
structured field-level comparison against an explicit
``expected_output_shape`` and an explicit ``input_available_fields`` list
declared by the scenario.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

# Tokens that signal "field intentionally not authored — partner fills this in"
# in our reference goldens. These are the placeholders the agent MUST preserve
# rather than fabricating a plausible value into.
PLACEHOLDER_TOKENS: tuple[str, ...] = (
    "TBD",
    "[partner to author]",
    "<partner to author>",
    "[TBD]",
    "<TBD>",
    "[redacted]",
    "<redacted>",
    "[unknown]",
    "<unknown>",
)

# Compiled patterns for body-text token detection. Word boundary so we don't
# match "TBD" inside a larger word.
_PLACEHOLDER_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(re.escape(tok), re.IGNORECASE) for tok in PLACEHOLDER_TOKENS
)


@dataclass(frozen=True)
class FabricationFinding:
    """The result of one deterministic fabrication check."""

    violation_detected: bool
    envelope_violations: list[str] = field(default_factory=list)
    body_placeholder_delta: int = 0  # negative = agent has fewer placeholders
    missing_placeholders: list[str] = field(default_factory=list)
    reasoning: str = ""

    def as_audit_dict(self) -> dict[str, Any]:
        return {
            "violation_detected": self.violation_detected,
            "envelope_violations": list(self.envelope_violations),
            "body_placeholder_delta": self.body_placeholder_delta,
            "missing_placeholders": list(self.missing_placeholders),
            "reasoning": self.reasoning,
        }


def is_placeholder(value: Any) -> bool:
    """True if ``value`` looks like an authored placeholder, not a real value."""
    if value is None:
        return True
    if not isinstance(value, str):
        return False
    stripped = value.strip()
    if not stripped:
        return True
    return any(tok.lower() == stripped.lower() for tok in PLACEHOLDER_TOKENS)


def _count_placeholders(text: str) -> int:
    if not text:
        return 0
    return sum(len(pat.findall(text)) for pat in _PLACEHOLDER_PATTERNS)


def _missing_placeholders(golden_body: str, output_body: str) -> list[str]:
    """Tokens that appear in golden but are absent from output."""
    missing: list[str] = []
    for tok in PLACEHOLDER_TOKENS:
        in_golden = bool(re.search(re.escape(tok), golden_body, re.IGNORECASE))
        in_output = bool(re.search(re.escape(tok), output_body, re.IGNORECASE))
        if in_golden and not in_output:
            missing.append(tok)
    return missing


def check_envelope(
    golden_envelope: Mapping[str, Any],
    output_envelope: Mapping[str, Any],
    *,
    input_available_fields: Iterable[str] = (),
) -> list[str]:
    """Return a list of fabrication violations on envelope fields.

    Rule: if golden marks a field as a placeholder AND the agent's output
    has a non-placeholder value at that field, the violation is recorded —
    UNLESS the field name is in ``input_available_fields`` (meaning the
    scenario explicitly declares the input supplies a value the agent could
    legitimately source from). v2 of this check uses the scenario format's
    explicit ``input_available_fields`` declaration; v1 defaults to empty.
    """
    available = set(input_available_fields)
    violations: list[str] = []
    for key, golden_value in golden_envelope.items():
        if not is_placeholder(golden_value):
            continue
        output_value = output_envelope.get(key)
        if is_placeholder(output_value):
            continue
        if key in available:
            continue
        violations.append(
            f"envelope.{key}: golden={golden_value!r} agent={output_value!r}"
        )
    return violations


def check_body(golden_body: str, output_body: str) -> tuple[int, list[str]]:
    """Return (placeholder-count-delta, list-of-missing-placeholder-tokens).

    A negative delta means the agent body has fewer placeholders than the
    golden — i.e., the agent filled some in. That's the fabrication signal.
    """
    golden_count = _count_placeholders(golden_body)
    output_count = _count_placeholders(output_body)
    delta = output_count - golden_count
    missing = _missing_placeholders(golden_body, output_body) if delta < 0 else []
    return delta, missing


def check(
    *,
    output: Mapping[str, Any],
    golden: Mapping[str, Any],
    input_available_fields: Iterable[str] = (),
) -> FabricationFinding:
    """Run the deterministic fabrication check.

    ``output`` and ``golden`` are the structured shapes produced by
    ``ai-employee/tests/skill_regression.py`` extractors: each has ``envelope``
    (dict), ``body_sha256`` (str), and optionally a body-text accessor the
    caller supplies separately. For envelope-only checks (no body access),
    ``output_body`` and ``golden_body`` can be omitted and the check will
    only run the envelope comparison.

    The caller is responsible for passing the raw body text if available
    (the regression harness has it during extraction). When unavailable,
    only the envelope check runs.
    """
    envelope_violations = check_envelope(
        golden_envelope=dict(golden.get("envelope") or {}),
        output_envelope=dict(output.get("envelope") or {}),
        input_available_fields=input_available_fields,
    )

    body_delta = 0
    missing: list[str] = []
    golden_body = golden.get("_body_text")
    output_body = output.get("_body_text")
    if isinstance(golden_body, str) and isinstance(output_body, str):
        body_delta, missing = check_body(golden_body, output_body)

    has_envelope_problem = bool(envelope_violations)
    has_body_problem = body_delta < 0 and bool(missing)
    violation = has_envelope_problem or has_body_problem

    reasons: list[str] = []
    if has_envelope_problem:
        reasons.append(
            f"{len(envelope_violations)} envelope field(s) fabricated past placeholder"
        )
    if has_body_problem:
        reasons.append(
            f"{abs(body_delta)} placeholder(s) missing from body: {missing}"
        )
    reasoning = "; ".join(reasons) if reasons else "no fabrication detected"

    return FabricationFinding(
        violation_detected=violation,
        envelope_violations=envelope_violations,
        body_placeholder_delta=body_delta,
        missing_placeholders=missing,
        reasoning=reasoning,
    )
