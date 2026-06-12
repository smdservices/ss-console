#!/usr/bin/env python3
"""Operator drift audit — the acting half (Phase B Cut D-act).

Reads an ``audit.json`` produced by operator-drift-audit.py, decides what to do
via the PURE ``drift_audit.plan_actions`` (critical → issue + gate on first
detection; non-critical → issue, or a mechanical PR for an OVERLAY_REF pin
mismatch, only after the SAME finding is confirmed on two consecutive runs), and
executes through ``gh``. Deterministic issue titles / branch names make every
action idempotent — a re-run never spams.

SAFETY:
  * --dry-run (DEFAULT) prints the plan and touches nothing. The scheduled
    Action passes --apply to go live.
  * The ONLY code it ever writes is a one-line OVERLAY_REF pin sync between two
    repo files. Everything touching live Machine state is an ISSUE, never a patch
    (the audit must never author a Fly secret or a reprovision).
  * Cross-run state (the two-run confirm) is a tiny seen-set JSON, restored from
    and saved to the Actions cache by the workflow.

Exit code: 2 if any critical finding was acted on (gate the run red), else 0.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

_BIN = Path(__file__).resolve().parent
sys.path.insert(0, str(_BIN / "lib"))

import drift_audit as da  # noqa: E402

_REPO = _BIN.parents[1]
_DOCKERFILE = _REPO / "operator" / "templates" / "Dockerfile"
_DOCKERFILE_TEST = _REPO / "tests" / "operator-dockerfile.test.ts"

_LABELS = "operator-drift,needs-captain"


def _run(cmd: list[str], *, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=check, capture_output=capture, text=True)


def issue_title(f: da.Finding) -> str:
    return f"[drift] {f.cls} · {f.slug}:{f.key}"


def branch_name(f: da.Finding) -> str:
    import hashlib

    h = hashlib.sha256(da.finding_key(f).encode()).hexdigest()[:8]
    # Sanitize the slug — a repo-level finding uses "*", which is not a legal
    # git ref char. The hash keeps the branch unique regardless.
    safe_slug = re.sub(r"[^A-Za-z0-9._-]", "_", f.slug) or "repo"
    return f"drift-audit/{f.cls}-{safe_slug}-{h}"


def _issue_exists(title: str) -> bool:
    out = _run(
        ["gh", "issue", "list", "--state", "open", "--search", title, "--json", "title"]
    ).stdout
    try:
        return any(i.get("title") == title for i in json.loads(out))
    except json.JSONDecodeError:
        return False


def _pr_exists(branch: str) -> bool:
    out = _run(["gh", "pr", "list", "--head", branch, "--state", "open", "--json", "number"]).stdout
    try:
        return len(json.loads(out)) > 0
    except json.JSONDecodeError:
        return False


def create_issue(f: da.Finding, reason: str, *, apply: bool) -> str:
    title = issue_title(f)
    body = (
        f"**Operator drift audit** flagged a finding that needs Captain attention.\n\n"
        f"- **class**: `{f.cls}`\n- **customer**: `{f.slug}`\n- **key**: `{f.key}`\n"
        f"- **severity**: {f.severity}\n- **corrective**: {f.corrective} "
        f"({'fix a repo artifact' if f.corrective == 'repo_patch' else 'a Fly secret or reprovision — NOT auto-applied'})\n"
        f"- **trigger**: {reason}\n\n> {f.detail}\n\n"
        f"_Filed by the scheduled operator drift audit. Deterministic title → no duplicates._"
    )
    if not apply:
        return f"DRY-RUN would open issue: {title}"
    if _issue_exists(title):
        return f"issue already open: {title}"
    _run(["gh", "issue", "create", "--title", title, "--label", _LABELS, "--body", body])
    return f"opened issue: {title}"


def _sync_pin_patch() -> str | None:
    """Make the test pin match the Dockerfile pin (the deployed truth). Returns the
    new pin on success, None if nothing to change / either pin unreadable."""
    pin_re = re.compile(r'OVERLAY_REF=["\']?([0-9a-f]{40}|v\d+\.\d+\.\d+)["\']?')
    dm = pin_re.search(_DOCKERFILE.read_text(encoding="utf-8"))
    if not dm:
        return None
    docker_pin = dm.group(1)
    test_text = _DOCKERFILE_TEST.read_text(encoding="utf-8")
    tm = pin_re.search(test_text)
    if not tm or tm.group(1) == docker_pin:
        return None
    new_text = test_text[: tm.start(1)] + docker_pin + test_text[tm.end(1) :]
    _DOCKERFILE_TEST.write_text(new_text, encoding="utf-8")
    return docker_pin


def create_pin_pr(f: da.Finding, *, apply: bool) -> str:
    branch = branch_name(f)
    if not apply:
        return f"DRY-RUN would draft PR on branch {branch} (sync test pin → Dockerfile pin)"
    if _pr_exists(branch):
        return f"PR already open on {branch}"
    new_pin = _sync_pin_patch()
    if new_pin is None:
        return "pin already in sync; no PR"
    _run(["git", "checkout", "-b", branch])
    _run(["git", "add", str(_DOCKERFILE_TEST)])
    _run(["git", "commit", "-m", f"fix(operator): sync OVERLAY_REF test pin to Dockerfile ({new_pin[:12]})"])
    _run(["git", "push", "-u", "origin", branch])
    body = (
        f"Automated one-line fix from the operator drift audit.\n\n"
        f"The Dockerfile and the dockerfile test disagreed on `OVERLAY_REF`; this "
        f"syncs the test pin to the Dockerfile's (the deployed truth: `{new_pin}`).\n\n"
        f"> {f.detail}\n\n_Draft — Captain reviews before merge._"
    )
    _run(["gh", "pr", "create", "--draft", "--title",
          "fix(operator): sync OVERLAY_REF test pin to Dockerfile", "--label", _LABELS, "--body", body])
    return f"drafted PR on {branch}"


def main() -> int:
    ap = argparse.ArgumentParser(description="Operator drift audit — act on findings.")
    ap.add_argument("--audit-json", required=True)
    ap.add_argument("--prev-seen", default=None, help="prior seen-set JSON (Actions cache)")
    ap.add_argument("--state-out", default=None, help="write next seen-set JSON here")
    ap.add_argument("--apply", action="store_true", help="actually create issues/PRs (default: dry-run)")
    args = ap.parse_args()

    audit = json.loads(Path(args.audit_json).read_text(encoding="utf-8"))
    findings = [
        da.Finding(f["slug"], f["cls"], f["severity"], f["key"], f["detail"], f["corrective"])
        for f in audit.get("findings", [])
    ]
    degraded_slugs = {s for s, items in (audit.get("degraded") or {}).items() if items}

    prev_seen: set[str] = set()
    if args.prev_seen and Path(args.prev_seen).is_file():
        try:
            prev_seen = set(json.loads(Path(args.prev_seen).read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            prev_seen = set()

    actions, next_seen, waiting = da.plan_actions(
        findings, prev_seen=prev_seen, degraded_slugs=degraded_slugs
    )

    gated = False
    for act in actions:
        if act.kind == "pr":
            print(create_pin_pr(act.finding, apply=args.apply))
        else:
            print(create_issue(act.finding, act.reason, apply=args.apply))
        gated = gated or act.gate
    for f in waiting:
        print(f"seen once (awaiting a confirming run): {da.finding_key(f)}")

    if args.state_out:
        Path(args.state_out).write_text(json.dumps(sorted(next_seen)), encoding="utf-8")

    if gated:
        print("CRITICAL drift acted on — gating the run red.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
