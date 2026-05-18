#!/usr/bin/env python3
"""Resolve customer.yaml skill version pins against the skill library on disk.

Each skill in customer.yaml has a `version` field — a 6-char content hash of
its SKILL.md + references/ files. This script:

  1. Reads each enabled skill from customer.yaml
  2. Computes the actual content hash of its skill directory on disk
  3. Compares: if mismatch, exits 1 with detailed error
  4. Special case: `version: pending` is acceptable for skills authored in
     Phase C — the pin will be set after the skill is content-hashed.

Called from bootstrap.sh on container start. A pin mismatch is a deploy
error — the container was built with a different skill version than the
customer expects. Rollback or redeploy.
"""

import argparse
import hashlib
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("FATAL: pyyaml not installed", file=sys.stderr)
    sys.exit(2)


def skill_content_hash(skill_dir: Path) -> str:
    """Deterministic content hash for a skill directory.

    Sorts all files (recursively) by path, concatenates their bytes with the
    relative path as a delimiter, sha256s the result. First 6 chars used as
    the pin in customer.yaml. The full hash is the audit ID.
    """
    if not skill_dir.exists():
        return "missing"
    h = hashlib.sha256()
    for p in sorted(skill_dir.rglob("*")):
        if p.is_file():
            rel = p.relative_to(skill_dir).as_posix()
            h.update(rel.encode())
            h.update(b"\x00")
            h.update(p.read_bytes())
            h.update(b"\x00")
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("customer_yaml", type=Path)
    ap.add_argument("skills_dir", type=Path)
    args = ap.parse_args()

    with open(args.customer_yaml) as f:
        cfg = yaml.safe_load(f)

    errors: list[str] = []
    resolved: list[tuple[str, str, str]] = []  # (skill, pin, actual)

    for skill in cfg.get("skills", []) or []:
        if not skill.get("enabled"):
            continue
        name = skill["name"]
        pinned = str(skill.get("version", "pending"))

        # Look in both top-level skills/ and customer-specific skills/
        # (customer-zero / SMD has inbox-triage in customers/smd/skills/)
        skill_dir = args.skills_dir / name
        customer_skill_dir = args.customer_yaml.parent / "skills" / name
        actual_dir = skill_dir if skill_dir.exists() else customer_skill_dir

        if not actual_dir.exists():
            errors.append(f"{name}: skill directory not found (tried {skill_dir} and {customer_skill_dir})")
            continue

        actual_hash = skill_content_hash(actual_dir)
        actual_pin = actual_hash[:6]

        if pinned == "pending":
            # Phase C-pending skills: log the current pin so the operator can
            # update customer.yaml when ready. Does not block deploy.
            resolved.append((name, "pending", actual_pin))
            continue

        if pinned != actual_pin:
            errors.append(
                f"{name}: pinned version {pinned!r} != actual content hash {actual_pin!r}. "
                f"Either rollback the pin, or rebuild the container with the current skill code."
            )
        else:
            resolved.append((name, pinned, actual_pin))

    if errors:
        print("Skill pin resolution errors:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    for name, pinned, actual in resolved:
        print(f"  {name}: pinned={pinned} actual={actual}")
    print(f"OK: {len(resolved)} enabled skill(s) resolved")
    return 0


if __name__ == "__main__":
    sys.exit(main())
