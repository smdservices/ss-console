"""LawPay API client — thin httpx wrapper around developers.8am.com REST endpoints.

Read methods are direct API mappings; they're called by the MCP read tools.
Write methods enforce the wrapper's safety policy: draft-only creation, no
direct send / no direct payment-record without explicit approval flag.

Refused operations (refunds, trust-account modifications, bulk-delete) are
NOT implemented on this client — they don't exist as methods so MCP tools
cannot expose them.
"""

from __future__ import annotations

import hashlib
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

import httpx

from .oauth import OAuthClient


# HTTP methods that are safe to transparently replay after a 401 token
# refresh. A write (POST/PUT/PATCH/DELETE) is only replayed when it
# carries an idempotency key so the processor dedupes the retry — see
# ``_request`` (issue #1125: a blind POST replay double-records payments).
_IDEMPOTENT_HTTP_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

_CENTS = Decimal("0.01")


def _normalize_money(amount: object) -> str:
    """Normalize a payment amount to a 2-decimal string for transmission.

    Money is never sent as a binary float: a float cannot represent most
    decimal cents exactly, which drifts balances on an IOLTA trust
    processor (issue #1125). Accept an int (whole dollars), a
    :class:`~decimal.Decimal`, or a string; validate to exactly two
    decimal places and a positive value; transmit as a fixed string.

    ``bool`` is rejected explicitly (it is an ``int`` subclass). A
    ``float`` is tolerated for the JSON-number call path but routed
    through its shortest string repr; callers needing exactness should
    pass a string or ``Decimal``.
    """
    if isinstance(amount, bool):
        raise ValueError("amount must be a number, not a boolean")
    if isinstance(amount, float):
        dec = Decimal(str(amount))
    elif isinstance(amount, (int, Decimal)):
        dec = Decimal(amount)
    elif isinstance(amount, str):
        try:
            dec = Decimal(amount.strip())
        except InvalidOperation as exc:
            raise ValueError(f"amount {amount!r} is not a valid decimal") from exc
    else:
        raise ValueError(
            f"amount must be int, str, or Decimal, got {type(amount).__name__}"
        )
    if not dec.is_finite():
        raise ValueError(f"amount {amount!r} must be a finite decimal")
    if dec <= 0:
        raise ValueError(f"amount {amount!r} must be positive")
    if dec != dec.quantize(_CENTS):
        raise ValueError(f"amount {amount!r} must have at most 2 decimal places")
    return f"{dec.quantize(_CENTS):.2f}"


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
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Issue an authorized request; auto-refresh token if needed.

        On a 401 the access token may have been revoked or expired
        server-side, so we refresh once and retry. The retry is only
        performed for idempotent methods (GET/HEAD/OPTIONS) or when an
        ``idempotency_key`` is supplied — replaying a non-idempotent
        write without a dedupe key risks double-applying it if the first
        POST was processed before the token expired (issue #1125).
        """
        tokens = await self.oauth.get_valid_tokens()
        headers = {"Authorization": tokens.authorization_header(), "Accept": "application/json"}
        if idempotency_key is not None:
            # Header name per the AffiniPay/LawPay convention. NOTE: confirm
            # the exact header + idempotency semantics against the LawPay
            # developer docs before this hits a production trust account
            # (issue #1125).
            headers["Idempotency-Key"] = idempotency_key
        resp = await self._http.request(method, path, params=params, json=json, headers=headers)
        if resp.status_code == 401:
            can_replay = method.upper() in _IDEMPOTENT_HTTP_METHODS or idempotency_key is not None
            tokens = await self.oauth.refresh(tokens)
            headers["Authorization"] = tokens.authorization_header()
            if not can_replay:
                # Surface the auth failure rather than blindly re-POSTing a
                # write whose first attempt may already have succeeded.
                raise httpx.HTTPStatusError(
                    "401 after token refresh; refusing to replay a "
                    f"non-idempotent {method} without an idempotency key",
                    request=resp.request,
                    response=resp,
                )
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
        amount: Decimal | int | str,
        method: str,
        received_date: date,
        memo: str | None = None,
        explicit_approval: bool,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        """Record a payment received outside LawPay (e.g., check, wire).

        COMMITMENT action class — touches firm financial state. Requires
        explicit_approval=True.

        ``amount`` is normalized to a 2-decimal string and transmitted as
        a string, never a binary float, to avoid cent drift on an
        IOLTA-regulated trust account (issue #1125). Every write carries
        an idempotency key — derived deterministically from the payment's
        identifying fields when the caller does not supply one — so a
        token-refresh retry (or any client-side replay) cannot
        double-record the payment.
        """
        if not explicit_approval:
            raise PermissionError(
                "lawpay_record_payment requires explicit operator approval. "
                "The trust-ceiling enforcement layer must pass explicit_approval=True."
            )
        amount_str = _normalize_money(amount)
        key = idempotency_key or hashlib.sha256(
            "|".join(
                [invoice_id, amount_str, received_date.isoformat(), method]
            ).encode("utf-8")
        ).hexdigest()
        return await self._request(
            "POST",
            "/payments",
            json={
                "invoice_id": invoice_id,
                "amount": amount_str,
                "method": method,
                "received_date": received_date.isoformat(),
                "memo": memo or "",
            },
            idempotency_key=key,
        )

    async def aclose(self) -> None:
        await self._http.aclose()
        await self.oauth.aclose()
