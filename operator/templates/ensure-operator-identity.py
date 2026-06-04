#!/usr/bin/env python3
"""Write customer-owned operator identity facts into each Hermes SOUL.md.

The overlay-generated SOUL.md carries persona name, title, vertical, and tone.
For a customer Machine that is not enough: the agent also needs the authored
customer-owned account it acts through, and which connector path is authoritative.

This guard appends an idempotent managed block derived from customer.yaml after
``hermes-smd bootstrap`` writes profiles.

Usage:
  ensure-operator-identity.py CUSTOMER_YAML [HERMES_HOME]
  (HERMES_HOME defaults to $HERMES_HOME or /opt/data.)
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

import yaml


START = "<!-- smd-operator-identity:start -->"
END = "<!-- smd-operator-identity:end -->"


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise SystemExit(f"FATAL: {path} is not a YAML mapping")
    return data


def _active_personas(data: dict[str, Any]) -> list[dict[str, Any]]:
    personas = data.get("personas") or []
    if not isinstance(personas, list):
        return []
    active = [p for p in personas if isinstance(p, dict) and p.get("status") == "active"]
    return active or [p for p in personas if isinstance(p, dict)]


def _connector_adapter(connectors: Any, capability: str) -> str | None:
    if not isinstance(connectors, dict):
        return None
    block = connectors.get(capability)
    if not isinstance(block, dict):
        return None
    adapter = block.get("adapter")
    return str(adapter).strip() if adapter else None


def _managed_block(data: dict[str, Any]) -> str:
    google_auth = data.get("google_auth") or {}
    subject = ""
    if isinstance(google_auth, dict) and google_auth.get("mode") == "dwd":
        subject = str(google_auth.get("subject") or "").strip()

    connectors = data.get("connectors") or {}
    email_adapter = _connector_adapter(connectors, "Email")
    calendar_adapter = _connector_adapter(connectors, "Calendar")
    drive_adapter = _connector_adapter(connectors, "DocumentStorage")

    lines = [
        START,
        "## Operator Identity",
        "",
    ]
    if subject:
        lines.append(f"- Your customer-owned Google Workspace email address is {subject}.")
        lines.append("- You can send and receive mail as that Workspace user within your action ceilings.")
    if email_adapter:
        lines.append(f"- Email is configured through the {email_adapter} BUILD connector.")
    if calendar_adapter:
        lines.append(f"- Calendar is configured through the {calendar_adapter} BUILD connector.")
    if drive_adapter:
        lines.append(
            f"- Drive, Docs, and Sheets are configured through the {drive_adapter} BUILD connector."
        )
    if subject or email_adapter or calendar_adapter or drive_adapter:
        lines.extend(
            [
                "- Use the Google connector CLIs under /app/connectors/google/ for live checks.",
                "- Do not infer mail is unconfigured from absent local mail clients, IMAP/SMTP config, or Himalaya.",
                "- AgentMail addresses are not your primary customer Workspace identity unless customer.yaml binds them as Email.",
            ]
        )
    lines.append(END)
    return "\n".join(lines) + "\n"


def _replace_managed_block(text: str, block: str) -> str:
    if START in text and END in text:
        before = text.split(START, 1)[0].rstrip()
        after = text.split(END, 1)[1].lstrip()
        return f"{before}\n\n{block}{after}".rstrip() + "\n"
    return text.rstrip() + "\n\n" + block


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description="Append customer-owned operator identity facts to SOUL.md."
    )
    parser.add_argument("customer_yaml", help="path to customer.yaml")
    parser.add_argument(
        "hermes_home",
        nargs="?",
        default=os.environ.get("HERMES_HOME", "/opt/data"),
        help="Hermes home dir (default: $HERMES_HOME or /opt/data)",
    )
    args = parser.parse_args(argv[1:])

    tag = "ensure-operator-identity"
    data = _load_yaml(Path(args.customer_yaml))
    block = _managed_block(data)
    home = Path(args.hermes_home)

    changed = 0
    for persona in _active_personas(data):
        slug = str(persona.get("slug") or "").strip()
        if not slug:
            continue
        soul_path = home / "profiles" / slug / "SOUL.md"
        if not soul_path.exists():
            print(f"[{tag}] SOUL.md not found for persona {slug}: {soul_path}", file=sys.stderr)
            continue
        current = soul_path.read_text(encoding="utf-8")
        updated = _replace_managed_block(current, block)
        if updated != current:
            soul_path.write_text(updated, encoding="utf-8")
            changed += 1
            print(f"[{tag}] updated {soul_path}")
        else:
            print(f"[{tag}] already current: {soul_path}")

    print(f"[{tag}] done; {changed} SOUL.md file(s) updated")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
