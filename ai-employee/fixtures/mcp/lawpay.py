"""Stub for build:lawpay (NOT an MCP — Python adapter shape).

Per ADR 0020: LawPay does not have an official MCP server we trust;
the adapter is a Python wrapper around LawPay's REST API. The stub
lives alongside the MCP stubs for harness symmetry — same dispatcher
shape, same StubError contract — but it represents a BUILD adapter,
not an MCP server.

Documented tools (subset):

  - lawpay.invoices_list(status='open', client_id=None, max_results=10)
      -> {invoices: [...]}
  - lawpay.invoices_get(invoice_id) -> {invoice: {...}}
  - lawpay.payments_list(invoice_id=None, date_range=None) ->
      {payments: [...]}
  - lawpay.payments_get(payment_id) -> {payment: {...}}
  - lawpay.trust_accounts_get(account_id) -> {trust_account: {...}}

Trust-ceiling FORBIDDEN tools (stub refuses defensively; trust plugin
should catch earlier — LawPay write operations against trust accounts
are the highest-risk path in the entire connector matrix):

  - lawpay.charge_card
  - lawpay.refund_payment
  - lawpay.transfer_funds
  - lawpay.create_invoice
  - lawpay.write_trust_ledger

LawPay's trust-account writes are NEVER autonomous — they always
require partner confirmation. The trust plugin's content-class ceiling
on Payments capability enforces this; the stub provides a second
defensive layer.
"""

from __future__ import annotations

from typing import Any

from . import StubAuthError, StubError, StubNotFoundError


_HAPPY_INVOICE = {
    "id": "inv_synthetic_001",
    "invoice_number": "2026-PI-0142-INV-01",
    "status": "open",
    "client": {
        "id": "lp_client_001",
        "name": "Janet Holloway",
        "email": "janet.holloway@example.invalid",
    },
    "matter": {
        "id": "matter_synthetic_clio_01",
        "name": "Holloway v. Kerr — auto accident PI",
    },
    "amount_due": 12500.00,
    "amount_paid": 5000.00,
    "currency": "USD",
    "issue_date": "2026-05-15",
    "due_date": "2026-06-15",
}

_HAPPY_PAYMENT = {
    "id": "pmt_synthetic_001",
    "invoice_id": _HAPPY_INVOICE["id"],
    "amount": 5000.00,
    "currency": "USD",
    "method": "ach",
    "status": "succeeded",
    "received_at": "2026-05-17T14:22:00Z",
    "trust_account_id": "trust_acct_001",
}

_HAPPY_TRUST_ACCOUNT = {
    "id": "trust_acct_001",
    "name": "Holcomb Reyes IOLTA",
    "bank_name": "First Phoenix Bank",
    "account_number_last_4": "1234",
    "balance": 158420.75,
    "currency": "USD",
}


_WRITE_TOOLS: frozenset[str] = frozenset(
    {
        "lawpay.charge_card",
        "lawpay.refund_payment",
        "lawpay.transfer_funds",
        "lawpay.create_invoice",
        "lawpay.write_trust_ledger",
    }
)


def call_lawpay(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    if tool_name == "lawpay.invoices_list":
        status = args.get("status", "open")
        client_id = args.get("client_id")
        max_results = int(args.get("max_results", 10))
        invoices = [_HAPPY_INVOICE]
        if status != "open":
            invoices = []
        if client_id and client_id != _HAPPY_INVOICE["client"]["id"]:
            invoices = []
        return {
            "invoices": invoices[:max_results],
            "_stub_metadata": {"status": status, "client_id": client_id},
        }
    if tool_name == "lawpay.invoices_get":
        invoice_id = args.get("invoice_id")
        if not invoice_id:
            raise StubError("lawpay.invoices_get requires invoice_id")
        if invoice_id != _HAPPY_INVOICE["id"]:
            raise StubNotFoundError(f"invoice {invoice_id!r} not found")
        return {"invoice": _HAPPY_INVOICE}
    if tool_name == "lawpay.payments_list":
        invoice_id = args.get("invoice_id")
        payments = [_HAPPY_PAYMENT]
        if invoice_id and invoice_id != _HAPPY_PAYMENT["invoice_id"]:
            payments = []
        return {"payments": payments}
    if tool_name == "lawpay.payments_get":
        payment_id = args.get("payment_id")
        if not payment_id:
            raise StubError("lawpay.payments_get requires payment_id")
        if payment_id != _HAPPY_PAYMENT["id"]:
            raise StubNotFoundError(f"payment {payment_id!r} not found")
        return {"payment": _HAPPY_PAYMENT}
    if tool_name == "lawpay.trust_accounts_get":
        account_id = args.get("account_id")
        if not account_id:
            raise StubError("lawpay.trust_accounts_get requires account_id")
        if account_id != _HAPPY_TRUST_ACCOUNT["id"]:
            raise StubNotFoundError(f"trust account {account_id!r} not found")
        return {"trust_account": _HAPPY_TRUST_ACCOUNT}
    if tool_name in _WRITE_TOOLS:
        raise StubError(
            f"{tool_name} refused at stub layer — LawPay write operations "
            f"are NEVER autonomous; trust plugin must block these earlier"
        )
    raise StubError(f"unknown lawpay tool {tool_name!r}")


def force_auth_error(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    raise StubAuthError(
        f"401 Unauthorized: LawPay API token invalid (tool={tool_name!r})"
    )
