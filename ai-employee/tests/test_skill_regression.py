"""Pytest entry for the skill regression harness.

This file makes `pytest ai-employee/tests/` (or `cd ai-employee && pytest tests/`)
exercise the same regression that the CI workflow runs. Each fixture becomes
a pytest case via parametrize so failures surface individually.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make `skill_regression` importable when pytest runs from any cwd inside the
# repo. The harness file lives in this same directory.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from skill_regression import (  # noqa: E402  (after sys.path mutation)
    DEFAULT_SKILL_SLUGS,
    discover_fixtures,
    extract_output,
    load_skill_metadata,
    read_golden,
)


def _all_fixture_ids() -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for slug in DEFAULT_SKILL_SLUGS:
        for fix in discover_fixtures(slug):
            pairs.append((slug, fix.fixture_name))
    return pairs


@pytest.mark.parametrize(
    ("skill_slug", "fixture_name"),
    _all_fixture_ids(),
    ids=lambda v: v,
)
def test_fixture_matches_golden(skill_slug: str, fixture_name: str) -> None:
    meta = load_skill_metadata(skill_slug)
    fix = next(
        f for f in discover_fixtures(skill_slug) if f.fixture_name == fixture_name
    )
    actual = extract_output(fix, meta).to_json_obj()
    expected = read_golden(fix.golden_path)
    assert actual == expected, (
        f"{skill_slug}/{fixture_name}: extracted output diverges from golden. "
        f"If the change is intentional and partner-reviewed, regenerate with "
        f"`python3 ai-employee/tests/skill_regression.py --regenerate {skill_slug}` "
        f"followed by `npx prettier --write ai-employee/tests/golden/`."
    )
