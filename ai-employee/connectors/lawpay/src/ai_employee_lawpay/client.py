"""LawPay API client — thin httpx wrapper around developers.8am.com REST endpoints.

Read methods are direct API mappings; they're called by the MCP read tools.
Write methods enforce the wrapper's safety policy: draft-only creation, no
direct send / no direct payment-record without explicit approval flag.

Refused operations (refunds, trust-account modifications, bulk-delete) are
NOT implemented on this client — they don't exist as methods so MCP tools
cannot expose them.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import httpx

from .oauth import OAuthClient


class LawPayClient:
    """Async client. One instance per customer per running process."""

    def __init__(
        self,
        oauth: OAuthClient,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self.oauth = oauth
        self._http = http or httpx.AsyncClient(
            base_url=oauth.base_url + "/v1",
            timeout=30.0,
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Issue an authorized request; auto-refresh token if needed."""
        tokens = await self.oauth.get_valid_tokens()
        headers = {"Authorization": tokens.authorization_header(), "Accept": "application/json"}
        resp = await self._http.request(method, path, params=params, json=json, headers=headers)
        # If LawPay says 401, the token may have been revoked server-side;
        # try a refresh once before propagating.
        if resp.status_code == 401:
            tokens = await self.oauth.refresh(tokens)
            headers["Authorization"] = tokens.authorization_header()
            resp = await self._http.request(method, path, params=params, json=json, headers=headers)
        resp.raise_for_status()
        return resp.json()

    # ---------- READ METHODS ----------
    # All read methods are autonomous-eligible per the trust ceiling.

    async def list_invoices(
        self,
        *,
        client_id: str | None = None,
        status: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        page: int = 1,
        per_page: int = 50,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "per_page": min(per_page, 200)}
        if client_id:
            params["client_id"] = client_id
        if status:
            params["status"] = status
        if date_from:
            params["date_from"] = date_from.isoformat()
        if date_to:
            params["date_to"] = date_to.isoformat()
        return await self._request("GET", "/invoices", params=params)

    async def get_invoice(self, invoice_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/invoices/{invoice_id}")

    async def list_payments(
        self,
        *,
        client_id: str | None = None,
        status: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        page: int = 1,
        per_page: int = 50,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "per_page": min(per_page, 200)}
        if client_id:
            params["client_id"] = client_id
        if status:
            params["status"] = status
        if date_from:
            params["date_from"] = date_from.isoformat()
        if date_to:
            params["date_to"] = date_to.isoformat()
        return await self._request("GET", "/payments", params=params)

    async def get_payment(self, payment_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/payments/{payment_id}")

    async def list_clients(self, *, page: int = 1, per_page: int = 50) -> dict[str, Any]:
        return await self._request("GET", "/clients", params={"page": page, "per_page": per_page})

    async def get_client(self, client_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/clients/{client_id}")

    async def aging_report(self, *, as_of: date | None = None) -> dict[str, Any]:
        params = {"as_of": as_of.isoformat()} if as_of else None
        return await self._request("GET", "/reports/aging", params=params)

    async def trust_balance(self, client_id: str) -> dict[str, Any]:
        """READ-ONLY trust-account balance per client (IOLTA compliance — never modify here)."""
        return await self._request("GET", f"/clients/{client_id}/trust_balance")

    # ---------- GATED WRITE METHODS ----------
    # These exist on the client but the MCP tool boundary enforces the gate.

    async def create_invoice_draft(
        self,
        *,
        client_id: str,
        line_items: list[dict[str, Any]],
        memo: str | None = None,
    ) -> dict[str, Any]:
        """Create an invoice in DRAFT status. Never automatically sent.

        The MCP tool that exposes this is autonomous-eligible because draft
        creation is internal_write (no external blast radius).
        """
        body: dict[str, Any] = {
            "client_id": client_id,
            "line_items": line_items,
            "status": "draft",  # explicit; the API may have other valid statuses
        }
        if memo:
            body["memo"] = memo
        return await self._request("POST", "/invoices", json=body)

    async def send_invoice(
        self,
        invoice_id: str,
        *,
        explicit_approval: bool,
    ) -> dict[str, Any]:
        """Send an existing invoice to the client.

        EXTERNAL_SEND action class — requires explicit_approval=True at call site
        per the safety substrate. The MCP tool wrapping this method passes
        explicit_approval through from the trust-ceiling enforcement layer.
        """
        if not explicit_approval:
            raise PermissionError(
                "lawpay_send_invoice requires explicit operator approval in the current turn. "
                "The trust-ceiling enforcement layer must pass explicit_approval=True."
            )
        return await self._request(
            "POST",
            f"/invoices/{invoice_id}/send",
            json={"acknowledged_approval": True},
        )

    async def record_payment(
        self,
        *,
        invoice_id: str,
        amount: float,
        method: str,
        received_date: date,
        memo: str | None = None,
        explicit_approval: bool,
    ) -> dict[str, Any]:
        """Record a payment received outside LawPay (e.g., check, wire).

        COMMITMENT action class — touches firm financial state. Requires
        explicit_approval=True.
        """
        if not explicit_approval:
            raise PermissionError(
                "lawpay_record_payment requires explicit operator approval. "
                "The trust-ceiling enforcement layer must pass explicit_approval=True."
            )
        return await self._request(
            "POST",
            "/payments",
            json={
                "invoice_id": invoice_id,
                "amount": amount,
                "method": method,
                "received_date": received_date.isoformat(),
                "memo": memo or "",
            },
        )

    async def aclose(self) -> None:
        await self._http.aclose()
        await self.oauth.aclose()
