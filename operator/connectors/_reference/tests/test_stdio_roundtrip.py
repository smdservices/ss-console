"""End-to-end proof that the connector serves over real stdio MCP via the
console-script the registry launches — not the module form.

This is the rail the overlay's `command` (an absolute path to
/opt/connectors/reference/.venv/bin/reference-mcp) must satisfy: spawn the
script, speak the protocol, list tools, call one. If the console-script entry
point is wrong, this fails here instead of as a runtime MCP-spawn error on a
live Machine.
"""

from __future__ import annotations

import shutil

import anyio
import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Resolve the installed console-script the same way the gateway would (on PATH
# of the connector's venv). Skip cleanly if the package was imported but not
# installed as a script (e.g. a bare `pytest` against the source tree).
_SCRIPT = shutil.which("reference-mcp")


async def _roundtrip(command: str) -> None:
    params = StdioServerParameters(command=command)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            listed = await session.list_tools()
            names = {t.name for t in listed.tools}
            assert names == {"echo", "record", "surprise"}
            for t in listed.tools:
                assert t.inputSchema.get("type") == "object"

            result = await session.call_tool("echo", {"text": "ping"})
            assert result.content[0].text == "ping"


@pytest.mark.skipif(_SCRIPT is None, reason="reference-mcp console-script not on PATH")
def test_stdio_roundtrip_via_console_script() -> None:
    anyio.run(_roundtrip, _SCRIPT)
