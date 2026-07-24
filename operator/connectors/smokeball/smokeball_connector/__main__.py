"""Entrypoint: serve the Smokeball connector over stdio. Installed as the
``smokeball-mcp`` console-script; the overlay registry launches it by the absolute
venv path."""

from __future__ import annotations

import sys

from .server import _get_client, server


def _startup_scope_readout() -> None:
    """Mint once at process startup so the connector logs its granted token scopes
    at boot (via SmokeballClient._mint_token's one-time log), BEFORE serving. This
    is the only reliable readout of the live firm-delegated token's actual grant:
    the gateway spawns the connector at startup to list its tools, so main() runs
    deterministically at boot — independent of any agent turn (no enabled skill
    writes, and inbound-mail turns are flaky). Fully guarded: a mint failure (e.g.
    boot-before-token) is logged and never blocks serving."""
    try:
        _get_client().auth_status()
    except Exception as exc:  # noqa: BLE001 - never block serving on the readout
        print(f"[smokeball] startup scope readout skipped: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)


def main() -> None:
    _startup_scope_readout()
    server.run_stdio()


if __name__ == "__main__":
    main()
