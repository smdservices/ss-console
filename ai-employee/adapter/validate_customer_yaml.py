#!/usr/bin/env python3
"""Validate a customer.yaml against the documented schema.

Exits 0 on success, 1 on validation errors with all errors printed to stderr.
Called from `bin/provision-customer.sh` before any Fly action runs.

Schema source of truth: `ai-employee/customer.yaml.schema.md`.
"""

import argparse
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("FATAL: pyyaml not installed. `pip install pyyaml`", file=sys.stderr)
    sys.exit(2)

ACCEPTED_VERTICALS = {
    "marketing-agency",
    "law-firm",
    "real-estate",
    "manufacturing",
    "insurance",
    "mixed",
}

ACCEPTED_CEILINGS = {"autonomous", "draft_for_review", "refused"}

ACCEPTED_BACKEND_PREFIXES = ("composio:", "mcp:", "build:", "synthetic:")


def err(msg: str, errors: list[str]) -> None:
    errors.append(msg)


def validate(
    customer_yaml: Path,
    skills_dir: Path,
    connectors_dir: Path,
    fixtures_dir: Path,
) -> list[str]:
    errors: list[str] = []

    if not customer_yaml.exists():
        err(f"customer.yaml not found at {customer_yaml}", errors)
        return errors

    with open(customer_yaml) as f:
        try:
            cfg = yaml.safe_load(f)
        except yaml.YAMLError as e:
            err(f"customer.yaml not valid YAML: {e}", errors)
            return errors

    # Required top-level fields
    for field in ("customer_id", "customer_name", "vertical", "model", "fly_region", "hermes_ref"):
        if field not in cfg:
            err(f"missing required top-level field: {field}", errors)

    # Vertical valid
    if cfg.get("vertical") not in ACCEPTED_VERTICALS:
        err(f"vertical must be one of {sorted(ACCEPTED_VERTICALS)}; got {cfg.get('vertical')!r}", errors)

    # Skills
    for i, skill in enumerate(cfg.get("skills", []) or []):
        prefix = f"skills[{i}]({skill.get('name', '?')})"
        for f in ("name", "version", "trust_ceiling", "enabled"):
            if f not in skill:
                err(f"{prefix}: missing field {f}", errors)
        if skill.get("trust_ceiling") not in ACCEPTED_CEILINGS:
            err(f"{prefix}: trust_ceiling must be one of {sorted(ACCEPTED_CEILINGS)}", errors)
        # Skill dir must exist (unless skill is disabled)
        if skill.get("enabled"):
            skill_dir = skills_dir / skill.get("name", "")
            inbox_zero_dir = (
                customer_yaml.parent / "skills" / skill.get("name", "")
            )  # customer-specific overrides (e.g. SMD's seed inbox-triage)
            if not skill_dir.exists() and not inbox_zero_dir.exists():
                err(
                    f"{prefix}: enabled=true but skill dir not found at {skill_dir} or {inbox_zero_dir}",
                    errors,
                )

    # Connectors
    for key, conn in (cfg.get("connectors", {}) or {}).items():
        prefix = f"connectors.{key}"
        backend = (conn or {}).get("backend")
        if not backend:
            err(f"{prefix}: missing backend", errors)
            continue
        if not backend.startswith(ACCEPTED_BACKEND_PREFIXES):
            err(
                f"{prefix}: backend {backend!r} must start with one of {ACCEPTED_BACKEND_PREFIXES}",
                errors,
            )
            continue
        # Validate the referenced resource exists
        if backend.startswith("build:"):
            wrapper_name = backend.split(":", 1)[1]
            wrapper_dir = connectors_dir / wrapper_name
            if not wrapper_dir.exists():
                # Tier-1 wrappers may not be built yet — warn, don't error,
                # unless this connector is enabled.
                if conn.get("enabled"):
                    err(
                        f"{prefix}: enabled=true but wrapper {wrapper_name} not at {wrapper_dir}",
                        errors,
                    )
        elif backend.startswith("synthetic:"):
            fixture_path = backend.split(":", 1)[1]
            full = (fixtures_dir.parent / fixture_path) if not Path(fixture_path).is_absolute() else Path(fixture_path)
            if not full.exists():
                # Fixtures may not be generated yet — warn unless enabled
                if conn.get("enabled"):
                    err(
                        f"{prefix}: enabled=true but synthetic fixture {fixture_path} not found",
                        errors,
                    )

    # Memory section (required for cost telemetry rollup)
    mem = cfg.get("memory", {}) or {}
    for f in ("d1_namespace", "r2_vault_path", "vectorize_index"):
        if f not in mem:
            err(f"memory.{f}: missing", errors)

    # Pause section
    pause = cfg.get("pause", {}) or {}
    if "active" not in pause:
        err("pause.active: missing (default false)", errors)

    return errors


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("customer_yaml", type=Path)
    ap.add_argument("--skills-dir", type=Path, required=True)
    ap.add_argument("--connectors-dir", type=Path, required=True)
    ap.add_argument("--fixtures-dir", type=Path, required=True)
    args = ap.parse_args()

    errors = validate(
        args.customer_yaml, args.skills_dir, args.connectors_dir, args.fixtures_dir
    )
    if errors:
        print("Validation errors:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print(f"OK: {args.customer_yaml}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
