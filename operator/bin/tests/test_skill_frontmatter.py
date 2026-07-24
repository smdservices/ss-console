"""Every skill's SKILL.md frontmatter must be parseable YAML.

The Hermes skill catalog silently SKIPS a skill whose SKILL.md frontmatter
fails to parse — the body ships to the Machine but the skill never appears in
the runtime catalog, so nothing can invoke it and no error surfaces anywhere.
That is exactly what happened on 2026-07-02: five PI-lifecycle skills authored
their `description:` as an unquoted single-line scalar containing a mid-sentence
": " (colon-space), YAML rejected the frontmatter, and the skills vanished from
the live catalog while their cron jobs still registered (translate does not
parse SKILL.md). Caught only by a live `skills_list` probe through the console
door.

This gate makes the failure loud at CI time instead of silent at runtime:
- frontmatter must exist (--- delimited) and parse as YAML
- `name` must match the skill directory (the catalog keys on it)
- `description` and `version` must be present and non-empty
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

SKILLS_DIR = Path(__file__).resolve().parents[2] / "skills"

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.S)


def _skill_md_paths() -> list[Path]:
    return sorted(SKILLS_DIR.glob("*/SKILL.md"))


def test_skill_catalog_nonempty() -> None:
    assert _skill_md_paths(), f"no SKILL.md files found under {SKILLS_DIR}"


@pytest.mark.parametrize("path", _skill_md_paths(), ids=lambda p: p.parent.name)
def test_skill_frontmatter_parses(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    match = FRONTMATTER_RE.match(text)
    assert match, f"{path.parent.name}: SKILL.md has no --- frontmatter block"

    try:
        frontmatter = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:  # pragma: no cover - the message is the point
        pytest.fail(
            f"{path.parent.name}: SKILL.md frontmatter is not valid YAML — the runtime "
            f"catalog will silently skip this skill. Use a block scalar (description: >-) "
            f"for prose containing ': '. Parser said: {exc}"
        )

    assert isinstance(frontmatter, dict), f"{path.parent.name}: frontmatter is not a mapping"
    assert frontmatter.get("name") == path.parent.name, (
        f"{path.parent.name}: frontmatter name {frontmatter.get('name')!r} must match the "
        f"skill directory (the catalog keys on it)"
    )
    for field in ("description", "version"):
        value = frontmatter.get(field)
        assert isinstance(value, str) and value.strip(), (
            f"{path.parent.name}: frontmatter `{field}` must be a non-empty string"
        )
