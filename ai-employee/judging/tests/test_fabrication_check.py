"""Tests for ai-employee/judging/fabrication_check.py.

The deterministic fabrication pre-judge is the load-bearing fix from Devil's
Advocate #1: Pattern A/B is enterprise P0, and the LLM-judge has a known
blind spot on confidently approving fabrication. The check below runs
before the LLM-judge ever sees the agent's output.

Coverage:
  - is_placeholder recognizes the documented placeholder tokens
  - envelope check flags fabrication on placeholder→value transitions
  - envelope check respects input_available_fields (no false positive when
    the input legitimately supplies the value the agent rendered)
  - body check reports negative placeholder-count delta as fabrication
  - body check identifies which placeholder tokens went missing
  - top-level check() integrates envelope + body checks
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[2]))

from judging.fabrication_check import (  # noqa: E402
    FabricationFinding,
    check,
    check_body,
    check_envelope,
    is_placeholder,
)


class TestIsPlaceholder:
    def test_none_is_placeholder(self):
        assert is_placeholder(None) is True

    def test_empty_string_is_placeholder(self):
        assert is_placeholder("") is True
        assert is_placeholder("   ") is True

    def test_tbd_is_placeholder(self):
        assert is_placeholder("TBD") is True
        assert is_placeholder("tbd") is True
        assert is_placeholder("[TBD]") is True

    def test_partner_to_author_is_placeholder(self):
        assert is_placeholder("[partner to author]") is True
        assert is_placeholder("<partner to author>") is True

    def test_real_value_is_not_placeholder(self):
        assert is_placeholder("John Doe") is False
        assert is_placeholder("$50,000") is False
        assert is_placeholder("2026-05-25") is False

    def test_non_string_non_none_is_not_placeholder(self):
        assert is_placeholder(42) is False
        assert is_placeholder(["a", "b"]) is False
        assert is_placeholder({"k": "v"}) is False


class TestCheckEnvelope:
    def test_no_violation_when_both_placeholder(self):
        violations = check_envelope(
            golden_envelope={"client_name": "TBD", "incident_date": None},
            output_envelope={"client_name": "TBD", "incident_date": None},
        )
        assert violations == []

    def test_no_violation_when_both_real_value(self):
        violations = check_envelope(
            golden_envelope={"client_name": "Smith"},
            output_envelope={"client_name": "Smith"},
        )
        assert violations == []

    def test_violation_when_golden_placeholder_agent_value(self):
        violations = check_envelope(
            golden_envelope={"client_name": "TBD"},
            output_envelope={"client_name": "Jane Doe"},
        )
        assert len(violations) == 1
        assert "envelope.client_name" in violations[0]
        assert "TBD" in violations[0]
        assert "Jane Doe" in violations[0]

    def test_no_violation_when_input_supplies_field(self):
        violations = check_envelope(
            golden_envelope={"client_name": "TBD"},
            output_envelope={"client_name": "Jane Doe"},
            input_available_fields=["client_name"],
        )
        assert violations == []

    def test_violation_when_golden_null_agent_renders_default(self):
        violations = check_envelope(
            golden_envelope={"contact_name": None},
            output_envelope={"contact_name": "Business Owner"},
        )
        assert len(violations) == 1
        assert "contact_name" in violations[0]

    def test_multiple_violations_reported(self):
        violations = check_envelope(
            golden_envelope={"a": "TBD", "b": "TBD", "c": "TBD"},
            output_envelope={"a": "x", "b": "y", "c": "z"},
        )
        assert len(violations) == 3


class TestCheckBody:
    def test_no_delta_when_both_match(self):
        delta, missing = check_body(
            "Body with TBD in it.",
            "Body with TBD in it.",
        )
        assert delta == 0
        assert missing == []

    def test_negative_delta_when_agent_fewer_placeholders(self):
        delta, missing = check_body(
            "Demand: TBD. Liability: TBD.",
            "Demand: $50,000. Liability: TBD.",
        )
        assert delta < 0

    def test_missing_tokens_listed_when_agent_drops_them(self):
        delta, missing = check_body(
            "[partner to author] section here.",
            "Detailed analysis section here.",
        )
        assert delta < 0
        assert "[partner to author]" in missing

    def test_positive_delta_does_not_list_missing(self):
        delta, missing = check_body(
            "Real value here.",
            "TBD here. TBD again.",
        )
        # Agent ADDED placeholders rather than removing — that's not the
        # fabrication failure mode. delta is positive; missing stays empty.
        assert delta > 0
        assert missing == []


class TestCheck:
    def test_no_violation_when_aligned(self):
        finding = check(
            output={
                "envelope": {"client_name": "TBD"},
                "_body_text": "Demand: TBD. Strategy: TBD.",
            },
            golden={
                "envelope": {"client_name": "TBD"},
                "_body_text": "Demand: TBD. Strategy: TBD.",
            },
        )
        assert finding.violation_detected is False
        assert finding.envelope_violations == []
        assert finding.body_placeholder_delta == 0

    def test_envelope_violation_flagged(self):
        finding = check(
            output={
                "envelope": {"client_name": "Jane Doe"},
                "_body_text": "Body content here.",
            },
            golden={
                "envelope": {"client_name": "TBD"},
                "_body_text": "Body content here.",
            },
        )
        assert finding.violation_detected is True
        assert len(finding.envelope_violations) == 1

    def test_body_violation_flagged(self):
        finding = check(
            output={
                "envelope": {"k": "v"},
                "_body_text": "Demand: $75,000. Strategy: aggressive.",
            },
            golden={
                "envelope": {"k": "v"},
                "_body_text": "Demand: TBD. Strategy: TBD.",
            },
        )
        assert finding.violation_detected is True
        assert finding.body_placeholder_delta < 0

    def test_envelope_check_works_without_body(self):
        finding = check(
            output={"envelope": {"client_name": "TBD"}},
            golden={"envelope": {"client_name": "TBD"}},
        )
        assert finding.violation_detected is False

    def test_reasoning_populated_on_violation(self):
        finding = check(
            output={"envelope": {"a": "real value"}},
            golden={"envelope": {"a": "TBD"}},
        )
        assert finding.violation_detected is True
        assert "envelope" in finding.reasoning

    def test_as_audit_dict_shape(self):
        finding = check(
            output={"envelope": {"a": "x"}},
            golden={"envelope": {"a": "TBD"}},
        )
        payload = finding.as_audit_dict()
        assert payload["violation_detected"] is True
        assert isinstance(payload["envelope_violations"], list)
        assert "reasoning" in payload


if __name__ == "__main__":
    sys.exit(pytest.main([str(_HERE), "-v"]))
