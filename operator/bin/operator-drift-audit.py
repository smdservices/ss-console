#!/usr/bin/env python3
"""Operator drift audit — thin runner over the pure diff engine (lib/drift_audit.py).

Reads declared desired-state from the repo (env-consumption.yaml, each
customer.yaml, customer-yaml-blocks.yaml, the two OVERLAY_REF pins), fetches a
live ``operator.runtime.config/v1`` snapshot per customer through the ADR 0043
read seam, runs the pure diff, and writes ``audit.json`` + ``drift-report.md``.

This runner is READ-ONLY against live Machines and writes NO live state. It is
the diagnostic half (D-report) — it sees and reports drift. The acting half
(D-act: the scheduled Action, the scoped admin route, PR drafting) is layered on
top and is intentionally NOT here.

Fetch source:
  --source seam (default)  Derive the per-customer key HMAC(master, slug) from
                           OPERATOR_RUNTIME_READ_SECRET (run under `infisical
                           run` for a manual observation) and call the Machine's
                           /runtime/config directly. The master never leaves the
                           process; nothing is written.

Usage::

    cd operator && infisical run --env=prod --path=/ss -- \\
        python3 bin/operator-drift-audit.py --slug smd-staging --out-dir /tmp/drift

Exit code is 0 for an observation run; pass --fail-on-critical to exit non-zero
when any critical finding is present (the D-act first-detection gate).
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml

_BIN = Path(__file__).resolve().parent
sys.path.insert(0, str(_BIN / "lib"))

import drift_audit as da  # noqa: E402

_REPO = _BIN.parents[1]
_ENV_CONTRACT = _REPO / "operator" / "contracts" / "env-consumption.yaml"
_BLOCK_REGISTRY = _REPO / "operator" / "contracts" / "customer-yaml-blocks.yaml"
_CUSTOMERS_DIR = _REPO / "operator" / "customers"
_DOCKERFILE = _REPO / "operator" / "templates" / "Dockerfile"
_DOCKERFILE_TEST = _REPO / "tests" / "operator-dockerfile.test.ts"

_PIN_RE = re.compile(r'OVERLAY_REF=["\']?([0-9a-f]{40}|v\d+\.\d+\.\d+)["\']?')


def _load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def extract_pin(text: str) -> str | None:
    """First OVERLAY_REF pin (40-hex SHA or vX.Y.Z) in a file's text."""
    m = _PIN_RE.search(text)
    return m.group(1) if m else None


def discover_slugs() -> list[str]:
    if not _CUSTOMERS_DIR.is_dir():
        return []
    return sorted(
        d.name for d in _CUSTOMERS_DIR.iterdir() if d.is_dir() and (d / "customer.yaml").is_file()
    )


def fetch_snapshot_seam(slug: str, master: str, *, timeout: int = 30) -> dict:
    """Fetch one Machine's config snapshot via the seam. The bearer is the
    per-customer key HMAC-SHA256(master, slug); the master stays in-process."""
    app = f"hermes-{slug}"
    url = f"https://{app}.fly.dev/runtime/config"
    bearer = hmac.new(master.encode(), slug.encode(), hashlib.sha256).hexdigest()
    req = urllib.request.Request(  # noqa: S310 (https, fixed host scheme)
        url,
        headers={"Authorization": f"Bearer {bearer}", "X-Tenant-Slug": slug},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return json.load(resp)


def run_audit(slugs: list[str], *, master: str | None) -> tuple[list, dict[str, list], list[str]]:
    """Returns (findings, degraded_by_slug, errors)."""
    env_contract = _load_yaml(_ENV_CONTRACT)
    block_registry = _load_yaml(_BLOCK_REGISTRY)
    dockerfile_pin = extract_pin(_DOCKERFILE.read_text(encoding="utf-8"))
    test_pin = extract_pin(_DOCKERFILE_TEST.read_text(encoding="utf-8"))

    findings: list = list(da.audit_overlay_ref_repo(dockerfile_pin, test_pin))
    degraded_by_slug: dict[str, list] = {}
    errors: list[str] = []

    for slug in slugs:
        customer_yaml = _load_yaml(_CUSTOMERS_DIR / slug / "customer.yaml")
        if not master:
            errors.append(f"{slug}: OPERATOR_RUNTIME_READ_SECRET unset; cannot fetch snapshot")
            continue
        try:
            snapshot = fetch_snapshot_seam(slug, master)
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            errors.append(f"{slug}: snapshot fetch failed: {exc}")
            continue
        degraded_by_slug[slug] = snapshot.get("degraded") or []
        findings += da.audit_customer(
            slug=slug,
            snapshot=snapshot,
            env_contract=env_contract,
            customer_yaml=customer_yaml,
            block_registry=block_registry,
            dockerfile_pin=dockerfile_pin,
        )
    return findings, degraded_by_slug, errors


def main() -> int:
    ap = argparse.ArgumentParser(description="Operator drift audit (read-only).")
    ap.add_argument("--slug", action="append", help="customer slug (repeatable); default: all")
    ap.add_argument("--source", choices=["seam"], default="seam")
    ap.add_argument("--out-dir", default=None, help="write audit.json + drift-report.md here")
    ap.add_argument("--fail-on-critical", action="store_true")
    args = ap.parse_args()

    slugs = args.slug or discover_slugs()
    if not slugs:
        print("no customers to audit", file=sys.stderr)
        return 0

    master = os.environ.get("OPERATOR_RUNTIME_READ_SECRET")
    findings, degraded_by_slug, errors = run_audit(slugs, master=master)

    report = da.render_markdown(findings, degraded_by_slug=degraded_by_slug)
    audit_obj = {
        "schema": "operator.drift-audit/v1",
        "slugs": slugs,
        "summary": da.summarize(findings),
        "findings": [f.__dict__ for f in findings],
        "degraded": degraded_by_slug,
        "errors": errors,
    }

    if args.out_dir:
        out = Path(args.out_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / "audit.json").write_text(json.dumps(audit_obj, indent=2), encoding="utf-8")
        (out / "drift-report.md").write_text(report, encoding="utf-8")
        print(f"wrote {out / 'audit.json'} and {out / 'drift-report.md'}")
    else:
        print(report)

    for err in errors:
        print(f"WARN: {err}", file=sys.stderr)

    summary = da.summarize(findings)
    if args.fail_on_critical and summary["critical"] > 0:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
