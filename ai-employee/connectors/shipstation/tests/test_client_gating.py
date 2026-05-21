"""Tests for the ShipStation client's read methods and gated-write refusal.

Read methods exercise the httpx mock transport. Gated methods verify the
PermissionError raises when explicit_approval=False.
"""

from __future__ import annotations

import httpx
import pytest

from ai_employee_shipstation.client import ShipStationClient


def _client(handler) -> ShipStationClient:
    transport = httpx.MockTransport(handler)
    http = httpx.AsyncClient(
        transport=transport,
        base_url="https://api.shipstation.com/v2",
        headers={"API-Key": "test"},
    )
    return ShipStationClient(api_key="test", http=http)


def test_client_requires_api_key():
    with pytest.raises(ValueError, match="api_key is required"):
        ShipStationClient(api_key="")


@pytest.mark.asyncio
async def test_list_orders_passes_filters():
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["api_key"] = request.headers.get("api-key", "")
        return httpx.Response(200, json={"orders": [], "page": 1, "page_size": 100})

    client = _client(handler)
    await client.list_orders(order_status="awaiting_shipment", page_size=50)
    assert "order_status=awaiting_shipment" in captured["url"]
    assert "page_size=50" in captured["url"]
    assert captured["api_key"] == "test"
    await client.aclose()


@pytest.mark.asyncio
async def test_create_label_refuses_without_approval():
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("create_label should not hit the API without approval")

    client = _client(handler)
    with pytest.raises(PermissionError, match="explicit operator approval"):
        await client.create_label(
            shipment_payload={"to": {}, "from": {}}, explicit_approval=False
        )
    await client.aclose()


@pytest.mark.asyncio
async def test_create_label_proceeds_with_approval():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v2/labels"
        return httpx.Response(200, json={"label_id": "L123"})

    client = _client(handler)
    result = await client.create_label(
        shipment_payload={"to": {}, "from": {}}, explicit_approval=True
    )
    assert result == {"label_id": "L123"}
    await client.aclose()


@pytest.mark.asyncio
async def test_void_label_refuses_without_approval():
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("void_label should not hit the API without approval")

    client = _client(handler)
    with pytest.raises(PermissionError, match="explicit operator approval"):
        await client.void_label("L123", explicit_approval=False)
    await client.aclose()


@pytest.mark.asyncio
async def test_get_rates_is_read_only():
    """`get_rates` is a POST in REST terms but a read in semantic terms — no charge."""
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/v2/rates"
        return httpx.Response(200, json={"rates": []})

    client = _client(handler)
    result = await client.get_rates({"to": {}, "from": {}})
    assert "rates" in result
    await client.aclose()


@pytest.mark.asyncio
async def test_track_passes_required_params():
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"status": "in_transit"})

    client = _client(handler)
    await client.track(carrier_code="ups", tracking_number="1Z123")
    assert "carrier_code=ups" in captured["url"]
    assert "tracking_number=1Z123" in captured["url"]
    await client.aclose()
