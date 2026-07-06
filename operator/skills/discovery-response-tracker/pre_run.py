#!/usr/bin/env python3
"""Shared cron pre-run gate — the empty-seat wake suppressor (ADR 0021 Stream B).

CANONICAL SOURCE: ``operator/templates/pre_run_gate.py``. The copies stamped
into skill directories as ``pre_run.py`` MUST be byte-identical to this file —
``operator/tests/test_pre_run_gate.py`` enforces the sync. Edit here, restamp.

What this gate decides
----------------------
Scheduled tracker/watch/chase skills re-derive their work from the matter set
in the practice-management system (they keep no local state — the matter is
the system of record). On a seat with ZERO open matters there is provably no
work for any of them, so waking the model is pure token burn. This gate:

  1. Probes Smokeball for open matters (one ``GET /matters?Status=Open&Limit=1``
     via the connector's own venv — the connector package is not importable
     from the Hermes venv this script runs in).
  2. Any open matter, any probe failure, any unknown response envelope, any
     heartbeat-write failure → ``{"wakeAgent": true}`` (fail-open; the agent
     wakes exactly as it would with no gate).
  3. Zero open matters → writes a SUPPRESSED_WAKE heartbeat row through the
     broker's uid-gated ``suppressed_wake_append`` verb, THEN emits
     ``{"wakeAgent": false}``. Suppress-without-heartbeat never happens
     (mirror-don't-gate): if the broker write fails, the agent wakes.

What this gate deliberately does NOT decide
-------------------------------------------
It is NOT a per-skill "is there work" check. A hydrated seat (any open
matter) always wakes — deeper UpdatedSince/state-delta gates are follow-on
work once the Smokeball ``updated_since`` wire format is verified at connect.
Lead-stage and inbound-driven work is unaffected either way: webhook and
inbound wakes are ungated by design.

Skill identity
--------------
The scheduler stages this file to ``<profile>/scripts/<skill>/pre_run.py`` and
runs it with cwd = that directory, so the skill name is the cwd basename. That
keeps every stamped copy byte-identical.

Verification hook
-----------------
``pre_run.py --assume-empty`` skips the Smokeball probe and behaves as if the
seat were empty — it exercises the heartbeat write + suppress path end-to-end
on a live Machine without needing an actually-empty tenant. The cron daemon
never passes arguments, so this path cannot trigger on a scheduled fire.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
from pathlib import Path

# Timeout budget: the Hermes scheduler kills the whole script at 120s
# (cron/scheduler.py _DEFAULT_SCRIPT_TIMEOUT); the probe gets well under that.
_PROBE_TIMEOUT_SECONDS = 45
_HEARTBEAT_TIMEOUT_SECONDS = 10

_CONNECTOR_PYTHON_DEFAULT = "/opt/connectors/smokeball/.venv/bin/python"

# Runs inside the connector venv, where smokeball_connector IS importable and
# build_client_from_env() owns auth (token mint + refresh-token self-heal).
# Envelope parsing is deliberately defensive: the live /matters list shape is
# connect-time-unverified, so an unrecognized shape reports null → wake.
_PROBE_SNIPPET = """\
import json
from smokeball_connector.client import build_client_from_env

r = build_client_from_env().get("/matters", Status="Open", Limit=1)
items = None
if isinstance(r, list):
    items = r
elif isinstance(r, dict):
    for key in ("items", "value", "results", "matters", "data"):
        v = r.get(key)
        if isinstance(v, list):
            items = v
            break
print(json.dumps({"openMatterCount": len(items) if items is not None else None}))
"""


def _emit(wake: bool) -> int:
    print(json.dumps({"wakeAgent": wake}))
    return 0


def _skill_name() -> str:
    return Path.cwd().name or "unknown-skill"


def probe_open_matter_count() -> int | None:
    """Return the open-matter count, or None when it cannot be determined."""
    connector_python = os.environ.get(
        "SMD_CONNECTOR_VENV_PYTHON", _CONNECTOR_PYTHON_DEFAULT
    )
    if not Path(connector_python).exists():
        sys.stderr.write(f"[pre_run] connector python missing: {connector_python}\n")
        return None
    try:
        result = subprocess.run(
            [connector_python, "-c", _PROBE_SNIPPET],
            capture_output=True,
            text=True,
            timeout=_PROBE_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        sys.stderr.write("[pre_run] smokeball probe timed out\n")
        return None
    except Exception as exc:  # noqa: BLE001 — any probe failure → unknown → wake
        sys.stderr.write(f"[pre_run] smokeball probe failed: {exc}\n")
        return None
    if result.returncode != 0:
        sys.stderr.write(
            f"[pre_run] smokeball probe exit {result.returncode}: "
            f"{(result.stderr or '').strip()[:500]}\n"
        )
        return None
    try:
        payload = json.loads((result.stdout or "").strip().splitlines()[-1])
        count = payload.get("openMatterCount")
    except Exception:  # noqa: BLE001 — malformed probe output → unknown → wake
        sys.stderr.write("[pre_run] smokeball probe output unparseable\n")
        return None
    if isinstance(count, bool) or not isinstance(count, int):
        return None
    return count


def write_suppressed_wake_heartbeat(skill_name: str) -> bool:
    """Append the SUPPRESSED_WAKE row via the broker. True only on ack."""
    socket_path = os.environ.get("SMD_AUDIT_BROKER_SOCKET") or os.environ.get(
        "SMD_WORKSPACE_BROKER_SOCKET"
    )
    if not socket_path:
        sys.stderr.write("[pre_run] no broker socket in env; cannot heartbeat\n")
        return False
    request = {
        "action": "suppressed_wake_append",
        "row": {
            "action_type": "SUPPRESSED_WAKE",
            "actor": "agent",
            "actor_role": "agent",
            "skill_name": skill_name,
            "metadata": json.dumps(
                {
                    "decision_basis": "empty_seat:no_open_matters",
                    "platform": "cron-pre-run",
                    "customer": os.environ.get("CUSTOMER_SLUG", ""),
                },
                sort_keys=True,
                separators=(",", ":"),
            ),
        },
    }
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(_HEARTBEAT_TIMEOUT_SECONDS)
            sock.connect(socket_path)
            sock.sendall(json.dumps(request).encode("utf-8") + b"\n")
            raw = b""
            while not raw.endswith(b"\n"):
                chunk = sock.recv(4096)
                if not chunk:
                    break
                raw += chunk
        response = json.loads(raw.decode("utf-8"))
        if response.get("ok") is True:
            return True
        sys.stderr.write(f"[pre_run] heartbeat rejected: {response}\n")
        return False
    except Exception as exc:  # noqa: BLE001 — any heartbeat failure → wake
        sys.stderr.write(f"[pre_run] heartbeat write failed: {exc}\n")
        return False


def decide_and_emit(count: int | None, skill_name: str) -> int:
    """Pure-ish core: count → wake/suppress emission (heartbeat before suppress)."""
    if count is None or count > 0:
        return _emit(wake=True)
    if not write_suppressed_wake_heartbeat(skill_name):
        # Mirror-don't-gate: a silent suppress with no audit trail is
        # indistinguishable from a broken pre_run. Wake instead — the full
        # agent run is observable and the failure becomes visible.
        return _emit(wake=True)
    return _emit(wake=False)


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    skill_name = _skill_name()
    if "--assume-empty" in argv:
        sys.stderr.write("[pre_run] --assume-empty: skipping smokeball probe\n")
        return decide_and_emit(0, skill_name)
    return decide_and_emit(probe_open_matter_count(), skill_name)


if __name__ == "__main__":
    sys.exit(main())
