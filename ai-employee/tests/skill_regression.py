"""Skill regression harness for issue #825.

Validates that each skill's reference fixture outputs (the `.md` files committed
alongside `.yaml` fixtures under `ai-employee/skills/<skill>/fixtures/`) match
their golden JSON snapshots. A diff between extracted output and golden = fail.

Design constraints from issue #825:

  1. NO external LLM or network calls. The reference `.md` file IS the ground
     truth for what the skill must produce. The harness extracts a stable JSON
     shape from each reference `.md` (envelope fields + body fingerprint), and
     diffs against the committed golden.
  2. Fail-closed on missing golden, unloadable fixture, or unloadable skill.
  3. Captain bypass: `python -m ai-employee.tests.skill_regression --regenerate <skill-slug>`
     re-writes the golden files for one skill. Reserved for intentional output
     changes the partner has reviewed.
  4. Skill version (from SKILL.md frontmatter) is included in the extracted
     output, so a version bump that changes the fixture set is caught.

Why the extracted JSON contains envelope + body fingerprint, not field-by-field
parsed prose:

  - The envelope (`reviewer_account_id`, `to`, `cc`, `bcc`, `subject`,
    `thread_id`, `matter_ref`, `drafted_by_skill`) is the structured contract
    `Email.create_draft` enforces per ADR 0005. Every PI skill emits this
    envelope verbatim. Drift in any envelope field is a P0 routing bug.
  - The body fingerprint (sha-256 of normalized body text) catches every
    other regression in one stable check. Body text changes ALWAYS imply the
    fixture's `.md` reference changed, which is the change the partner is
    reviewing.
  - This avoids the harness having to re-parse free-form prose for chronology
    rows / billing rows / exhibit lists. The reference `.md` IS the parsed
    structure; the harness's job is to detect that the reference is what the
    repo agreed it was.

Refusal fixtures (e.g. `03-citation-in-source-refusal.md`) are detected by
the absence of an `Email.create_draft envelope` block; their extracted output
shape is `{kind: "refusal", skill, code, matter_ref}` parsed from the
`SkillRefusalError` block.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
AI_EMPLOYEE_ROOT = REPO_ROOT / "ai-employee"

# ADR 0022 Stream 4 vertical-pack migration: skills now live in two roots —
# the legacy ai-employee/skills/ (shared skills) and the new vertical-pack
# location at ai-employee/verticals/<vertical>/addons/<addon>/skills/. The
# resolver tries each candidate root in priority order; the new location
# wins when a slug exists in both (the move ships the new copy first).
SKILL_ROOT_CANDIDATES: tuple[Path, ...] = (
    AI_EMPLOYEE_ROOT / "verticals" / "law-firm" / "addons" / "pi" / "skills",
    AI_EMPLOYEE_ROOT / "skills",
)
GOLDEN_ROOT_CANDIDATES: tuple[Path, ...] = (
    AI_EMPLOYEE_ROOT / "verticals" / "law-firm" / "addons" / "pi" / "tests" / "golden",
    Path(__file__).resolve().parent / "golden",
)


def resolve_skill_dir(skill_slug: str) -> Path:
    """Return the first existing skill directory across the candidate roots.

    Raises RegressionError when no candidate root contains the slug.
    """
    for root in SKILL_ROOT_CANDIDATES:
        candidate = root / skill_slug / "SKILL.md"
        if candidate.exists():
            return root / skill_slug
    searched = ", ".join(str(r / skill_slug) for r in SKILL_ROOT_CANDIDATES)
    raise RegressionError(f"skill not loadable: SKILL.md not found in any of: {searched}")


def resolve_golden_dir(skill_slug: str) -> Path:
    """Return the first golden directory that contains <slug>/ across roots."""
    for root in GOLDEN_ROOT_CANDIDATES:
        candidate = root / skill_slug
        if candidate.is_dir():
            return candidate
    # Fall back to the new vertical-pack root for "where to write" semantics
    # (callers compute golden paths via FixturePair.golden_path; nonexistent
    # is fine for newly-introduced skills before any goldens exist).
    return GOLDEN_ROOT_CANDIDATES[0] / skill_slug

# Four PI skills currently in scope per issue #825.
DEFAULT_SKILL_SLUGS: tuple[str, ...] = (
    "demand-letter-draft",
    "discovery-response",
    "opposing-counsel-response",
    "settlement-prep",
)

# Today-date placeholder appears in every reference body as
# `<today's date in "Month D, YYYY" format>` (or close variants). We normalize
# it so the body fingerprint is stable across run dates.
DATE_PLACEHOLDER_PATTERNS = (
    re.compile(r"`<today's date in \"Month D, YYYY\" format>`"),
    re.compile(r"`<today's date>`"),
    re.compile(r"`<ISO-8601 timestamp of run>`"),
)
DATE_PLACEHOLDER_REPLACEMENT = "<DATE_PLACEHOLDER>"

# Envelope-block sentinel found in every draft / memo reference md.
ENVELOPE_HEADER_RE = re.compile(
    r"The `Email\.create_draft` envelope:", re.IGNORECASE
)

# Body-start sentinel. Either "The draft body" or "The memo body".
BODY_SENTINEL_RE = re.compile(
    r"The (?:draft|memo) body \(everything below the next horizontal rule\):",
    re.IGNORECASE,
)

# Envelope line shape: ``- `key`: value`` where value may be a string, list,
# null, or bare token. We accept anything to the EOL and normalize per-key.
ENVELOPE_LINE_RE = re.compile(
    r"^-\s+`(?P<key>[a-zA-Z_]+)`:\s*(?P<value>.+)$"
)

# Refusal block sentinel.
REFUSAL_BLOCK_RE = re.compile(
    r"SkillRefusalError\s*\{(?P<body>[^}]*)\}", re.DOTALL
)

# Frontmatter parser is hand-rolled (no PyYAML in CI by default). We only need
# `name`, `version`, and the `client_facing_fields` field-name list.
FRONTMATTER_RE = re.compile(r"^---\n(?P<body>.*?)\n---\n", re.DOTALL)


@dataclass
class FixturePair:
    """One fixture: a YAML input file paired with its reference output md."""

    skill_slug: str
    fixture_name: str  # e.g. "01-clean-matter"
    yaml_path: Path
    reference_md_path: Path

    @property
    def golden_path(self) -> Path:
        return resolve_golden_dir(self.skill_slug) / f"{self.fixture_name}.json"


@dataclass
class ExtractedOutput:
    """Stable JSON shape extracted from one reference md.

    Two variants:
      - kind="draft": contains envelope + body fingerprint.
      - kind="refusal": contains refusal error fields.
    """

    kind: str  # "draft" | "refusal"
    skill_slug: str
    skill_version: str
    fixture_name: str
    envelope: dict[str, object] = field(default_factory=dict)
    body_sha256: str | None = None
    body_byte_count: int | None = None
    refusal: dict[str, object] = field(default_factory=dict)

    def to_json_obj(self) -> dict:
        # Sort keys for stable diff output regardless of insertion order.
        out: dict[str, object] = {
            "kind": self.kind,
            "skill_slug": self.skill_slug,
            "skill_version": self.skill_version,
            "fixture_name": self.fixture_name,
        }
        if self.kind == "draft":
            out["envelope"] = self.envelope
            out["body_sha256"] = self.body_sha256
            out["body_byte_count"] = self.body_byte_count
        elif self.kind == "refusal":
            out["refusal"] = self.refusal
        return out


class RegressionError(Exception):
    """Fail-closed errors: missing golden, unloadable skill, unloadable fixture."""


# --- skill + fixture discovery -------------------------------------------------


def parse_frontmatter(skill_md_text: str) -> dict[str, object]:
    """Hand-parse the YAML frontmatter for `name`, `version`, and
    `client_facing_fields` (name list only). We avoid PyYAML so the harness
    runs on stock Python in CI without an extra install step."""
    m = FRONTMATTER_RE.match(skill_md_text)
    if not m:
        raise RegressionError("SKILL.md is missing YAML frontmatter")
    body = m.group("body")
    out: dict[str, object] = {}
    # Extract name and version: top-level key: value scalars.
    for line in body.splitlines():
        if line.startswith("name:"):
            out["name"] = line.split(":", 1)[1].strip()
        elif line.startswith("version:"):
            out["version"] = line.split(":", 1)[1].strip()
    # Extract client_facing_fields entries' names. We look for the
    # `client_facing_fields:` line then iterate until indentation drops.
    field_names: list[str] = []
    in_block = False
    for line in body.splitlines():
        if line.startswith("client_facing_fields:"):
            in_block = True
            continue
        if in_block:
            # Block ends at the first non-indented non-list line.
            if line and not line.startswith(" ") and not line.startswith("\t"):
                in_block = False
                continue
            stripped = line.strip()
            if stripped.startswith("- name:"):
                name = stripped.split(":", 1)[1].strip()
                field_names.append(name)
    out["client_facing_fields"] = field_names
    return out


def load_skill_metadata(skill_slug: str) -> dict[str, object]:
    skill_dir = resolve_skill_dir(skill_slug)
    skill_md = skill_dir / "SKILL.md"
    text = skill_md.read_text(encoding="utf-8")
    return parse_frontmatter(text)


def discover_fixtures(skill_slug: str) -> list[FixturePair]:
    """Pair each `.yaml` fixture with its reference output `.md`.

    Reference md naming convention:
      - <stem>-draft.md   (most skills)
      - <stem>-memo.md    (settlement-prep, internal memo)
      - <stem>-refusal.md (refusal fixtures; note that the yaml stem and the
        md stem may diverge for refusals, e.g. `03-citation-in-source-matter.yaml`
        is paired with `03-citation-in-source-refusal.md`. We match by the
        leading two-digit fixture index.)
    """
    fixtures_dir = resolve_skill_dir(skill_slug) / "fixtures"
    if not fixtures_dir.exists():
        raise RegressionError(
            f"skill fixtures directory missing: {fixtures_dir}"
        )
    md_files = list(fixtures_dir.glob("*.md"))
    pairs: list[FixturePair] = []
    for yaml_path in sorted(fixtures_dir.glob("*.yaml")):
        stem = yaml_path.stem  # e.g. "01-clean-matter"
        # First try exact-stem suffixes.
        candidates = [
            fixtures_dir / f"{stem}-draft.md",
            fixtures_dir / f"{stem}-memo.md",
            fixtures_dir / f"{stem}-refusal.md",
        ]
        matched = [c for c in candidates if c.exists()]
        if not matched:
            # Fall back to matching by the leading fixture index. Pull the
            # leading digits and look for any md file with the same prefix
            # and one of the known suffixes.
            idx_match = re.match(r"^(\d+)-", stem)
            if idx_match:
                idx = idx_match.group(1)
                fallback = [
                    p for p in md_files
                    if p.name.startswith(f"{idx}-")
                    and p.name.endswith(("-draft.md", "-memo.md", "-refusal.md"))
                ]
                matched = fallback
        if not matched:
            raise RegressionError(
                f"fixture {yaml_path.name} has no reference output md "
                f"(expected one of -draft.md / -memo.md / -refusal.md "
                f"matching its stem or leading index)"
            )
        if len(matched) > 1:
            raise RegressionError(
                f"fixture {yaml_path.name} matches multiple reference md files: "
                f"{[p.name for p in matched]}"
            )
        # Use the YAML stem as the canonical fixture name (so the golden path
        # follows the input fixture, not the output suffix).
        pairs.append(
            FixturePair(
                skill_slug=skill_slug,
                fixture_name=stem,
                yaml_path=yaml_path,
                reference_md_path=matched[0],
            )
        )
    return pairs


# --- reference md extraction ---------------------------------------------------


def _normalize_envelope_value(raw: str) -> object:
    """Normalize an envelope line value. Strips trailing inline comments and
    backticks, parses JSON-looking lists, returns null/bare tokens cleanly."""
    raw = raw.strip()
    # Trim trailing parenthetical comments like `... (internal memo; ...)`.
    paren_idx = raw.find("` (")
    if paren_idx != -1:
        raw = raw[: paren_idx + 1]
    # JSON-shaped list: `["a", "b"]`. The value is wrapped in backticks.
    if raw.startswith("`") and raw.endswith("`"):
        inner = raw[1:-1]
        if inner.startswith("[") and inner.endswith("]"):
            try:
                return json.loads(inner)
            except json.JSONDecodeError:
                return inner
        if inner == "null":
            return None
        return inner
    # Bare null
    if raw.lower() == "null":
        return None
    return raw


def _normalize_body(body_text: str) -> str:
    text = body_text
    for pat in DATE_PLACEHOLDER_PATTERNS:
        text = pat.sub(DATE_PLACEHOLDER_REPLACEMENT, text)
    # Strip trailing whitespace per line; collapse trailing blank lines.
    lines = [line.rstrip() for line in text.split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines) + "\n"


def extract_envelope_block(md_text: str) -> dict[str, object] | None:
    """Return the parsed envelope dict, or None if no envelope is present
    (i.e. a refusal fixture)."""
    header_match = ENVELOPE_HEADER_RE.search(md_text)
    if not header_match:
        return None
    # Read forward until we hit the body sentinel or two consecutive blank
    # lines that close the list.
    after = md_text[header_match.end() :]
    envelope: dict[str, object] = {}
    body_match = BODY_SENTINEL_RE.search(after)
    block = after[: body_match.start()] if body_match else after
    for line in block.splitlines():
        m = ENVELOPE_LINE_RE.match(line.strip())
        if m:
            envelope[m.group("key")] = _normalize_envelope_value(m.group("value"))
    return envelope


def extract_body_text(md_text: str) -> str | None:
    """Pull the draft / memo body text (everything from after the body sentinel
    and its horizontal rule, to EOF). Returns None if no body sentinel."""
    sentinel = BODY_SENTINEL_RE.search(md_text)
    if not sentinel:
        return None
    after = md_text[sentinel.end() :]
    # The pattern is: sentinel line, blank line, "---", blank line, then body.
    # We split on the first standalone "---" after the sentinel.
    rule_idx = after.find("\n---\n")
    if rule_idx == -1:
        # No horizontal rule found; treat everything after sentinel as body.
        return after.lstrip("\n")
    return after[rule_idx + len("\n---\n") :]


def extract_refusal(md_text: str) -> dict[str, object] | None:
    """Parse the SkillRefusalError block. Returns a dict with skill, code,
    matter_ref. We do NOT include the user_facing_message in the structured
    output (it's prose and would over-trigger on wording changes); we include
    its sha256 instead so message rewrites are detected without diffing prose.
    """
    m = REFUSAL_BLOCK_RE.search(md_text)
    if not m:
        return None
    body = m.group("body")
    out: dict[str, object] = {}
    # Each line is `key: value,` or `key: "string",`. Hand-parse the three
    # structural keys we care about.
    for key in ("skill", "code", "matter_ref"):
        kpat = re.compile(rf'{key}\s*:\s*"([^"]+)"')
        km = kpat.search(body)
        if km:
            out[key] = km.group(1)
    # Hash the user_facing_message so a prose rewrite shows as a diff.
    ufm = re.search(r'user_facing_message\s*:\s*"((?:[^"\\]|\\.)*)"', body)
    if ufm:
        out["user_facing_message_sha256"] = hashlib.sha256(
            ufm.group(1).encode("utf-8")
        ).hexdigest()
    return out


def extract_output(fixture: FixturePair, skill_meta: dict[str, object]) -> ExtractedOutput:
    md_text = fixture.reference_md_path.read_text(encoding="utf-8")
    envelope = extract_envelope_block(md_text)
    skill_version = str(skill_meta.get("version", "unknown"))
    if envelope is None:
        # Refusal fixture.
        refusal = extract_refusal(md_text)
        if refusal is None:
            raise RegressionError(
                f"reference md {fixture.reference_md_path} has neither envelope "
                f"nor SkillRefusalError block; cannot extract structured output"
            )
        return ExtractedOutput(
            kind="refusal",
            skill_slug=fixture.skill_slug,
            skill_version=skill_version,
            fixture_name=fixture.fixture_name,
            refusal=refusal,
        )
    body_text = extract_body_text(md_text)
    if body_text is None:
        raise RegressionError(
            f"reference md {fixture.reference_md_path} has an envelope but no body sentinel"
        )
    normalized = _normalize_body(body_text)
    body_bytes = normalized.encode("utf-8")
    return ExtractedOutput(
        kind="draft",
        skill_slug=fixture.skill_slug,
        skill_version=skill_version,
        fixture_name=fixture.fixture_name,
        envelope=envelope,
        body_sha256=hashlib.sha256(body_bytes).hexdigest(),
        body_byte_count=len(body_bytes),
    )


# --- golden read/write/diff ---------------------------------------------------


def write_golden(extracted: ExtractedOutput, golden_path: Path) -> None:
    golden_path.parent.mkdir(parents=True, exist_ok=True)
    payload = extracted.to_json_obj()
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    golden_path.write_text(text, encoding="utf-8")


def read_golden(golden_path: Path) -> dict:
    if not golden_path.exists():
        raise RegressionError(
            f"golden missing at {golden_path}; "
            f"regenerate with `python -m ai-employee.tests.skill_regression "
            f"--regenerate <skill-slug>` after partner review of the new reference output"
        )
    return json.loads(golden_path.read_text(encoding="utf-8"))


def diff_summary(expected: dict, actual: dict) -> list[str]:
    """Produce a small list of human-readable diff lines for PR comments."""
    lines: list[str] = []
    keys = sorted(set(expected.keys()) | set(actual.keys()))
    for k in keys:
        e = expected.get(k, "<missing>")
        a = actual.get(k, "<missing>")
        if isinstance(e, dict) and isinstance(a, dict):
            sub_keys = sorted(set(e.keys()) | set(a.keys()))
            for sk in sub_keys:
                se = e.get(sk, "<missing>")
                sa = a.get(sk, "<missing>")
                if se != sa:
                    lines.append(f"  {k}.{sk}: expected={se!r} actual={sa!r}")
        elif e != a:
            lines.append(f"  {k}: expected={e!r} actual={a!r}")
    return lines


# --- run modes ---------------------------------------------------------------


@dataclass
class FixtureResult:
    skill_slug: str
    fixture_name: str
    passed: bool
    reason: str = ""
    diff_lines: list[str] = field(default_factory=list)


def run_regression(skill_slugs: Iterable[str]) -> list[FixtureResult]:
    results: list[FixtureResult] = []
    for slug in skill_slugs:
        try:
            meta = load_skill_metadata(slug)
            fixtures = discover_fixtures(slug)
        except RegressionError as exc:
            results.append(
                FixtureResult(
                    skill_slug=slug,
                    fixture_name="<setup>",
                    passed=False,
                    reason=str(exc),
                )
            )
            continue
        for fix in fixtures:
            try:
                actual = extract_output(fix, meta).to_json_obj()
                expected = read_golden(fix.golden_path)
            except RegressionError as exc:
                results.append(
                    FixtureResult(
                        skill_slug=slug,
                        fixture_name=fix.fixture_name,
                        passed=False,
                        reason=str(exc),
                    )
                )
                continue
            if actual == expected:
                results.append(
                    FixtureResult(
                        skill_slug=slug,
                        fixture_name=fix.fixture_name,
                        passed=True,
                    )
                )
            else:
                results.append(
                    FixtureResult(
                        skill_slug=slug,
                        fixture_name=fix.fixture_name,
                        passed=False,
                        reason="extracted output differs from golden",
                        diff_lines=diff_summary(expected, actual),
                    )
                )
    return results


def regenerate(skill_slugs: Iterable[str]) -> list[FixtureResult]:
    results: list[FixtureResult] = []
    for slug in skill_slugs:
        try:
            meta = load_skill_metadata(slug)
            fixtures = discover_fixtures(slug)
        except RegressionError as exc:
            results.append(
                FixtureResult(
                    skill_slug=slug,
                    fixture_name="<setup>",
                    passed=False,
                    reason=str(exc),
                )
            )
            continue
        for fix in fixtures:
            try:
                extracted = extract_output(fix, meta)
                write_golden(extracted, fix.golden_path)
            except RegressionError as exc:
                results.append(
                    FixtureResult(
                        skill_slug=slug,
                        fixture_name=fix.fixture_name,
                        passed=False,
                        reason=str(exc),
                    )
                )
                continue
            results.append(
                FixtureResult(
                    skill_slug=slug,
                    fixture_name=fix.fixture_name,
                    passed=True,
                    reason="golden regenerated",
                )
            )
    return results


# --- reporting ---------------------------------------------------------------


def print_text_report(results: list[FixtureResult]) -> None:
    by_skill: dict[str, list[FixtureResult]] = {}
    for r in results:
        by_skill.setdefault(r.skill_slug, []).append(r)
    for slug, items in by_skill.items():
        print(f"\n=== {slug} ===")
        for r in items:
            marker = "PASS" if r.passed else "FAIL"
            tail = f" ({r.reason})" if r.reason else ""
            print(f"  [{marker}] {r.fixture_name}{tail}")
            for line in r.diff_lines:
                print(line)


def write_markdown_report(results: list[FixtureResult], out_path: Path) -> None:
    """Write a markdown report suitable for sticky PR comment posting."""
    by_skill: dict[str, list[FixtureResult]] = {}
    for r in results:
        by_skill.setdefault(r.skill_slug, []).append(r)
    total = len(results)
    failed = sum(1 for r in results if not r.passed)
    status = "FAIL" if failed else "PASS"
    lines: list[str] = []
    lines.append(f"### Skill regression: {status}")
    lines.append("")
    lines.append(f"- Fixtures evaluated: {total}")
    lines.append(f"- Failures: {failed}")
    lines.append("")
    for slug, items in sorted(by_skill.items()):
        lines.append(f"#### {slug}")
        lines.append("")
        lines.append("| Fixture | Result | Notes |")
        lines.append("| ------- | ------ | ----- |")
        for r in items:
            marker = "pass" if r.passed else "fail"
            note = r.reason.replace("|", "\\|") if r.reason else ""
            lines.append(f"| `{r.fixture_name}` | {marker} | {note} |")
        # Include diff lines for failing fixtures, under a fenced block.
        any_diff = any(r.diff_lines for r in items)
        if any_diff:
            lines.append("")
            lines.append("<details><summary>Diff detail</summary>")
            lines.append("")
            lines.append("```")
            for r in items:
                if r.diff_lines:
                    lines.append(f"{r.fixture_name}:")
                    lines.extend(r.diff_lines)
            lines.append("```")
            lines.append("")
            lines.append("</details>")
        lines.append("")
    if failed:
        lines.append(
            "Captain bypass: after partner review of the new reference output, "
            "regenerate goldens with "
            "`python -m ai-employee.tests.skill_regression --regenerate <skill-slug>` "
            "and commit the updated `ai-employee/tests/golden/<skill-slug>/*.json`."
        )
        lines.append("")
    lines.append(
        "<sub>Generated by `ai-employee/tests/skill_regression.py` per "
        "issue #825. No network or LLM calls; reference fixture md files are "
        "ground truth.</sub>"
    )
    out_path.write_text("\n".join(lines), encoding="utf-8")


# --- CLI ---------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run skill regression against committed fixture goldens."
    )
    parser.add_argument(
        "--skill",
        action="append",
        dest="skills",
        help="Skill slug to run (repeatable). Defaults to the four PI skills.",
    )
    parser.add_argument(
        "--regenerate",
        action="append",
        dest="regenerate_skills",
        help="Skill slug to regenerate goldens for. Repeatable. "
        "Captain-only bypass per issue #825 acceptance criterion.",
    )
    parser.add_argument(
        "--markdown-out",
        type=Path,
        default=None,
        help="If set, write a markdown report to this path (for CI PR comment).",
    )
    args = parser.parse_args(argv)

    skill_slugs = tuple(args.skills) if args.skills else DEFAULT_SKILL_SLUGS

    if args.regenerate_skills:
        results = regenerate(args.regenerate_skills)
        print_text_report(results)
        # Regeneration "fails" if a fixture is structurally broken; otherwise
        # always succeeds.
        return 0 if all(r.passed for r in results) else 1

    results = run_regression(skill_slugs)
    print_text_report(results)
    if args.markdown_out:
        write_markdown_report(results, args.markdown_out)
    return 0 if all(r.passed for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
