"""ShipStation V2 API client — thin httpx wrapper.

Authentication is API key in a header (no OAuth). Read methods are direct
API mappings; gated write methods (label creation/void) enforce the
trust-ceiling approval check at the boundary.

Refused operations (customer billing modification, bulk delete, carrier
credential changes) are NOT implemented as client methods, so the MCP
server cannot expose them.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

import httpx


DEFAULT_BASE_URL = "https://api.shipstation.com/v2"


class ShipStationClient:
    """Async client. One per customer per process."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("api_key is required")
        self.api_key = api_key
        self.base_url = base_url
        self._http = http or httpx.AsyncClient(
            base_url=base_url,
            timeout=30.0,
            headers={"API-Key": api_key, "Accept": "application/json"},
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        resp = await self._http.request(method, path, params=params, json=json)
        resp.raise_for_status()
        return resp.json()

    # ---------- READ METHODS ----------

    async def list_orders(
        self,
        *,
        order_status: str | None = None,
        customer_email: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        store_id: str | None = None,
        page: int = 1,
        page_size: int = 100,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "page_size": min(page_size, 500)}
        if order_status:
            params["order_status"] = order_status
        if customer_email:
            params["customer_email"] = customer_email
        if date_from:
            params["modify_date_start"] = date_from.isoformat()
        if date_to:
            params["modify_date_end"] = date_to.isoformat()
        if store_id:
            params["store_id"] = store_id
        return await self._request("GET", "/orders", params=params)

    async def get_order(self, order_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/orders/{order_id}")

    async def list_shipments(
        self,
        *,
        carrier_id: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        tracking_status: str | None = None,
        page: int = 1,
        page_size: int = 100,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"page": page, "page_size": min(page_size, 500)}
        if carrier_id:
            params["carrier_id"] = carrier_id
        if date_from:
            params["created_at_start"] = date_from.isoformat()
        if date_to:
            params["created_at_end"] = date_to.isoformat()
        if tracking_status:
            params["tracking_status"] = tracking_status
        return await self._request("GET", "/shipments", params=params)

    async def get_shipment(self, shipment_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/shipments/{shipment_id}")

    async def track(self, *, carrier_code: str, tracking_number: str) -> dict[str, Any]:
        return await self._request(
            "GET",
            "/tracking",
            params={"carrier_code": carrier_code, "tracking_number": tracking_number},
        )

    async def list_warehouses(self) -> dict[str, Any]:
        return await self._request("GET", "/warehouses")

    async def list_carriers(self) -> dict[str, Any]:
        return await self._request("GET", "/carriers")

    async def get_rates(self, shipment_payload: dict[str, Any]) -> dict[str, Any]:
        """Get carrier rates for a shipment. Read-only — quote only, no label created."""
        return await self._request("POST", "/rates", json=shipment_payload)

    # ---------- INTERNAL-WRITE METHODS (autonomous-eligible) ----------

    async def tag_order(self, order_id: str, *, tag_id: str) -> dict[str, Any]:
        """Add an internal tag to an order. No external blast radius."""
        return await self._request("POST", f"/orders/{order_id}/tags/{tag_id}", json={})

    async def note_order(self, order_id: str, *, note: str) -> dict[str, Any]:
        """Add an internal note to an order. Visible inside ShipStation only."""
        return await self._request("PATCH", f"/orders/{order_id}", json={"internal_notes": note})

    # ---------- GATED WRITE METHODS ----------

    async def create_label(
        self,
        *,
        shipment_payload: dict[str, Any],
        explicit_approval: bool,
    ) -> dict[str, Any]:
        """Create a shipping label. CHARGES the customer's carrier account.

        EXTERNAL_SEND / COMMITMENT action class. Requires explicit_approval=True.
        """
        if not explicit_approval:
            raise PermissionError(
                "shipstation_create_label requires explicit operator approval. "
                "The trust-ceiling enforcement layer must pass explicit_approval=True."
            )
        return await self._request("POST", "/labels", json=shipment_payload)

    async def void_label(
        self,
        label_id: str,
        *,
        explicit_approval: bool,
    ) -> dict[str, Any]:
        """Void a label. May or may not refund depending on carrier rules.

        DESTRUCTIVE action class. Requires explicit_approval=True.
        """
        if not explicit_approval:
            raise PermissionError(
                "shipstation_void_label requires explicit operator approval."
            )
        return await self._request("DELETE", f"/labels/{label_id}", json={})

    async def aclose(self) -> None:
        await self._http.aclose()
