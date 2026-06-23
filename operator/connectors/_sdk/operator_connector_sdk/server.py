"""ConnectorServer — the stdio MCP server base every author-built connector uses.

Thin wrapper over the MCP SDK's FastMCP. Two jobs:

1. Guarantee tools register with a well-formed, non-empty ``inputSchema`` placed
   where Hermes' MCP client reads it. (FastMCP derives the schema from the tool
   signature and type hints and emits it under the correct ``inputSchema`` key,
   so this avoids the historical bug where tools shipped with empty param
   schemas and the model could not call them.)
2. Expose the tool surface synchronously (``tool_surface``) so the conformance
   harness can enumerate exactly what the server offers.
"""

from __future__ import annotations

import anyio
from mcp.server.fastmcp import FastMCP
from mcp.types import Tool


class ConnectorServer:
    def __init__(self, name: str) -> None:
        self.name = name
        self._mcp = FastMCP(name)

    def tool(self, *args, **kwargs):
        """Register a tool. Delegates to FastMCP; the input schema is derived
        from the function signature and type hints."""
        return self._mcp.tool(*args, **kwargs)

    def tool_surface(self) -> list[Tool]:
        """The exact set of tools this server exposes, with their inputSchemas.
        Synchronous convenience over FastMCP's async ``list_tools`` — call from
        sync code (tests, conformance), not from inside a running event loop."""
        return anyio.run(self._mcp.list_tools)

    def run_stdio(self) -> None:
        """Serve over stdio — the transport Hermes launches the connector with."""
        self._mcp.run(transport="stdio")
