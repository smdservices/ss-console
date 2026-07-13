"""Divergence guard for the git -> R2 customer.yaml projection (ADR 0044
Decision 2, issue #1840).

The silent-revert primitive: provision-customer.sh projects the git working
copy over the live R2 customer.yaml; any live-applied change not in git is
silently reverted (proven live 2026-07-13 — two racing checkouts projected
over R2 mid-deploy and crash-looped pilot-smokeball). These tests pin:

  1. the pure verdict matrix (classify) — a missing/mismatched provenance
     stamp can never allow a clobber;
  2. the CLI contract provision-customer.sh consumes (exit 0 proceed /
     exit 3 diverged, with the would-be-lost diff on stderr);
  3. the shell wiring — the guard runs before the upload, the upload carries
     the provenance stamp, and adopt-r2 mode never re-stamps R2.

Run::

    cd operator && python -m pytest bin/tests/test_config_divergence.py -v
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest

_LIB = Path(__file__).resolve().parents[1] / "lib"
sys.path.insert(0, str(_LIB.parent))

from lib.config_divergence import (  # noqa: E402
    ABSENT,
    CLEAN_PROJECTION,
    DIVERGED,
    IDENTICAL,
    classify,
    main,
)

_SCRIPT = Path(__file__).resolve().parents[1] / "provision-customer.sh"
_RECONCILER = Path(__file__).resolve().parents[1] / "reconcile-r2-config.sh"
_WORKFLOW = (
    Path(__file__).resolve().parents[3] / ".github" / "workflows" / "r2-config-reconcile.yml"
)

_GIT = "a" * 64
_LIVE = "b" * 64


# ---------------------------------------------------------------- classify


def test_absent_r2_object_is_first_provision() -> None:
    assert classify(_GIT, None, None) == ABSENT


def test_identical_digests_are_idempotent() -> None:
    assert classify(_GIT, _GIT, None) == IDENTICAL
    # identical wins even with a stale stamp — bytes agree, nothing to lose
    assert classify(_GIT, _GIT, _LIVE) == IDENTICAL


def test_untouched_prior_projection_is_safe_to_overwrite() -> None:
    """R2 == its own stamp != git: a newly merged git change deploying over
    the previous projection — the normal deploy path."""
    assert classify(_GIT, _LIVE, _LIVE) == CLEAN_PROJECTION


def test_missing_stamp_fails_toward_diverged() -> None:
    """No provenance stamp (live-apply write, pre-guard upload) can never
    allow a clobber."""
    assert classify(_GIT, _LIVE, None) == DIVERGED


def test_mismatched_stamp_fails_toward_diverged() -> None:
    """Object modified after projection (stamp is stale) — treat as live."""
    assert classify(_GIT, _LIVE, "c" * 64) == DIVERGED


# ---------------------------------------------------------------- CLI


def _write(tmp_path: Path, name: str, body: str) -> Path:
    p = tmp_path / name
    p.write_text(body)
    return p


def test_cli_proceeds_on_absent_and_identical(tmp_path: Path, capsys) -> None:
    git = _write(tmp_path, "git.yaml", "a: 1\n")
    assert main(["--git-file", str(git)]) == 0
    assert capsys.readouterr().out.strip() == ABSENT
    r2 = _write(tmp_path, "r2.yaml", "a: 1\n")
    assert main(["--git-file", str(git), "--r2-file", str(r2)]) == 0
    assert capsys.readouterr().out.strip() == IDENTICAL


def test_cli_proceeds_on_clean_projection(tmp_path: Path, capsys) -> None:
    git = _write(tmp_path, "git.yaml", "a: 2\n")
    r2 = _write(tmp_path, "r2.yaml", "a: 1\n")
    stamp = hashlib.sha256(r2.read_bytes()).hexdigest()
    assert main(["--git-file", str(git), "--r2-file", str(r2), "--projected-sha256", stamp]) == 0
    assert capsys.readouterr().out.strip() == CLEAN_PROJECTION


def test_cli_blocks_diverged_and_prints_the_lost_diff(tmp_path: Path, capsys) -> None:
    git = _write(tmp_path, "git.yaml", "ceiling: draft_for_review\n")
    r2 = _write(tmp_path, "r2.yaml", "ceiling: refused\n")
    assert main(["--git-file", str(git), "--r2-file", str(r2)]) == 3
    captured = capsys.readouterr()
    assert captured.out.strip() == DIVERGED
    assert "SILENTLY REVERT" in captured.err
    assert "-ceiling: refused" in captured.err  # what would be lost
    assert "+ceiling: draft_for_review" in captured.err  # what would replace it
    assert "SS_CONFIG_SOURCE=r2" in captured.err
    assert "SS_CONFIG_FORCE_GIT=1" in captured.err


def test_cli_treats_aws_text_none_as_no_stamp(tmp_path: Path, capsys) -> None:
    """`aws --output text` prints the literal 'None' for absent metadata —
    it must not be mistaken for a real stamp value."""
    git = _write(tmp_path, "git.yaml", "a: 2\n")
    r2 = _write(tmp_path, "r2.yaml", "a: 1\n")
    assert (
        main(["--git-file", str(git), "--r2-file", str(r2), "--projected-sha256", "None"]) == 3
    )
    capsys.readouterr()


def test_cli_errors_on_missing_files(tmp_path: Path, capsys) -> None:
    assert main(["--git-file", str(tmp_path / "nope.yaml")]) == 2
    git = _write(tmp_path, "git.yaml", "a: 1\n")
    assert main(["--git-file", str(git), "--r2-file", str(tmp_path / "nope.yaml")]) == 2
    capsys.readouterr()


# ---------------------------------------------------------------- wiring


def _code_lines(script: Path) -> list[str]:
    out = []
    for line in script.read_text(encoding="utf-8").splitlines():
        out.append("" if line.lstrip().startswith("#") else line)
    return out


def _first_index(lines: list[str], needle: str) -> int:
    for i, line in enumerate(lines):
        if needle in line:
            return i
    pytest.fail(f"{needle!r} not found in script code lines")


def test_guard_runs_before_the_r2_upload() -> None:
    lines = _code_lines(_SCRIPT)
    guard = _first_index(lines, "config_divergence.py")
    upload = _first_index(lines, 'aws s3 cp "${CUSTOMER_YAML}"')
    assert guard < upload, "divergence guard must run before the git -> R2 projection"


def test_upload_carries_the_provenance_stamp() -> None:
    lines = _code_lines(_SCRIPT)
    upload = _first_index(lines, 'aws s3 cp "${CUSTOMER_YAML}"')
    window = "\n".join(lines[upload : upload + 6])
    assert "projected-sha256=" in window, "projection upload must stamp projected-sha256 metadata"


def test_diverged_default_is_fail_closed() -> None:
    body = _SCRIPT.read_text(encoding="utf-8")
    assert "SS_CONFIG_FORCE_GIT" in body
    assert 'die "R2 config has live-applied changes' in body, (
        "the diverged verdict must die by default, not warn-and-continue"
    )


def test_adopt_r2_mode_skips_the_upload() -> None:
    """SS_CONFIG_SOURCE=r2 must not re-stamp R2: re-uploading the live bytes
    with a projection stamp would launder a live apply into a clean
    projection the NEXT run would silently overwrite."""
    body = _SCRIPT.read_text(encoding="utf-8")
    assert "SS_CONFIG_SOURCE" in body
    assert "SKIP_R2_UPLOAD" in body
    lines = _code_lines(_SCRIPT)
    skip = _first_index(lines, 'if [ "${SKIP_R2_UPLOAD}" = "1" ]')
    upload = _first_index(lines, 'aws s3 cp "${CUSTOMER_YAML}"')
    assert skip < upload, "the skip branch must gate the projection upload"


def test_reconciler_exists_and_is_wired_to_the_schedule() -> None:
    assert _RECONCILER.is_file(), "ADR 0044 Decision 4 reconciler script missing"
    assert _RECONCILER.stat().st_mode & 0o111, "reconciler must be executable"
    body = _RECONCILER.read_text(encoding="utf-8")
    assert "config_divergence.py" in body, "reconciler must reuse the guard's verdict logic"
    wf = _WORKFLOW.read_text(encoding="utf-8")
    assert "schedule:" in wf and "reconcile-r2-config.sh --pr" in wf
    assert "::error::" in wf, "missing-secrets case must fail loudly, never skip silently"
