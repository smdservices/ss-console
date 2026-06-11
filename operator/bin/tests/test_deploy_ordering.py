"""Guard the Operator deploy ORDERING in provision-customer.sh.

The 2026-06-11 ~18-min customer-zero outage was caused by `fly secrets deploy`
committing staged secret REMOVALS to the OLD, still-running image BEFORE the new
image rolled — the old image crash-looped on its now-missing required var, hit
max-restart, and STOPPED with no self-heal. The fix relies on `fly deploy`
applying staged secrets atomically with the new release, and on NEVER committing
secrets to the live machine first.

These tests encode that as a permanent invariant (failure -> permanent guard) so
the class cannot regress:

  1. No `fly secrets deploy` runs before the `fly deploy` image roll.
  2. A post-deploy guard fails loudly if any secret remains STAGED (the
     staged-but-unapplied path the atomic claim depends on).

Run::

    cd operator && python -m pytest bin/tests/test_deploy_ordering.py -v
"""

from __future__ import annotations

import re
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parents[2] / "bin" / "provision-customer.sh"


def _code_lines() -> list[str]:
    """Script lines with comment-only lines blanked (so prose can't match)."""
    out = []
    for line in _SCRIPT.read_text(encoding="utf-8").splitlines():
        out.append("" if line.lstrip().startswith("#") else line)
    return out


def _first_index(lines: list[str], pattern: str) -> int:
    rx = re.compile(pattern)
    for i, line in enumerate(lines):
        if rx.search(line):
            return i
    return -1


def test_no_secrets_deploy_before_image_roll() -> None:
    """`fly secrets deploy` must never run before the `fly deploy` image roll.

    `fly secrets deploy` redeploys the CURRENT (old) image with the staged
    secrets; running it before the new image rolls is exactly the outage.
    """
    lines = _code_lines()
    deploy_idx = _first_index(lines, r"\bfly\s+deploy\s+--config\b")
    assert deploy_idx != -1, "could not find the `fly deploy --config` image roll"

    early = [
        i + 1
        for i, line in enumerate(lines)
        if i < deploy_idx and re.search(r"\bfly\s+secrets\s+deploy\b", line)
    ]
    assert not early, (
        f"`fly secrets deploy` appears before the image roll at line(s) {early} — "
        "this commits staged secrets to the OLD running image and caused the "
        "2026-06-11 outage. Let `fly deploy` apply staged secrets atomically."
    )


def test_post_deploy_no_staged_secrets_guard_exists() -> None:
    """After the deploy, the script must fail if any secret is left STAGED."""
    lines = _code_lines()
    deploy_idx = _first_index(lines, r"\bfly\s+deploy\s+--config\b")
    guard_idx = _first_index(lines, r"fly\s+secrets\s+list\b.*\|\s*grep\s+-qw\s+Staged")
    assert guard_idx != -1, (
        "missing the post-deploy staged-secret guard "
        "(`fly secrets list ... | grep -qw Staged`)"
    )
    assert guard_idx > deploy_idx, (
        "the staged-secret guard must run AFTER the `fly deploy` image roll, "
        f"not before (guard line {guard_idx + 1}, deploy line {deploy_idx + 1})"
    )
    # The guard must terminate provisioning (die) when staged secrets remain.
    window = "\n".join(lines[guard_idx : guard_idx + 4])
    assert "die " in window, (
        "the staged-secret guard must `die` when secrets remain staged"
    )
