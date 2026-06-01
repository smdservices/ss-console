"""MCP server entrypoint — exposes LawPayClient methods as MCP tools.

Stdio transport by default; HTTP for testing. Run inside the customer's
Fly container; Hermes invokes via `mcp_servers.lawpay` in config.yaml.

Read tools are autonomous-eligible. Write tools require an explicit
approval field per the trust-ceiling policy.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
import mcp.types as mcp_types

from .client import LawPayClient
from .oauth import OAuthClient, TokenStore


# Sentinel string the trust-ceiling layer passes to acknowledge an
# operator-approved action. Crude gate for the MVP; Phase A.5 adapter
# will pass this through structured channels.
APPROVAL_SENTINEL = "I confirm the operator approved this action in the current turn"


def build_server(client: LawPayClient) -> Server:
    server = Server("operator-lawpay")

    # ---------- list_tools ----------

    @server.list_tools()
    async def list_tools() -> list[mcp_types.Tool]:
        return [
            mcp_types.Tool(
                name="lawpay_list_invoices",
                description=(
                    "List LawPay invoices with optional filters. Read-only; "
                    "autonomous-eligible. Returns paginated invoice records."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "client_id": {"type": "string"},
                        "status": {"type": "string", "enum": ["draft", "sent", "paid", "overdue", "void"]},
                        "date_from": {"type": "string", "format": "date"},
                        "date_to": {"type": "string", "format": "date"},
                        "page": {"type": "integer", "minimum": 1, "default": 1},
                        "per_page": {"type": "integer", "minimum": 1, "maximum": 200, "default": 50},
                    },
                },
            ),
            mcp_types.Tool(
                name="lawpay_get_invoice",
                description="Get a single invoice by ID. Read-only.",
                inputSchema={
                    "type": "object",
                    "properties": {"invoice_id": {"type": "string"}},
                    "required": ["invoice_id"],
                },
            ),
            mcp_types.Tool(
                name="lawpay_list_payments",
                description="List LawPay payments with optional filters. Read-only.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "client_id": {"type": "string"},
                        "status": {"type": "string"},
                        "date_from": {"type": "string", "format": "date"},
                        "date_to": {"type": "string", "format": "date"},
                        "page": {"type": "integer", "default": 1},
                        "per_page": {"type": "integer", "default": 50},
                    },
                },
            ),
            mcp_types.Tool(
                name="lawpay_get_payment",
                description="Get a single payment by ID. Read-only.",
                inputSchema={
                    "type": "object",
                    "properties": {"payment_id": {"type": "string"}},
                    "required": ["payment_id"],
                },
            ),
            mcp_types.Tool(
                name="lawpay_list_clients",
                description="List clients in the firm. Read-only.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "page": {"type": "integer", "default": 1},
                        "per_page": {"type": "integer", "default": 50},
                    },
                },
            ),
            mcp_types.Tool(
                name="lawpay_get_client",
                description="Get a single client by ID. Read-only.",
                inputSchema={
                    "type": "object",
                    "properties": {"client_id": {"type": "string"}},
                    "required": ["client_id"],
                },
            ),
            mcp_types.Tool(
                name="lawpay_aging_report",
                description="AR aging report. Buckets: current / 1-30 / 31-60 / 61-90 / 90+ days. Read-only.",
                inputSchema={
                    "type": "object",
                    "properties": {"as_of": {"type": "string", "format": "date"}},
                },
            ),
            mcp_types.Tool(
                name="lawpay_trust_balance",
                description=(
                    "Trust-account (IOLTA) balance for a specific client. READ-ONLY — never modifies. "
                    "Per state-bar rules, automated trust-account modification is not supported."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {"client_id": {"type": "string"}},
                    "required": ["client_id"],
                },
            ),
            # ---------- GATED WRITE TOOLS ----------
            mcp_types.Tool(
                name="lawpay_create_invoice_draft",
                description=(
                    "Create a draft invoice. Stays in DRAFT status — never sent automatically. "
                    "Autonomous-eligible (internal_write action class)."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "client_id": {"type": "string"},
                        "line_items": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "description": {"type": "string"},
                                    "quantity": {"type": "number"},
                                    "unit_price": {"type": "number"},
                                },
                                "required": ["description", "quantity", "unit_price"],
                            },
                        },
                        "memo": {"type": "string"},
                    },
                    "required": ["client_id", "line_items"],
                },
            ),
            mcp_types.Tool(
                name="lawpay_send_invoice",
                description=(
                    f"Send an existing draft invoice to the client. GATED — requires "
                    f"`acknowledgement` field set to the exact string: '{APPROVAL_SENTINEL}'. "
                    f"External_send action class — refuses without explicit current-turn approval."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "invoice_id": {"type": "string"},
                        "acknowledgement": {"type": "string", "const": APPROVAL_SENTINEL},
                    },
                    "required": ["invoice_id", "acknowledgement"],
                },
            ),
            mcp_types.Tool(
                name="lawpay_record_payment",
                description=(
                    f"Record a payment received outside LawPay (check, wire, etc.). GATED — "
                    f"requires `acknowledgement` field set to '{APPROVAL_SENTINEL}'. "
                    f"Commitment action class — touches financial state."
                ),
                inputSchema={
                    "type": "object",
                    "properties": {
                        "invoice_id": {"type": "string"},
                        "amount": {
                            "type": ["number", "string"],
                            "description": (
                                "Payment amount with at most 2 decimal places. "
                                "Pass a string (e.g. \"1500.00\") for exact "
                                "decimal handling on trust accounts."
                            ),
                        },
                        "method": {"type": "string", "enum": ["check", "wire", "ach", "cash", "other"]},
                        "received_date": {"type": "string", "format": "date"},
                        "memo": {"type": "string"},
                        "acknowledgement": {"type": "string", "const": APPROVAL_SENTINEL},
                    },
                    "required": ["invoice_id", "amount", "method", "received_date", "acknowledgement"],
                },
            ),
        ]

    # ---------- call_tool ----------

    @server.call_tool()
    async def call_tool(name: str, arguments: dict[str, Any]) -> list[mcp_types.TextContent]:
        try:
            result = await _dispatch(client, name, arguments)
        except PermissionError as e:
            return [mcp_types.TextContent(type="text", text=f"REFUSED: {e}")]
        except FileNotFoundError as e:
            return [mcp_types.TextContent(type="text", text=f"SETUP_REQUIRED: {e}")]
        except Exception as e:  # noqa: BLE001
            return [mcp_types.TextContent(type="text", text=f"ERROR: {type(e).__name__}: {e}")]
        return [mcp_types.TextContent(type="text", text=json.dumps(result, default=str))]

    return server


async def _dispatch(client: LawPayClient, name: str, args: dict[str, Any]) -> Any:
    def _date(s: str | None) -> date | None:
        return date.fromisoformat(s) if s else None

    if name == "lawpay_list_invoices":
        return await client.list_invoices(
            client_id=args.get("client_id"),
            status=args.get("status"),
            date_from=_date(args.get("date_from")),
            date_to=_date(args.get("date_to")),
            page=args.get("page", 1),
            per_page=args.get("per_page", 50),
        )
    if name == "lawpay_get_invoice":
        return await client.get_invoice(args["invoice_id"])
    if name == "lawpay_list_payments":
        return await client.list_payments(
            client_id=args.get("client_id"),
            status=args.get("status"),
            date_from=_date(args.get("date_from")),
            date_to=_date(args.get("date_to")),
            page=args.get("page", 1),
            per_page=args.get("per_page", 50),
        )
    if name == "lawpay_get_payment":
        return await client.get_payment(args["payment_id"])
    if name == "lawpay_list_clients":
        return await client.list_clients(page=args.get("page", 1), per_page=args.get("per_page", 50))
    if name == "lawpay_get_client":
        return await client.get_client(args["client_id"])
    if name == "lawpay_aging_report":
        return await client.aging_report(as_of=_date(args.get("as_of")))
    if name == "lawpay_trust_balance":
        return await client.trust_balance(args["client_id"])
    if name == "lawpay_create_invoice_draft":
        return await client.create_invoice_draft(
            client_id=args["client_id"],
            line_items=args["line_items"],
            memo=args.get("memo"),
        )
    if name == "lawpay_send_invoice":
        approved = args.get("acknowledgement") == APPROVAL_SENTINEL
        return await client.send_invoice(args["invoice_id"], explicit_approval=approved)
    if name == "lawpay_record_payment":
        approved = args.get("acknowledgement") == APPROVAL_SENTINEL
        return await client.record_payment(
            invoice_id=args["invoice_id"],
            amount=args["amount"],
            method=args["method"],
            received_date=date.fromisoformat(args["received_date"]),
            memo=args.get("memo"),
            explicit_approval=approved,
        )
    raise ValueError(f"unknown tool: {name}")


# ---------- main ----------

def _build_client_from_env(customer_id: str, token_store_path: Path) -> LawPayClient:
    required = ("LAWPAY_CLIENT_ID", "LAWPAY_CLIENT_SECRET", "LAWPAY_REDIRECT_URI")
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"missing required env vars: {', '.join(missing)}")
    oauth = OAuthClient(
        client_id=os.environ["LAWPAY_CLIENT_ID"],
        client_secret=os.environ["LAWPAY_CLIENT_SECRET"],
        redirect_uri=os.environ["LAWPAY_REDIRECT_URI"],
        env=os.environ.get("LAWPAY_ENV", "prod"),
        token_store=TokenStore(token_store_path, customer_id),
    )
    return LawPayClient(oauth)


def main() -> None:
    ap = argparse.ArgumentParser(description="LawPay MCP server")
    ap.add_argument("--customer-id", required=True, help="customer slug — for per-customer token storage")
    ap.add_argument(
        "--token-store-path",
        default="/opt/data/lawpay",
        help="base path for per-customer OAuth token storage",
    )
    ap.add_argument(
        "--transport",
        default="stdio",
        choices=("stdio",),
        help="MCP transport (stdio is the only supported transport for production use)",
    )
    args = ap.parse_args()

    client = _build_client_from_env(args.customer_id, Path(args.token_store_path))
    server = build_server(client)

    async def _run() -> None:
        async with stdio_server() as (read_stream, write_stream):
            await server.run(
                read_stream,
                write_stream,
                server.create_initialization_options(),
            )

    asyncio.run(_run())


if __name__ == "__main__":
    main()
