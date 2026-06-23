"""Runtime tool-name derivation — the single source of the ``mcp_<server>_<tool>``
form Hermes registers connector tools under.

This exists as its own module because getting it wrong is the platform's most
dangerous silent failure: the overlay's tool->ActionClass map is keyed by the
*runtime* name, and a connector that classifies bare tool names (``echo``)
instead of runtime names (``mcp_reference_echo``) passes its local tests while
its governance keys match nothing at runtime — tools then fall through to the
fail-closed default. The conformance oracle and the overlay's manifest<=map test
both derive the key here so the two sides cannot drift.
"""

from __future__ import annotations


def runtime_tool_name(server_name: str, tool_name: str) -> str:
    """The name Hermes registers a connector tool under at runtime.

    The MCP server key is dash->underscore folded and prefixed with ``mcp_``;
    the tool name is appended verbatim. e.g. ("clio-oktopeak", "list_matters")
    -> "mcp_clio_oktopeak_list_matters".
    """
    return f"mcp_{server_name.replace('-', '_')}_{tool_name}"
