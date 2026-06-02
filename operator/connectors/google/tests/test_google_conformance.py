"""Conformance checks for the Google connector CLIs (Gmail / Calendar / Drive).

Python mirror of the harness in `src/lib/operator/capabilities/conformance.ts`,
adapted to the CLI shape (these connectors are argparse CLIs the agent shells to
via `execute_code`, not class-based adapters like filevine). We assert the
contract invariants at the CLI surface:

* CAPABILITY_SET_HONEST       — describe_capabilities() declares a known
                                capability, non-empty adapter/version, and
                                disjoint supported/unsupported method sets.
* NO_AUTONOMOUS_EXTERNAL_SEND — none of the banned method names appear in the
                                declared methods OR in the CLI subcommands.

The banned-name lists are pinned from `BANNED_METHOD_NAMES` in conformance.ts.
Drift between the two languages is a P0 (per that file's header).

Plus two behavioral regression walls:
* Calendar create/update force `sendUpdates="none"` and never any other value
  (reviewer-as-sender: the adapter never notifies attendees).
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

# Pinned from BANNED_METHOD_NAMES in src/lib/operator/capabilities/conformance.ts.
BANNED_METHOD_NAMES = {
    "Email": ["send", "send_message", "send_draft", "send_email"],
    "Calendar": ["send_invitation", "send_invite", "send_event"],
    "DocumentStorage": ["share_document", "send_share_invitation"],
}

ADAPTERS = [crane_gmail, crane_calendar, crane_drive]


def _subcommands(mod) -> list[str]:
    names: list[str] = []
    for action in mod.build_parser()._subparsers._group_actions:
        names.extend(action.choices.keys())
    return names


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


def test_no_autonomous_external_send():
    """No banned method name appears in declared methods or subcommands."""
    for mod in ADAPTERS:
        caps = mod.describe_capabilities()
        banned = BANNED_METHOD_NAMES.get(caps["capability"], [])
        declared = set(caps["supported_methods"]) | set(caps["unsupported_methods"])
        present = [b for b in banned if b in declared]
        assert not present, f"{mod.__name__}: banned method(s) declared: {present}"

        subs_norm = {s.replace("-", "_") for s in _subcommands(mod)}
        present_subs = [b for b in banned if b in subs_norm]
        assert not present_subs, f"{mod.__name__}: banned subcommand(s): {present_subs}"


def test_no_send_or_share_subcommand_anywhere():
    """Defense in depth: no external-send/share verb on any Google connector."""
    for mod in ADAPTERS:
        subs = _subcommands(mod)
        suspicious = [s for s in subs if "send" in s or "share" in s]
        assert not suspicious, f"{mod.__name__}: suspicious subcommand(s): {suspicious}"


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


def test_calendar_never_notifies_attendees():
    """Calendar create/update force sendUpdates='none' and use no other value."""
    src = Path(crane_calendar.__file__).read_text()
    assert 'sendUpdates="none"' in src
    for forbidden in ('sendUpdates="all"', 'sendUpdates="externalOnly"'):
        assert forbidden not in src, f"crane_calendar must never set {forbidden}"


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
