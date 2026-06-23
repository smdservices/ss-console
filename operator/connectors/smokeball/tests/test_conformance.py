"""Smokeball connector conformance — the platform standard, plus a live stdio
round-trip via the real console-script. No live Smokeball calls (those need creds
and are exercised at the connect step); the tool surface introspects credlessly
because the REST client is built lazily."""

from __future__ import annotations

import shutil
from pathlib import Path

import anyio
import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from operator_connector_sdk import conformance
from operator_connector_sdk.manifest import AuthModel, ConnectorManifest
from operator_connector_sdk.naming import runtime_tool_name
from smokeball_connector.server import server

MANIFEST_PATH = Path(__file__).resolve().parents[1] / "manifest.toml"

EXPECTED_TOOLS = {
    "auth_status",
    "list_matters",
    "get_matter",
    "list_matter_types",
    "get_stage_sets",
    "get_stage_to_matter_mappings",
    "get_contacts",
    "get_contact",
    "get_contact_relations",
    "list_tasks",
    "get_task",
    "search_staff",
    "get_staff",
    "get_roles_on_matter",
    "get_relationships_on_matter",
    "get_files_on_matter",
    "get_file",
    "get_download_url",
    "get_memos_on_matter",
    "get_bank_accounts",
    "get_matter_balances",
    "get_matter_billing_config",
    "get_fees",
    "get_expenses",
    "get_webhook_subscriptions",
    "get_event_types",
    "create_memo",
}

_SCRIPT = shutil.which("smokeball-mcp")


def _manifest() -> ConnectorManifest:
    return ConnectorManifest.from_toml(MANIFEST_PATH)


def test_manifest_loads_and_is_client_credentials() -> None:
    m = _manifest()
    assert m.name == "smokeball"
    assert m.capability == "PracticeManagement"
    assert m.auth_model is AuthModel.CLIENT_CREDENTIALS
    assert {s.runtime_env for s in m.required_secrets} == {
        "SMOKEBALL_CLIENT_ID",
        "SMOKEBALL_CLIENT_SECRET",
        "SMOKEBALL_API_KEY",
    }


def test_full_surface_matches() -> None:
    assert {t.name for t in server.tool_surface()} == EXPECTED_TOOLS


def test_conformance_every_tool_classified() -> None:
    # No expected_unclassified: every Smokeball tool the server exposes MUST be
    # declared, and every declaration MUST map to a live tool. Returns the
    # runtime-prefixed map the overlay's manifest<=map test consumes.
    runtime_map = conformance.run_all(server, _manifest())
    # Trust-account fund-movement tools are never exposed here.
    assert not any("transaction" in k or "protect" in k for k in runtime_map)
    # The one write is an internal write under its runtime name; reads are reads.
    assert runtime_map[runtime_tool_name("smokeball", "create_memo")] == "internal_write"
    assert runtime_map[runtime_tool_name("smokeball", "get_matter_balances")] == "read"
    assert runtime_map[runtime_tool_name("smokeball", "list_matters")] == "read"


def test_only_create_memo_is_a_write() -> None:
    m = _manifest()
    writes = {t for t, c in m.tool_classes.items() if c != "read"}
    assert writes == {"create_memo"}


@pytest.mark.skipif(_SCRIPT is None, reason="smokeball-mcp console-script not on PATH")
def test_stdio_serves_over_console_script() -> None:
    async def _roundtrip() -> None:
        async with stdio_client(StdioServerParameters(command=_SCRIPT)) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                listed = await session.list_tools()
                assert {t.name for t in listed.tools} == EXPECTED_TOOLS
                for t in listed.tools:
                    assert t.inputSchema.get("type") == "object"

    anyio.run(_roundtrip)
