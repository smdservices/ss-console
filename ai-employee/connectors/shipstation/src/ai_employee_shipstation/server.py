"""ShipStation MCP server — exposes ShipStationClient methods as MCP tools.

Read tools are autonomous-eligible. Internal-write (tag/note) is autonomous.
Gated tools (create_label, void_label) require an APPROVAL_SENTINEL in input.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import date
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
import mcp.types as mcp_types

from .client import DEFAULT_BASE_URL, ShipStationClient


APPROVAL_SENTINEL = "I confirm the operator approved this action in the current turn"


def build_server(client: ShipStationClient) -> Server:
    server = Server("ai-employee-shipstation")

    @server.list_tools()
    async def list_tools() -> list[mcp_types.Tool]:
        return [
            mcp_types.Tool(
                name="shipstation_list_orders",
                description="List orders with filters. Read-only. Returns paginated orders.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "order_status": {"type": "string"},
                        "customer_email": {"type": "string"},
                        "date_from": {"type": "string", "format": "date"},
                        "date_to": {"type": "string", "format": "date"},
                        "store_id": {"type": "string"},
                        "page": {"type": "integer", "default": 1},
                        "page_size": {"type": "integer", "default": 100, "maximum": 500},
                    },
                },
            ),
            mcp_types.Tool(
                name="shipstation_get_order",
                description="Get a single order. Read-only.",
                inputSchema={
                    "type": "object",
                    "properties": {"order_id": {"type": "string"}},
                    "required": ["order_id"],
                },
            ),
            mcp_types.Tool(
                name="shipstation_list_shipments",
                description="List shipments with filters. Read-only.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "carrier_id": {"type": "string"},
                        "date_from": {"type": "string", "format": "date"},
                        "date_to": {"type": "string", "format": "date"},
                        "tracking_status": {"type": "string"},
                        "page": {"type": "integer", "default": 1},
                        "page_size": {"type": "integer", "default": 100},
                    },
                },
            ),
            mcp_types.Tool(
                name="shipstation_get_shipment",
                description="Get a single shipment. Read-only.",
                inputSchema={
                    "type": "object",
                    "properties": {"shipment_id": {"type": "string"}},
                    "required": ["shipment_id"],
                },
            ),
            mcp_types.Tool(
                name="shipstation_track",
                description="Current tracking status for a tracking number. Read-only.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "carrier_code": {"type": "string"},
                        "tracking_number": {"type": "string"},
                    },
                    "required": ["carrier_code", "tracking_number"],
                },
            ),
            mcp_types.Tool(
                name="shipstation_list_warehouses",
                description="List configured warehouses. Read-only.",
                inputSchema={"type": "object"},
            ),
            mcp_types.Tool(
                name="shipstation_list_carriers",
                description="List carriers + services available. Read-only.",
                inputSchema={"type": "object"},
            ),
            mcp_types.Tool(
                name="shipstation_get_rates",
                description="Get carrier rates for a hypothetical shipment. Read-only quote (no charge).",
                inputSchema={
                    "type": "object",
                    "properties": {"shipment_payload": {"type": "object"}},
                    "required": ["shipment_payload"],
                },
            ),
            mcp_types.Tool(
                name="shipstation_tag_order",
                description="Tag an order with an internal tag. Autonomous-eligible (internal_write).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "order_id": {"type": "string"},
                        "tag_id": {"type": "string"},
                    },
                    "required": ["order_id", "tag_id"],
                },
            ),
            mcp_types.Tool(
                name="shipstation_note_order",
                description="Add internal note to order. Autonomous-eligible (internal_write).",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "order_id": {"type": "string"},
                        "note": {"type": "string"},
                    },
                    "required": ["order_id", "note"],
                },
            ),
            mcp_types.Tool(
                name="shipstation_create_label",
                description=(
                    f"Create a shipping label. CHARGES carrier account. GATED — requires "
                    f"`acknowledgement` field set to '{APPROVAL_SENTINEL}'."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "shipment_payload": {"type": "object"},
                        "acknowledgement": {"type": "string", "const": APPROVAL_SENTINEL},
                    },
                    "required": ["shipment_payload", "acknowledgement"],
                },
            ),
            mcp_types.Tool(
                name="shipstation_void_label",
                description=(
                    f"Void a label. May or may not refund per carrier rules. GATED — requires "
                    f"`acknowledgement` field set to '{APPROVAL_SENTINEL}'."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "label_id": {"type": "string"},
                        "acknowledgement": {"type": "string", "const": APPROVAL_SENTINEL},
                    },
                    "required": ["label_id", "acknowledgement"],
                },
            ),
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> list[mcp_types.TextContent]:
        try:
            result = await _dispatch(client, name, arguments)
        except PermissionError as e:
            return [mcp_types.TextContent(type="text", text=f"REFUSED: {e}")]
        except Exception as e:  # noqa: BLE001
            return [mcp_types.TextContent(type="text", text=f"ERROR: {type(e).__name__}: {e}")]
        return [mcp_types.TextContent(type="text", text=json.dumps(result, default=str))]

    return server


async def _dispatch(client: ShipStationClient, name: str, args: dict[str, Any]) -> Any:
    def _date(s: str | None) -> date | None:
        return date.fromisoformat(s) if s else None

    if name == "shipstation_list_orders":
        return await client.list_orders(
            order_status=args.get("order_status"),
            customer_email=args.get("customer_email"),
            date_from=_date(args.get("date_from")),
            date_to=_date(args.get("date_to")),
            store_id=args.get("store_id"),
            page=args.get("page", 1),
            page_size=args.get("page_size", 100),
        )
    if name == "shipstation_get_order":
        return await client.get_order(args["order_id"])
    if name == "shipstation_list_shipments":
        return await client.list_shipments(
            carrier_id=args.get("carrier_id"),
            date_from=_date(args.get("date_from")),
            date_to=_date(args.get("date_to")),
            tracking_status=args.get("tracking_status"),
            page=args.get("page", 1),
            page_size=args.get("page_size", 100),
        )
    if name == "shipstation_get_shipment":
        return await client.get_shipment(args["shipment_id"])
    if name == "shipstation_track":
        return await client.track(carrier_code=args["carrier_code"], tracking_number=args["tracking_number"])
    if name == "shipstation_list_warehouses":
        return await client.list_warehouses()
    if name == "shipstation_list_carriers":
        return await client.list_carriers()
    if name == "shipstation_get_rates":
        return await client.get_rates(args["shipment_payload"])
    if name == "shipstation_tag_order":
        return await client.tag_order(args["order_id"], tag_id=args["tag_id"])
    if name == "shipstation_note_order":
        return await client.note_order(args["order_id"], note=args["note"])
    if name == "shipstation_create_label":
        approved = args.get("acknowledgement") == APPROVAL_SENTINEL
        return await client.create_label(
            shipment_payload=args["shipment_payload"], explicit_approval=approved
        )
    if name == "shipstation_void_label":
        approved = args.get("acknowledgement") == APPROVAL_SENTINEL
        return await client.void_label(args["label_id"], explicit_approval=approved)
    raise ValueError(f"unknown tool: {name}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--transport", default="stdio", choices=("stdio",),
        help="MCP transport",
    )
    ap.parse_args()

    api_key = os.environ.get("SHIPSTATION_API_KEY")
    if not api_key:
        print("FATAL: SHIPSTATION_API_KEY env var required", file=sys.stderr)
        sys.exit(2)
    base_url = os.environ.get("SHIPSTATION_BASE_URL", DEFAULT_BASE_URL)

    client = ShipStationClient(api_key=api_key, base_url=base_url)
    server = build_server(client)

    async def _run() -> None:
        async with stdio_server() as (read_stream, write_stream):
            await server.run(
                read_stream, write_stream, server.create_initialization_options()
            )

    asyncio.run(_run())


if __name__ == "__main__":
    main()
