#!/usr/bin/env python3
"""Run a read-only smoke test against every enabled connector for a customer.

Surfaces auth / scope / shape issues on day-1 of a customer's deployment
BEFORE any skill executes a write operation. Per the plan's sandbox-vs-prod
handling: each wrapper's "prod-smoke-test" hits the customer's real tenant
with a read-only call.

Called from provision-customer.sh after `fly deploy` succeeds.

For Phase A, this is a stub that enumerates what WOULD be tested. The full
smoke-test logic per connector backend lands in Phase B when wrappers exist.
"""

import argparse
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("FATAL: pyyaml not installed", file=sys.stderr)
    sys.exit(2)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--customer", required=True)
    ap.add_argument("--app", required=True)
    ap.add_argument("--customer-yaml", type=Path, required=True)
    args = ap.parse_args()

    with open(args.customer_yaml) as f:
        cfg = yaml.safe_load(f)

    print(f"Prod smoke test plan for {args.customer} (app: {args.app}):")

    enabled = []
    skipped = []
    for key, conn in (cfg.get("connectors", {}) or {}).items():
        if (conn or {}).get("enabled"):
            enabled.append((key, conn.get("backend")))
        else:
            skipped.append((key, conn.get("backend")))

    print(f"\n  Enabled connectors to smoke-test: {len(enabled)}")
    for key, backend in enabled:
        # Phase A stub: enumerate, don't execute. Phase B wrappers register
        # their own smoke-test entrypoint that this script invokes.
        if backend.startswith("composio:"):
            toolkit = backend.split(":", 1)[1]
            print(f"    - {key} ({backend}): would call Composio /me on {toolkit} toolkit (read-only)")
        elif backend.startswith("mcp:"):
            url = backend.split(":", 1)[1]
            print(f"    - {key} ({backend}): would call MCP list-tools on {url}")
        elif backend.startswith("build:"):
            wrapper = backend.split(":", 1)[1]
            print(f"    - {key} ({backend}): would call {wrapper} health endpoint (Phase B implementation pending)")
        elif backend.startswith("synthetic:"):
            fixture = backend.split(":", 1)[1]
            print(f"    - {key} ({backend}): would verify fixture file readable at {fixture}")

    print(f"\n  Disabled connectors (not tested): {len(skipped)}")
    for key, backend in skipped:
        print(f"    - {key} ({backend})")

    print(
        "\nNOTE: Phase A stub — actual smoke-test calls are registered "
        "per-connector starting in Phase B. This run enumerates the plan only."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
