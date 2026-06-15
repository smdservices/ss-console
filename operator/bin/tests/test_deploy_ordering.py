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
_BOOTSTRAP = Path(__file__).resolve().parents[2] / "templates" / "bootstrap.sh"


def _code_lines(script: Path = _SCRIPT) -> list[str]:
    """Script lines with comment-only lines blanked (so prose can't match)."""
    out = []
    for line in script.read_text(encoding="utf-8").splitlines():
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


# ---------------------------------------------------------------------------
# bootstrap.sh: account-wide R2 key strip ordering (OP-P2-1)
# ---------------------------------------------------------------------------


def test_r2_account_key_strip_before_any_same_uid_child() -> None:
    """`unset R2_ACCESS_KEY_ID` must run BEFORE the webhook-gate launch.

    The webhook gate is a same-uid (hermes) background child. A child forked
    BEFORE the strip keeps the account-wide R2 key in its env, and a
    code-executing agent can read it from that sibling's /proc/<pid>/environ
    (verified on staging) and write the R2 config object — re-opening the
    self-loopback ceiling-raise (ADR 0044 Decision 8 / OP-P2-1). Stripping before
    any child is forked closes the leak. This guard fails loudly if a future edit
    moves the strip back after a child launch.
    """
    lines = _code_lines(_BOOTSTRAP)
    strip_idx = _first_index(lines, r"\bunset\b.*\bR2_ACCESS_KEY_ID\b")
    gate_idx = _first_index(lines, r"hermes-smd-webhook-gate")
    gateway_idx = _first_index(lines, r"\bexec\b.*\bhermes\b.*\bgateway\s+run\b")

    assert strip_idx != -1, "could not find the `unset R2_ACCESS_KEY_ID` strip in bootstrap.sh"
    assert gate_idx != -1, "could not find the webhook-gate launch in bootstrap.sh"
    assert gateway_idx != -1, "could not find the `exec ... hermes ... gateway run` line"

    assert strip_idx < gate_idx, (
        f"the account-wide R2 key strip (line {strip_idx + 1}) must run BEFORE the "
        f"webhook-gate launch (line {gate_idx + 1}) — a child forked before the strip "
        "retains the key, leaking it to a code-executing agent via /proc (OP-P2-1)."
    )
    assert strip_idx < gateway_idx, (
        "the R2 key strip must run before the gateway exec (it already did; keep it so)."
    )


def test_r2_account_key_strip_after_the_boot_time_fetches() -> None:
    """The strip must stay AFTER the last `aws s3 cp` that reads the key.

    The customer.yaml fetch (Step 2) and voice-vault sync (Step 2a) consume the
    account-wide key; moving the strip before them breaks the boot. This pins the
    lower bound so the strip can't be hoisted too far.
    """
    lines = _code_lines(_BOOTSTRAP)
    strip_idx = _first_index(lines, r"\bunset\b.*\bR2_ACCESS_KEY_ID\b")
    last_s3_cp = max(
        (i for i, line in enumerate(lines) if re.search(r"\baws\s+s3\s+cp\b", line)),
        default=-1,
    )
    assert last_s3_cp != -1, "could not find any `aws s3 cp` in bootstrap.sh"
    assert strip_idx > last_s3_cp, (
        f"the R2 key strip (line {strip_idx + 1}) must run AFTER the last `aws s3 cp` "
        f"(line {last_s3_cp + 1}) that reads the key, or the boot-time fetches break."
    )
