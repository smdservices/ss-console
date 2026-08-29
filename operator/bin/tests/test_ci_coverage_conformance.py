"""CI coverage conformance (#1688) — the forcing-function culture applied to
the CI wiring itself.

The 2026-07-04 strategic review found five bin/tests suites (including the
skill-frontmatter gate and the seat-timezone regression test), the per-skill
pre_run tests, the migration tests, and templates/tests running NOWHERE in CI:
the workflow's pytest invocation was a hand-named list and its `paths:` filter
omitted whole directories, so a regression in those areas merged green.

This test pins the contract so the gap cannot silently reopen:

  1. Every ``test_*.py`` under ``operator/`` (excluding ``connectors/``,
     which the workflow's dedicated per-connector-venv conformance step
     covers) must fall under a directory the workflow's pytest step invokes.
  2. Every test file's path must be matched by at least one entry in the
     workflow's ``on.pull_request.paths`` filter — otherwise a change to that
     area does not even trigger the job that runs its tests.
  3. The workflow must keep triggering on itself.
  4. ``operator/pytest.ini``'s ``testpaths`` must equal the workflow's pytest
     arguments, so a bare local ``pytest`` runs exactly what CI runs. Drift
     here (found 2026-08-09: testpaths listed 3 of the 10 CI directories)
     means the local suite is quietly a subset and the gap surfaces on a red
     PR instead of on the developer's machine.

Stdlib + PyYAML only (the workflow's bare env installs exactly pytest+pyyaml,
and this file runs inside that env).
"""

from __future__ import annotations

import configparser
import re
from pathlib import Path

import yaml

OPERATOR_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = OPERATOR_DIR.parent
WORKFLOW_PATH = REPO_ROOT / ".github" / "workflows" / "operator-substrate.yml"
PYTEST_INI_PATH = OPERATOR_DIR / "pytest.ini"

# Directories whose tests are deliberately NOT part of the bare pytest step.
# connectors/ runs in the workflow's per-connector uv-venv conformance step
# (real installed artifact + live stdio MCP), never in the bare env.
# runners/ (ss#2613, the medchron runner) runs in its own uv-venv step for the
# same reason: it installs the connector client and needs its deps.
PYTEST_EXEMPT_TOPDIRS = {"connectors", "runners"}

# Cache/build dirs that legitimately contain no first-class tests.
IGNORED_PARTS = {".pytest_cache", ".ruff_cache", "__pycache__", ".rendered", "node_modules"}


def _load_workflow() -> dict:
    with WORKFLOW_PATH.open() as f:
        return yaml.safe_load(f)


def _trigger_paths(wf: dict) -> list[str]:
    # PyYAML parses the bare `on:` key as boolean True.
    on = wf.get("on") or wf.get(True)
    assert on is not None, "workflow has no `on:` block"
    return on["pull_request"]["paths"]


def _pytest_dirs(wf: dict) -> list[str]:
    """Extract the directory/file arguments of the workflow's pytest step."""
    for job in wf["jobs"].values():
        for step in job["steps"]:
            run = step.get("run", "")
            if "-m pytest" in run and step.get("working-directory") == "operator":
                args = run.split("-m pytest", 1)[1].split()
                return [a for a in args if not a.startswith("-")]
    raise AssertionError("no pytest step with working-directory: operator found in the workflow")


def _matches(pattern: str, path: str) -> bool:
    """Minimal GitHub-Actions-paths glob matcher for the shapes we use:
    ``dir/**`` (prefix), exact file, and single-``*`` segments."""
    if pattern.endswith("/**"):
        return path.startswith(pattern[:-2])
    if "*" not in pattern:
        return path == pattern
    regex = re.escape(pattern).replace(r"\*\*", ".*").replace(r"\*", "[^/]*")
    return re.fullmatch(regex, path) is not None


def _operator_test_files() -> list[Path]:
    out = []
    for p in OPERATOR_DIR.rglob("test_*.py"):
        rel = p.relative_to(OPERATOR_DIR)
        if IGNORED_PARTS.intersection(rel.parts):
            continue
        out.append(rel)
    return sorted(out)


def test_every_test_file_is_invoked_by_the_pytest_step() -> None:
    wf = _load_workflow()
    invoked = _pytest_dirs(wf)
    uncovered = []
    for rel in _operator_test_files():
        top = rel.parts[0]
        if top in PYTEST_EXEMPT_TOPDIRS:
            continue
        posix = rel.as_posix()
        if not any(posix == d or posix.startswith(d.rstrip("/") + "/") for d in invoked):
            uncovered.append(posix)
    assert not uncovered, (
        "test files not reachable by the CI pytest step (add their dir to the "
        f"pytest invocation in {WORKFLOW_PATH.name}): {uncovered}"
    )


def test_pytest_ini_testpaths_match_the_ci_invocation() -> None:
    cfg = configparser.ConfigParser()
    cfg.read(PYTEST_INI_PATH)
    testpaths = cfg["pytest"]["testpaths"].split()
    invoked = _pytest_dirs(_load_workflow())
    assert sorted(testpaths) == sorted(invoked), (
        "operator/pytest.ini testpaths and the workflow's pytest arguments have "
        f"drifted. testpaths-only: {sorted(set(testpaths) - set(invoked))}; "
        f"workflow-only: {sorted(set(invoked) - set(testpaths))}"
    )


def test_every_test_file_area_triggers_the_workflow() -> None:
    wf = _load_workflow()
    paths = _trigger_paths(wf)
    untriggered = []
    for rel in _operator_test_files():
        repo_rel = f"operator/{rel.as_posix()}"
        if not any(_matches(pat, repo_rel) for pat in paths):
            untriggered.append(repo_rel)
    assert not untriggered, (
        "test files whose changes would NOT trigger the substrate workflow "
        f"(extend on.pull_request.paths in {WORKFLOW_PATH.name}): {untriggered}"
    )


def test_workflow_triggers_on_itself() -> None:
    wf = _load_workflow()
    assert ".github/workflows/operator-substrate.yml" in _trigger_paths(wf)


def test_connector_tests_are_covered_by_the_conformance_step_trigger() -> None:
    # connectors/ is pytest-exempt above, so pin its trigger path explicitly:
    # if it left the filter, connector regressions would merge green too.
    wf = _load_workflow()
    assert any(_matches(p, "operator/connectors/smokeball/server.py") for p in _trigger_paths(wf))


def test_runner_tests_are_covered_by_their_own_step_and_trigger() -> None:
    # runners/ is pytest-exempt above (own venv step, ss#2613); pin both the
    # trigger path and the step so a runner regression cannot merge green.
    wf = _load_workflow()
    assert any(_matches(p, "operator/runners/medchron/medchron/driver.py") for p in _trigger_paths(wf))
    steps = wf["jobs"]["substrate"]["steps"]
    runs = "\n".join(s.get("run") or "" for s in steps)
    assert "./runners/medchron" in runs and "runners/medchron/tests" in runs, (
        "the medchron runner venv step is missing from operator-substrate.yml"
    )
