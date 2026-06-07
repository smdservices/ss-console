#!/usr/bin/env python3
"""Enforce customer.yaml personas[].skills_disabled after Hermes bootstrap.

Hermes bundles a broad skill catalog into every profile. For customer Machines,
customer.yaml is the authority: a persona-level ``skills_disabled`` entry must
remove that skill from the generated profile before the gateway starts. This
guard closes the gap between the overlay materializer and Hermes' bundled skill
prompt cache.

Usage:
  ensure-disabled-skills.py [--check] CUSTOMER_YAML [HERMES_HOME]
  (HERMES_HOME defaults to $HERMES_HOME or /opt/data.)
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any

import yaml


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise SystemExit(f"FATAL: {path} is not a YAML mapping")
    return data


def disabled_by_profile(customer_yaml: Path) -> dict[str, set[str]]:
    data = _load_yaml(customer_yaml)
    personas = data.get("personas") or []
    if not isinstance(personas, list):
        return {}

    result: dict[str, set[str]] = {}
    for persona in personas:
        if not isinstance(persona, dict):
            continue
        slug = str(persona.get("slug") or "").strip()
        if not slug:
            continue
        raw_disabled = persona.get("skills_disabled") or []
        if not isinstance(raw_disabled, list):
            continue
        disabled = {str(v).strip() for v in raw_disabled if str(v).strip()}
        if disabled:
            result[slug] = disabled
    return result


def _skill_name_from_manifest_path(path: str) -> str:
    suffix = "/SKILL.md"
    if path.endswith(suffix):
        return Path(path[: -len(suffix)]).name
    return Path(path).stem


def _is_disabled_skill_entry(entry: Any, disabled: set[str]) -> bool:
    if not isinstance(entry, dict):
        return False
    for key in ("skill_name", "frontmatter_name", "name"):
        value = entry.get(key)
        if isinstance(value, str) and value.strip() in disabled:
            return True
    return False


def _load_snapshot(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise SystemExit(f"FATAL: {path} is not a JSON object")
    return data


def _prune_snapshot(path: Path, disabled: set[str], check: bool) -> int:
    if not path.exists():
        return 0
    data = _load_snapshot(path)
    removed = 0

    manifest = data.get("manifest")
    if isinstance(manifest, dict):
        remove_keys = [
            key for key in manifest if _skill_name_from_manifest_path(str(key)) in disabled
        ]
        removed += len(remove_keys)
        if not check:
            for key in remove_keys:
                manifest.pop(key, None)

    skills = data.get("skills")
    if isinstance(skills, list):
        keep = [entry for entry in skills if not _is_disabled_skill_entry(entry, disabled)]
        removed += len(skills) - len(keep)
        if not check:
            data["skills"] = keep

    if removed and not check:
        with path.open("w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
    return removed


def _prune_bundled_manifest(path: Path, disabled: set[str], check: bool) -> int:
    if not path.exists():
        return 0
    lines = path.read_text(encoding="utf-8").splitlines()
    keep: list[str] = []
    removed = 0
    for line in lines:
        name = line.split(":", 1)[0].strip()
        if name in disabled:
            removed += 1
        else:
            keep.append(line)
    if removed and not check:
        path.write_text("\n".join(keep) + ("\n" if keep else ""), encoding="utf-8")
    return removed


def _disabled_skill_dirs(skills_dir: Path, disabled: set[str]) -> list[Path]:
    if not skills_dir.is_dir():
        return []
    matches: list[Path] = []
    for skill_md in skills_dir.glob("**/SKILL.md"):
        if skill_md.parent.name in disabled:
            matches.append(skill_md.parent)
    return sorted(matches)


def enforce_profile(profile_dir: Path, disabled: set[str], check: bool) -> int:
    skills_dir = profile_dir / "skills"
    removed = 0
    dirs = _disabled_skill_dirs(skills_dir, disabled)
    removed += len(dirs)
    if not check:
        for path in dirs:
            shutil.rmtree(path)

    removed += _prune_bundled_manifest(skills_dir / ".bundled_manifest", disabled, check)
    removed += _prune_snapshot(profile_dir / ".skills_prompt_snapshot.json", disabled, check)
    return removed


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Remove customer-disabled bundled skills from Hermes profiles."
    )
    parser.add_argument("--check", action="store_true", help="verify only")
    parser.add_argument("customer_yaml", help="path to customer.yaml")
    parser.add_argument(
        "hermes_home",
        nargs="?",
        default=os.environ.get("HERMES_HOME", "/opt/data"),
        help="Hermes home dir (default: $HERMES_HOME or /opt/data)",
    )
    args = parser.parse_args(argv[1:])

    tag = "ensure-disabled-skills"
    home = Path(args.hermes_home)
    disabled_map = disabled_by_profile(Path(args.customer_yaml))
    if not disabled_map:
        print(f"[{tag}] no persona skills_disabled entries found")
        return 0

    failures = 0
    touched = 0
    for slug, disabled in sorted(disabled_map.items()):
        profile_dir = home / "profiles" / slug
        if not profile_dir.is_dir():
            print(f"[{tag}] profile not found for persona {slug}: {profile_dir}", file=sys.stderr)
            failures += 1
            continue
        removed = enforce_profile(profile_dir, disabled, args.check)
        touched += removed
        if args.check and removed:
            print(
                f"[{tag}] CHECK FAILED: {profile_dir} still exposes disabled skills: "
                f"{', '.join(sorted(disabled))}",
                file=sys.stderr,
            )
            failures += 1
        else:
            action = "would remove" if args.check else "removed"
            print(f"[{tag}] {slug}: {action} {removed} disabled skill artifact(s)")

    if failures:
        return 1
    print(f"[{tag}] done; {touched} artifact(s) {'found' if args.check else 'updated'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
