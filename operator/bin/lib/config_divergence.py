"""R2 customer.yaml divergence guard — ADR 0044 Decision 2, issue #1840.

The silent-revert primitive: ``provision-customer.sh`` projects the git
working copy's customer.yaml over ``vaults/<slug>/customer.yaml`` in R2. R2
is the operational source of truth (ADR 0044 Decision 1) — the console
live-apply path writes it and the root config applier pulls from it — so a
git-read projection over a live-applied config silently reverts the live
change. Proven live 2026-07-13: two sessions' checkouts at different commits
each projected over R2 mid-deploy and crash-looped pilot-smokeball.

The guard distinguishes the two divergence cases using a provenance stamp:
every git projection uploads with user metadata ``projected-sha256`` set to
the digest of the uploaded bytes. On the next provision run:

- R2 object ABSENT ............... first provision, project.
- R2 digest == git digest ........ IDENTICAL, project (idempotent).
- R2 digest == its own stamp ..... CLEAN_PROJECTION: the object is an
  untouched previous git projection; the divergence is a newly merged git
  change. Projecting is the normal deploy path — proceed.
- otherwise ...................... DIVERGED: the object was written by
  something other than a git projection (console live-apply, manual edit),
  or modified after projection. Projecting would silently revert it —
  fail closed (exit 3) and print the diff that would be lost.

The stamp is load-bearing in one direction only: a MISSING or MISMATCHED
stamp can never allow a clobber (it fails toward DIVERGED). The console
live-apply writer does not set the stamp, so its writes are always guarded.

Exit codes (consumed by provision-customer.sh):
    0  safe to project (ABSENT / IDENTICAL / CLEAN_PROJECTION)
    2  usage / IO error
    3  DIVERGED — do not project without an explicit human decision
       (SS_CONFIG_FORCE_GIT=1 to revert, SS_CONFIG_SOURCE=r2 to adopt R2)
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import sys
from pathlib import Path

ABSENT = "absent"
IDENTICAL = "identical"
CLEAN_PROJECTION = "clean-projection"
DIVERGED = "diverged"


def classify(git_sha256: str, r2_sha256: str | None, projected_sha256: str | None) -> str:
    """Pure verdict from the three digests. ``r2_sha256`` is None when the R2
    object does not exist; ``projected_sha256`` is None when the object
    carries no provenance stamp (pre-guard uploads, live-apply writes)."""
    if r2_sha256 is None:
        return ABSENT
    if r2_sha256 == git_sha256:
        return IDENTICAL
    if projected_sha256 is not None and projected_sha256 == r2_sha256:
        return CLEAN_PROJECTION
    return DIVERGED


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--git-file", required=True, help="git working-copy customer.yaml")
    parser.add_argument(
        "--r2-file", default=None, help="downloaded current R2 object (omit when absent)"
    )
    parser.add_argument(
        "--projected-sha256",
        default=None,
        help="the R2 object's projected-sha256 user metadata (omit or pass '' / 'None' when unset)",
    )
    args = parser.parse_args(argv)

    git_path = Path(args.git_file)
    if not git_path.is_file():
        print(f"config-divergence: git file not found: {git_path}", file=sys.stderr)
        return 2
    git_sha = _sha256(git_path)

    r2_sha: str | None = None
    r2_path: Path | None = None
    if args.r2_file:
        r2_path = Path(args.r2_file)
        if not r2_path.is_file():
            print(f"config-divergence: r2 file not found: {r2_path}", file=sys.stderr)
            return 2
        r2_sha = _sha256(r2_path)

    stamp = (args.projected_sha256 or "").strip()
    # `aws --output text` prints the literal string "None" for absent metadata.
    projected = stamp if stamp and stamp != "None" else None

    verdict = classify(git_sha, r2_sha, projected)
    print(verdict)
    if verdict != DIVERGED:
        return 0

    assert r2_path is not None  # DIVERGED implies an R2 object exists
    print(
        "\nconfig-divergence: R2 carries a live-applied customer.yaml that a git\n"
        "projection would SILENTLY REVERT (ADR 0044 / #1840). The change that\n"
        "would be lost (R2 -> git, i.e. what disappears if you project):\n",
        file=sys.stderr,
    )
    diff = difflib.unified_diff(
        r2_path.read_text().splitlines(keepends=True),
        git_path.read_text().splitlines(keepends=True),
        fromfile="R2 (live, would be lost)",
        tofile="git (would be projected)",
    )
    sys.stderr.writelines(diff)
    print(
        "\nResolve deliberately:\n"
        "  SS_CONFIG_SOURCE=r2      reprovision FROM the live R2 config (ADR 0044 Decision 2);\n"
        "                           reconcile it into git afterwards (reconcile-r2-config.sh)\n"
        "  SS_CONFIG_FORCE_GIT=1    knowingly revert the live change to the git version\n",
        file=sys.stderr,
    )
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
