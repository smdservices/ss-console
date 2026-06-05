"""Conformance checks for the Google connector CLIs (Gmail / Calendar / Drive).

Python mirror of the harness in `src/lib/operator/capabilities/conformance.ts`,
adapted to the CLI shape (these connectors are argparse CLIs the agent shells to
via `execute_code`, not class-based adapters like filevine). We assert the
contract invariants at the CLI surface:

* CAPABILITY_SET_HONEST       — describe_capabilities() declares a known
                                capability, non-empty adapter/version, and
                                disjoint supported/unsupported method sets.
* WORKSPACE_VERBS_EXPOSED      - customer-owned Workspace DWD includes send,
                                calendar updates, Drive sharing, Docs, Sheets.

Plus two behavioral regression walls:
* Calendar create/update default to `sendUpdates="none"` unless explicitly told
  to notify attendees.
* crane_gmail keeps its `gmail search` / `gmail get` subcommand shape, which the
  live `inbox-triage` skill shells to.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import crane_calendar  # type: ignore[import-not-found]
import crane_drive  # type: ignore[import-not-found]
import crane_gmail  # type: ignore[import-not-found]
from connectors.filevine.errors import CAPABILITY_NAMES  # type: ignore[import-not-found]

ADAPTERS = [crane_gmail, crane_calendar, crane_drive]


def _subcommands(mod) -> list[str]:
    names: list[str] = []
    for action in mod.build_parser()._subparsers._group_actions:
        names.extend(action.choices.keys())
    return names


def _gmail_ops() -> set[str]:
    ap = crane_gmail.build_parser()
    gmail_parser = next(
        action.choices["gmail"]
        for action in ap._subparsers._group_actions
        if "gmail" in action.choices
    )
    return {name for action in gmail_parser._subparsers._group_actions for name in action.choices}


def test_capability_set_honest():
    for mod in ADAPTERS:
        caps = mod.describe_capabilities()
        assert caps["capability"] in CAPABILITY_NAMES, f"{mod.__name__}: unknown capability"
        assert caps["adapter"], f"{mod.__name__}: empty adapter slug"
        assert caps["version"], f"{mod.__name__}: empty version"
        assert caps["supported_methods"], f"{mod.__name__}: no supported methods"
        sup = set(caps["supported_methods"])
        unsup = set(caps["unsupported_methods"])
        assert sup.isdisjoint(unsup), f"{mod.__name__}: supported/unsupported overlap"


def test_workspace_verbs_exposed_for_customer_owned_dwd():
    """DWD mode exposes normal Workspace employee operations."""
    assert {"send", "create-draft", "modify", "archive"} <= _gmail_ops()
    assert "send_message" in crane_gmail.describe_capabilities()["supported_methods"]

    drive_subs = set(_subcommands(crane_drive))
    assert {"share", "docs-create", "docs-get", "docs-append"} <= drive_subs
    assert {"sheets-create", "sheets-get-values", "sheets-update-values"} <= drive_subs


def test_capabilities_subcommand_runs_without_token():
    """The `capabilities` subcommand must work with no token (no google deps)."""
    for mod in ADAPTERS:
        path = Path(mod.__file__)
        out = subprocess.run(
            [sys.executable, str(path), "capabilities"],
            capture_output=True,
            text=True,
        )
        assert out.returncode == 0, f"{mod.__name__}: capabilities exited {out.returncode}: {out.stderr}"
        assert json.loads(out.stdout) == mod.describe_capabilities()


def test_calendar_notifications_default_to_none():
    """Calendar create/update default sendUpdates to none."""
    src = Path(crane_calendar.__file__).read_text()
    assert 'default="none"' in src
    assert 'choices=["none", "all", "externalOnly"]' in src


def test_gmail_subcommand_shape_preserved():
    """inbox-triage shells to `crane_gmail.py gmail search|get` — keep that shape."""
    ap = crane_gmail.build_parser()
    top = {name for action in ap._subparsers._group_actions for name in action.choices}
    assert "gmail" in top
    gmail_parser = next(
        action.choices["gmail"]
        for action in ap._subparsers._group_actions
        if "gmail" in action.choices
    )
    gmail_ops = {name for action in gmail_parser._subparsers._group_actions for name in action.choices}
    assert {"search", "get"} <= gmail_ops
