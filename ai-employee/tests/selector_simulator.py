"""Skill-selector simulator — CI proof that compressed descriptions discriminate.

Per the test plan v2 §"Layer 1 — Contract & Boot — Static contract checks":

  SKILL.md format conformance + selector tests for the 5 PI skills.
  Selector simulator: synthetic query from each selector_test.md resolved
  against all 15 compressed descriptions; correct skill must win.

This module:

  1. Discovers every SKILL.md under ai-employee/skills/.
  2. Parses frontmatter to extract ``name`` + ``description`` (compressed,
     ≤60 chars, period-terminated per Hermes authoring spec).
  3. Discovers every ``tests/selector_test.md`` under each skill's dir.
  4. For each selector test, runs the simulator: presents the synthetic
     query + all 15 (name, description) cards to a SelectorCaller and reads
     back which skill the caller picks.
  5. Compares to ``Expected selection`` from the selector_test.md.

The SelectorCaller protocol is injectable so the test runs with no LLM in
local pytest (a deterministic-stub caller is provided). CI swaps in a real
caller that mimics Hermes' actual skill-selection prompt shape so the test
proves selection works against the same shape Hermes uses at runtime.

Failure modes the simulator catches:

  - description compression that drops discriminating language (the LLM
    can't tell two skills apart given only their names + descriptions)
  - selector_test.md authored with a query that doesn't actually
    discriminate the intended skill
  - SKILL.md frontmatter missing a description or name field

The simulator does NOT execute skills; it only tests the SELECTION layer.
"""

from __future__ import annotations

import re
import sys
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


_REPO_ROOT = Path(__file__).resolve().parents[2]
SKILLS_ROOT = _REPO_ROOT / "ai-employee" / "skills"

# Hand-rolled YAML frontmatter parser. Matches the same approach used by
# ai-employee/tests/skill_regression.py — avoids PyYAML in CI.
_FRONTMATTER_RE = re.compile(r"^---\n(?P<body>.*?)\n---\n", re.DOTALL)
_FIELD_RE = re.compile(
    r"^(?P<key>[a-zA-Z_]+):\s*(?P<value>.*)$"
)

# Patterns inside selector_test.md.
_QUERY_HEADER_RE = re.compile(r"##\s+Synthetic\s+query", re.IGNORECASE)
_EXPECTED_HEADER_RE = re.compile(r"##\s+Expected\s+selection", re.IGNORECASE)
# The "expected" body usually has the skill slug inside a backtick fence.
_BACKTICK_SLUG_RE = re.compile(r"`([^`]+)`")
# The "query" body has a single blockquote line ("> ...") that holds the prompt.
_BLOCKQUOTE_LINE_RE = re.compile(r"^>\s*(.*)$", re.MULTILINE)


@dataclass(frozen=True)
class SkillCard:
    """The (name, description) pair Hermes' selector reads at level-0 budget."""

    slug: str
    name: str
    description: str
    skill_md_path: Path

    @property
    def description_length(self) -> int:
        return len(self.description)


@dataclass(frozen=True)
class SelectorTest:
    """One selector_test.md scenario."""

    skill_slug: str
    query: str
    expected: str
    test_path: Path


@dataclass(frozen=True)
class SelectorResult:
    """The outcome of running one selector test through the simulator."""

    test: SelectorTest
    actual_selection: str
    passed: bool
    rationale: str = ""


class SelectorCaller(Protocol):
    """Abstract over the model call that picks a skill given a query.

    Implementations receive the user query plus a list of ``SkillCard``s and
    return the slug of the chosen skill. The simulator's correctness depends
    on this Protocol's behavior matching Hermes' actual selection logic.
    """

    def __call__(self, query: str, cards: list[SkillCard]) -> tuple[str, str]: ...


class FrontmatterParseError(ValueError):
    """SKILL.md is missing or malformed."""


class SelectorTestParseError(ValueError):
    """selector_test.md is missing required sections."""


def _strip_yaml_quotes(value: str) -> str:
    """Strip a single layer of surrounding single or double quotes if present."""
    v = value.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
        return v[1:-1]
    return v


def parse_skill_frontmatter(skill_md_text: str) -> dict[str, str]:
    """Extract ``name`` and ``description`` from a SKILL.md's YAML frontmatter."""
    m = _FRONTMATTER_RE.match(skill_md_text)
    if not m:
        raise FrontmatterParseError("SKILL.md missing YAML frontmatter")
    out: dict[str, str] = {}
    for line in m.group("body").splitlines():
        line_stripped = line.rstrip()
        # Only top-level scalars (no indentation).
        if not line_stripped or line_stripped[0] in (" ", "\t"):
            continue
        fm = _FIELD_RE.match(line_stripped)
        if not fm:
            continue
        key = fm.group("key")
        if key in ("name", "description"):
            out[key] = _strip_yaml_quotes(fm.group("value"))
    if "name" not in out:
        raise FrontmatterParseError("SKILL.md frontmatter missing required 'name' field")
    if "description" not in out:
        raise FrontmatterParseError(
            "SKILL.md frontmatter missing required 'description' field"
        )
    return out


def discover_skills(skills_root: Path = SKILLS_ROOT) -> list[SkillCard]:
    """Walk every SKILL.md under ``skills_root`` and return SkillCards."""
    cards: list[SkillCard] = []
    for skill_md in sorted(skills_root.glob("*/SKILL.md")):
        text = skill_md.read_text(encoding="utf-8")
        fm = parse_skill_frontmatter(text)
        cards.append(
            SkillCard(
                slug=skill_md.parent.name,
                name=fm["name"],
                description=fm["description"],
                skill_md_path=skill_md,
            )
        )
    return cards


def parse_selector_test(text: str) -> tuple[str, str]:
    """Extract (query, expected_slug) from a selector_test.md.

    The file must contain a ``## Synthetic query`` section with at least one
    ``> ...`` blockquote line, and an ``## Expected selection`` section with
    the slug inside backticks.
    """
    q_match = _QUERY_HEADER_RE.search(text)
    e_match = _EXPECTED_HEADER_RE.search(text)
    if not q_match:
        raise SelectorTestParseError("selector_test.md missing 'Synthetic query' section")
    if not e_match:
        raise SelectorTestParseError(
            "selector_test.md missing 'Expected selection' section"
        )

    # Slice between headers to find the query text.
    if q_match.start() < e_match.start():
        query_block = text[q_match.end() : e_match.start()]
        expected_block = text[e_match.end():]
    else:
        expected_block = text[e_match.end() : q_match.start()]
        query_block = text[q_match.end():]

    query_lines = [
        m.group(1).strip() for m in _BLOCKQUOTE_LINE_RE.finditer(query_block)
    ]
    if not query_lines:
        raise SelectorTestParseError(
            "selector_test.md Synthetic query section has no '>' blockquote line"
        )
    query = " ".join(query_lines).strip()

    slug_match = _BACKTICK_SLUG_RE.search(expected_block)
    if not slug_match:
        raise SelectorTestParseError(
            "selector_test.md Expected selection section has no backticked slug"
        )
    expected = slug_match.group(1).strip()
    return query, expected


def discover_selector_tests(
    skills_root: Path = SKILLS_ROOT,
) -> list[SelectorTest]:
    """Walk every selector_test.md under ``skills_root`` and return parsed tests."""
    tests: list[SelectorTest] = []
    for test_path in sorted(skills_root.glob("*/tests/selector_test.md")):
        text = test_path.read_text(encoding="utf-8")
        query, expected = parse_selector_test(text)
        skill_slug = test_path.parents[1].name
        tests.append(
            SelectorTest(
                skill_slug=skill_slug,
                query=query,
                expected=expected,
                test_path=test_path,
            )
        )
    return tests


# --- Default deterministic caller ---------------------------------------------


def keyword_overlap_caller(query: str, cards: list[SkillCard]) -> tuple[str, str]:
    """Deterministic stub caller — picks the card with the most keyword overlap.

    This is NOT a faithful model of Hermes' actual selector. It runs locally
    without an LLM so pytest can exercise the parsing + result-reporting paths
    of the simulator. CI swaps in a real LLM-backed caller (or runs `hermes`
    directly) to prove selection against the real selector.

    Algorithm: lowercase tokenize, intersect with each card's lowercased
    description tokens, return the card with the highest overlap. Ties
    broken alphabetically by slug for determinism.
    """
    def tokens(s: str) -> set[str]:
        return {t for t in re.split(r"\W+", s.lower()) if t and len(t) > 2}

    query_tokens = tokens(query)
    best_slug = ""
    best_score = -1
    rationale_parts: list[str] = []
    for card in sorted(cards, key=lambda c: c.slug):
        card_tokens = tokens(card.name + " " + card.description)
        overlap = len(query_tokens & card_tokens)
        rationale_parts.append(f"{card.slug}={overlap}")
        if overlap > best_score:
            best_score = overlap
            best_slug = card.slug
    rationale = "keyword_overlap: " + ", ".join(rationale_parts)
    return best_slug, rationale


# --- Top-level runner ---------------------------------------------------------


def run_simulator(
    *,
    caller: SelectorCaller,
    skills_root: Path = SKILLS_ROOT,
) -> list[SelectorResult]:
    """Run every selector_test.md through ``caller`` and report pass/fail."""
    cards = discover_skills(skills_root)
    tests = discover_selector_tests(skills_root)
    results: list[SelectorResult] = []
    for test in tests:
        actual, rationale = caller(test.query, cards)
        results.append(
            SelectorResult(
                test=test,
                actual_selection=actual,
                passed=(actual == test.expected),
                rationale=rationale,
            )
        )
    return results


def format_report(results: list[SelectorResult]) -> str:
    """Render a short text report for CLI / CI logs."""
    lines: list[str] = []
    total = len(results)
    failed = sum(1 for r in results if not r.passed)
    lines.append(f"Selector simulator: {total - failed}/{total} pass")
    lines.append("")
    for r in results:
        marker = "PASS" if r.passed else "FAIL"
        lines.append(
            f"  [{marker}] {r.test.skill_slug}: expected={r.test.expected!r} "
            f"actual={r.actual_selection!r}"
        )
        if not r.passed:
            lines.append(f"         query: {r.test.query!r}")
            lines.append(f"         rationale: {r.rationale}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    """CLI entry point. Runs the deterministic keyword stub by default."""
    results = run_simulator(caller=keyword_overlap_caller)
    print(format_report(results))
    return 0 if all(r.passed for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
