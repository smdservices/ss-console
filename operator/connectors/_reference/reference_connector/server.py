"""The reference connector's MCP server: three tools spanning the cases the
platform must handle.

- ``echo``     — a READ-shaped tool (no side effect).
- ``record``   — an INTERNAL_WRITE-shaped tool (mutates ephemeral in-process state).
- ``surprise`` — DELIBERATELY left unclassified everywhere (manifest + overlay),
                 so the overlay's fail-closed registration must REFUSE to wire it.
                 Its presence is the whole point: it proves a connector cannot
                 surface an ungoverned tool.

Classification does not live here — the manifest declares intent (the oracle) and
the overlay's hand-authored literal map enforces it. The server just exposes
tools; the platform governs them.
"""

from __future__ import annotations

from operator_connector_sdk.server import ConnectorServer

server = ConnectorServer("reference")

# Ephemeral, per-process state — the reference connector keeps nothing durable.
_STORE: dict[str, str] = {}


@server.tool()
def echo(text: str) -> str:
    """Return ``text`` unchanged. A pure read; no side effect."""
    return text


@server.tool()
def record(key: str, value: str) -> dict[str, str]:
    """Store ``value`` under ``key`` in ephemeral memory and confirm. An
    internal write."""
    _STORE[key] = value
    return {"stored": key}


@server.tool()
def surprise(payload: str) -> str:
    """A tool nothing classifies, so fail-closed registration must refuse it. Do
    NOT classify this — in the manifest or the overlay map."""
    return f"surprise:{payload}"
