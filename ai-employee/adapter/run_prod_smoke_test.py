#!/usr/bin/env python3
"""Run read-only smoke tests against every enabled connector for a customer.

Operationalized in issue #852 against the framework in
`adapter/connector_smoke.py`. The Phase A stub enumerated what WOULD be
tested; this script now executes the registered probes and exits with a
status that the provisioning wrapper consumes:

* exit 0 -- PASS (every enabled connector responded with shape-valid data)
* exit 1 -- PARTIAL (at least one optional connector failed OR a shape
  conformance violation was recorded but the call returned)
* exit 2 -- FAIL (at least one required connector failed)

`provision-customer.sh` aborts on exit 2 and warns on exit 1. The
periodic cron wrapper logs both.

Probe registration
------------------

Probes are owned by vendor connector packages (e.g.
`connectors.filevine`). Each package defines a `register_smoke_probes`
hook that this CLI calls before running. The CLI does NOT introspect
arbitrary connectors to "find a safe method" -- probes are declared
explicitly per the framework's read-only allowlist.

When a new connector ships, the connector package author MUST add a
`register_smoke_probes(registry: SmokeProbeRegistry) -> None` function
and register it in `_REGISTERED_PACKAGES` below.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path

# Make the `ai-employee/` parent importable so `from adapter...` resolves
# when this script is invoked from the repo root via
# `uv run --with pyyaml python3 ai-employee/adapter/run_prod_smoke_test.py`.
_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[1]))

from adapter.connector_smoke import (  # noqa: E402
    SmokeProbeRegistry,
    run_smoke_tests,
)

log = logging.getLogger("aie.run_prod_smoke_test")


# ---------------------------------------------------------------------------
# Probe registration -- vendor packages opt in here
#
# Each entry is the dotted path to a callable that takes a
# `SmokeProbeRegistry` and registers its probes. The CLI imports each
# lazily so a missing optional dependency in one connector does not
# prevent others from running.
#
# Packages should expose `register_smoke_probes(registry)` as a public
# module-level function -- see `connectors/filevine/__init__.py` for the
# reference shape (added in a follow-on PR; this PR ships the framework
# only).
# ---------------------------------------------------------------------------

_REGISTERED_PACKAGES: tuple[str, ...] = (
    # "connectors.filevine:register_smoke_probes",
    # "connectors.gmail:register_smoke_probes",
)


def _load_registry() -> SmokeProbeRegistry:
    """Import every entry in `_REGISTERED_PACKAGES` and populate a registry.

    Import failures are logged and skipped -- a connector that fails to
    import in this context (typically due to a missing optional dep
    like httpx) will surface during the run as "no probe registered for
    <capability>" anyway, which is the right diagnostic.
    """
    registry = SmokeProbeRegistry()
    for spec in _REGISTERED_PACKAGES:
        if ":" not in spec:
            log.warning("Skipping malformed probe spec %r (want 'module:callable')", spec)
            continue
        module_name, fn_name = spec.split(":", 1)
        try:
            module = __import__(module_name, fromlist=[fn_name])
            fn = getattr(module, fn_name)
        except Exception as exc:  # noqa: BLE001
            log.warning("Failed to import %s: %s", spec, exc)
            continue
        try:
            fn(registry)
        except Exception as exc:  # noqa: BLE001
            log.warning("register_smoke_probes from %s raised %s", spec, exc)
    return registry


async def _amain(args: argparse.Namespace) -> int:
    registry = _load_registry()

    report = await run_smoke_tests(
        customer_yaml_path=args.customer_yaml,
        registry=registry,
        audit_writer=None,  # provisioning runs without audit; cron passes a writer
    )

    print(report.captain_summary())

    exit_code = report.exit_code()
    if exit_code == 0:
        print(
            f"\nConnector smoke: PASS ({len(report.results)} connector(s) checked). "
            "Safe to proceed."
        )
    elif exit_code == 1:
        print(
            "\nConnector smoke: PARTIAL. Review failures before enabling any "
            "skill with a write capability."
        )
    else:
        print(
            "\nConnector smoke: FAIL. At least one required connector did not pass. "
            "Provisioning should abort; do not enable write capabilities."
        )
    return exit_code


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    ap = argparse.ArgumentParser(
        description=(
            "Run read-only smoke probes against every enabled connector "
            "for a customer. Exits 0/1/2 for pass/partial/fail."
        )
    )
    ap.add_argument("--customer", required=True, help="Customer slug (matches customer_id)")
    ap.add_argument("--app", required=True, help="Fly app name (for diagnostic context)")
    ap.add_argument(
        "--customer-yaml",
        type=Path,
        required=True,
        help="Path to the customer's customer.yaml",
    )
    args = ap.parse_args()

    log.info("Connector smoke for customer=%s app=%s", args.customer, args.app)

    try:
        return asyncio.run(_amain(args))
    except FileNotFoundError as exc:
        print(f"FATAL: customer.yaml not found: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001
        print(f"FATAL: connector smoke run failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
