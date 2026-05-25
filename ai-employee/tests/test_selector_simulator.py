"""Tests for ai-employee/tests/selector_simulator.py.

Coverage:
  - parse_skill_frontmatter extracts name + description correctly
  - parse_skill_frontmatter rejects malformed SKILL.md
  - parse_selector_test extracts query + expected slug
  - parse_selector_test rejects missing sections
  - discover_skills finds all 15 skills in the live repo
  - discover_selector_tests finds the 5 PI selector tests in the live repo
  - run_simulator with a fake caller reports pass/fail correctly
  - format_report produces a readable summary

The deterministic ``keyword_overlap_caller`` is exercised but its actual
correctness against the 5 PI tests is not asserted — it's a stub. Real
selector correctness is gated by the CI run that swaps in a real LLM caller.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parent))

from selector_simulator import (  # noqa: E402
    SKILLS_ROOT,
    FrontmatterParseError,
    SelectorTest,
    SelectorTestParseError,
    SkillCard,
    discover_selector_tests,
    discover_skills,
    format_report,
    keyword_overlap_caller,
    parse_selector_test,
    parse_skill_frontmatter,
    run_simulator,
)


SAMPLE_FRONTMATTER = """---
name: example-skill
description: 'Does an example thing for the partner.'
version: 0.1.0
author: SMD Services
---

Body content here.
"""


class TestParseFrontmatter:
    def test_extracts_name_and_description(self):
        fm = parse_skill_frontmatter(SAMPLE_FRONTMATTER)
        assert fm["name"] == "example-skill"
        assert fm["description"] == "Does an example thing for the partner."

    def test_strips_single_quotes(self):
        text = "---\nname: foo\ndescription: 'quoted value.'\n---\nbody"
        fm = parse_skill_frontmatter(text)
        assert fm["description"] == "quoted value."

    def test_strips_double_quotes(self):
        text = '---\nname: foo\ndescription: "quoted value."\n---\nbody'
        fm = parse_skill_frontmatter(text)
        assert fm["description"] == "quoted value."

    def test_missing_frontmatter_rejected(self):
        with pytest.raises(FrontmatterParseError, match="missing YAML frontmatter"):
            parse_skill_frontmatter("no frontmatter here")

    def test_missing_name_rejected(self):
        text = "---\ndescription: 'only description'\n---\nbody"
        with pytest.raises(FrontmatterParseError, match="name"):
            parse_skill_frontmatter(text)

    def test_missing_description_rejected(self):
        text = "---\nname: foo\n---\nbody"
        with pytest.raises(FrontmatterParseError, match="description"):
            parse_skill_frontmatter(text)


SAMPLE_SELECTOR_TEST = """# Selector test — example-skill

## Synthetic query

> Help me triage a new inbound matter.

## Expected selection

`example-skill`

## Result

Pass.
"""


class TestParseSelectorTest:
    def test_extracts_query_and_expected(self):
        query, expected = parse_selector_test(SAMPLE_SELECTOR_TEST)
        assert "triage" in query
        assert expected == "example-skill"

    def test_multi_line_query_joined(self):
        text = SAMPLE_SELECTOR_TEST.replace(
            "> Help me triage a new inbound matter.",
            "> Help me triage a new inbound matter.\n> Bonus context line.",
        )
        query, _ = parse_selector_test(text)
        assert "triage" in query
        assert "Bonus context" in query

    def test_missing_query_section_rejected(self):
        text = "## Expected selection\n\n`foo`\n"
        with pytest.raises(SelectorTestParseError, match="Synthetic query"):
            parse_selector_test(text)

    def test_missing_expected_section_rejected(self):
        text = "## Synthetic query\n\n> A query.\n"
        with pytest.raises(SelectorTestParseError, match="Expected selection"):
            parse_selector_test(text)

    def test_missing_blockquote_rejected(self):
        text = (
            "## Synthetic query\n\nNo blockquote here.\n\n"
            "## Expected selection\n\n`foo`\n"
        )
        with pytest.raises(SelectorTestParseError, match="blockquote"):
            parse_selector_test(text)

    def test_missing_backtick_slug_rejected(self):
        text = (
            "## Synthetic query\n\n> A query.\n\n"
            "## Expected selection\n\nfoo bare-text\n"
        )
        with pytest.raises(SelectorTestParseError, match="backticked slug"):
            parse_selector_test(text)


class TestDiscoverLive:
    """Tests against the real ai-employee/skills/ tree."""

    def test_finds_all_15_skills(self):
        cards = discover_skills()
        assert len(cards) == 15
        slugs = {c.slug for c in cards}
        # Spot-check a few known slugs.
        assert "law-pi-intake-triage" in slugs
        assert "law-pi-demand-letter-draft" in slugs
        assert "inbox-triage" in slugs
        assert "status-report-assembler" in slugs

    def test_every_description_under_60_chars(self):
        """Hermes authoring spec — load-bearing for selection at level-0 budget."""
        cards = discover_skills()
        for card in cards:
            assert card.description_length <= 60, (
                f"skill {card.slug} description is "
                f"{card.description_length} chars: {card.description!r}"
            )

    def test_every_description_period_terminated(self):
        cards = discover_skills()
        for card in cards:
            assert card.description.endswith("."), (
                f"skill {card.slug} description is not period-terminated: "
                f"{card.description!r}"
            )

    def test_finds_5_pi_selector_tests(self):
        tests = discover_selector_tests()
        skill_slugs = {t.skill_slug for t in tests}
        # We require at least the 5 PI skills to have selector tests.
        expected_pi = {
            "law-pi-intake-triage",
            "law-pi-demand-letter-draft",
            "law-pi-opposing-counsel-response",
            "law-pi-discovery-response",
            "law-pi-settlement-prep",
        }
        missing = expected_pi - skill_slugs
        assert not missing, f"missing selector tests for: {sorted(missing)}"

    def test_every_selector_test_expects_a_real_skill(self):
        cards = discover_skills()
        valid_slugs = {c.slug for c in cards}
        tests = discover_selector_tests()
        for t in tests:
            assert t.expected in valid_slugs, (
                f"selector_test at {t.test_path} expects {t.expected!r} which is "
                f"not a discovered skill"
            )


class TestRunSimulator:
    def test_simulator_with_fake_caller_reports_pass_and_fail(self):
        # Fake caller always picks the first card's slug. Will pass for
        # tests whose expected slug happens to match that, fail otherwise.
        def fake_caller(query, cards):
            return cards[0].slug, "stub: always picks first card alphabetically"

        results = run_simulator(caller=fake_caller)
        # Some pass, some fail — the test is that BOTH conditions surface.
        assert len(results) > 0
        # The first-card slug alphabetically is "ar-chaser" (no PI skills lead).
        # All 5 PI selector tests should FAIL with this caller.
        pi_fails = [
            r for r in results
            if r.test.expected.startswith("law-pi-") and not r.passed
        ]
        assert len(pi_fails) == 5

    def test_simulator_with_perfect_oracle_reports_all_pass(self):
        # Perfect oracle: pre-load the expected slug for each discovered
        # selector_test.md by looking up the test's expected field. This
        # proves the simulator's pipeline (discover, parse, route, compare)
        # works end-to-end; it does NOT prove the actual descriptions
        # discriminate against a real LLM caller. That's the CI run's job.
        tests = discover_selector_tests()
        query_to_expected = {t.query: t.expected for t in tests}

        def oracle_caller(query, cards):
            slug = query_to_expected.get(query, "unknown")
            return slug, "perfect oracle from pre-loaded test map"

        results = run_simulator(caller=oracle_caller)
        # Every selector test in the repo must pass with a perfect oracle.
        failed = [r for r in results if not r.passed]
        assert not failed, (
            f"perfect oracle failed on {[r.test.expected for r in failed]}; "
            f"this means the simulator's pipeline has a bug"
        )


class TestKeywordOverlapCaller:
    def test_returns_slug_and_rationale_string(self):
        cards = [
            SkillCard(
                slug="foo-skill",
                name="foo",
                description="Handles foo widgets.",
                skill_md_path=Path("/tmp/foo"),
            ),
            SkillCard(
                slug="bar-skill",
                name="bar",
                description="Handles bar widgets.",
                skill_md_path=Path("/tmp/bar"),
            ),
        ]
        slug, rationale = keyword_overlap_caller("Help me with foo widgets.", cards)
        assert slug == "foo-skill"
        assert "keyword_overlap" in rationale
        assert "foo-skill" in rationale

    def test_no_overlap_returns_first_alphabetically(self):
        cards = [
            SkillCard(
                slug="zeta-skill",
                name="zeta",
                description="Handles zeta widgets.",
                skill_md_path=Path("/tmp/z"),
            ),
            SkillCard(
                slug="alpha-skill",
                name="alpha",
                description="Handles alpha widgets.",
                skill_md_path=Path("/tmp/a"),
            ),
        ]
        slug, _ = keyword_overlap_caller("Nothing matches here.", cards)
        # With zero overlap, alphabetical first wins (alpha-skill).
        assert slug == "alpha-skill"


class TestFormatReport:
    def test_reports_pass_count(self):
        # Build synthetic results.
        test = SelectorTest(
            skill_slug="foo",
            query="q",
            expected="foo",
            test_path=Path("/tmp/foo/selector_test.md"),
        )
        from selector_simulator import SelectorResult
        results = [
            SelectorResult(test=test, actual_selection="foo", passed=True),
            SelectorResult(test=test, actual_selection="bar", passed=False, rationale="picked bar"),
        ]
        report = format_report(results)
        assert "1/2 pass" in report
        assert "[PASS]" in report
        assert "[FAIL]" in report
        assert "picked bar" in report


if __name__ == "__main__":
    sys.exit(pytest.main([str(_HERE), "-v"]))
