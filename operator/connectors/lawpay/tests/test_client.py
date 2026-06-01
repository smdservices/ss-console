"""Unit tests for the LawPay API client write-safety behavior (issue #1125).

Covers the three money-correctness defects the cross-venture review found:
  - record_payment sends an idempotency key on the write POST
  - amounts are normalized to 2-decimal strings, never binary floats
  - a 401 token refresh does NOT blindly replay a non-idempotent write
"""

from __future__ import annotations

import time
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from operator_lawpay.client import LawPayClient, _normalize_money
from operator_lawpay.oauth import OAuthClient, TokenSet, TokenStore


def _client_with_valid_token(tmp_path: Path, api_handler) -> LawPayClient:
    """Build a LawPayClient whose API calls hit ``api_handler`` and whose
    OAuth layer already has a valid (non-expired) token stored."""
    store = TokenStore(tmp_path, "smd")
    store.save(
        TokenSet(access_token="A", refresh_token="R", expires_at=time.time() + 3600)
    )
    oauth = OAuthClient(
        client_id="x",
        client_secret="y",
        redirect_uri="https://example.com/cb",
        env="sandbox",
        token_store=store,
        http=httpx.AsyncClient(transport=httpx.MockTransport(_refresh_handler)),
    )
    api = httpx.AsyncClient(
        base_url=oauth.base_url + "/v1",
        transport=httpx.MockTransport(api_handler),
    )
    return LawPayClient(oauth, http=api)


def _refresh_handler(request: httpx.Request) -> httpx.Response:
    return httpx.Response(
        200,
        json={
            "access_token": "A2",
            "refresh_token": "R2",
            "expires_in": 3600,
            "token_type": "Bearer",
        },
    )


# --------------------------------------------------------------------------
# _normalize_money
# --------------------------------------------------------------------------


def test_normalize_money_accepts_two_decimal_string():
    assert _normalize_money("1500.00") == "1500.00"
    assert _normalize_money("0.05") == "0.05"


def test_normalize_money_accepts_int_dollars_and_decimal():
    assert _normalize_money(1500) == "1500.00"
    assert _normalize_money(Decimal("19.9")) == "19.90"


def test_normalize_money_rejects_more_than_two_decimals():
    with pytest.raises(ValueError, match="2 decimal places"):
        _normalize_money("19.999")


def test_normalize_money_rejects_non_positive():
    with pytest.raises(ValueError, match="positive"):
        _normalize_money("0.00")
    with pytest.raises(ValueError, match="positive"):
        _normalize_money(Decimal("-5.00"))


def test_normalize_money_rejects_bool_and_garbage():
    with pytest.raises(ValueError, match="boolean"):
        _normalize_money(True)
    with pytest.raises(ValueError, match="not a valid decimal"):
        _normalize_money("abc")


# --------------------------------------------------------------------------
# record_payment write safety
# --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_record_payment_sends_idempotency_key_and_string_amount(tmp_path: Path):
    seen: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["idempotency_key"] = request.headers.get("Idempotency-Key")
        seen["body"] = request.content.decode()
        return httpx.Response(200, json={"id": "pmt_1", "status": "recorded"})

    client = _client_with_valid_token(tmp_path, handler)
    from datetime import date

    result = await client.record_payment(
        invoice_id="inv_1",
        amount=1500.5,  # float call path must still serialize as a string
        method="check",
        received_date=date(2026, 5, 28),
        explicit_approval=True,
    )
    assert result["id"] == "pmt_1"
    assert seen["idempotency_key"], "write POST must carry an Idempotency-Key"
    # Amount transmitted as a 2-decimal string, never a raw float.
    assert '"amount":"1500.50"' in seen["body"]


@pytest.mark.asyncio
async def test_record_payment_idempotency_key_is_stable_for_same_payment(tmp_path: Path):
    keys: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        keys.append(request.headers["Idempotency-Key"])
        return httpx.Response(200, json={"id": "pmt_1"})

    from datetime import date

    for _ in range(2):
        client = _client_with_valid_token(tmp_path, handler)
        await client.record_payment(
            invoice_id="inv_1",
            amount="1500.00",
            method="check",
            received_date=date(2026, 5, 28),
            explicit_approval=True,
        )
    assert keys[0] == keys[1], "same logical payment must derive the same key"


@pytest.mark.asyncio
async def test_record_payment_replays_once_after_401_because_key_present(tmp_path: Path):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(401, json={"error": "token expired"})
        return httpx.Response(200, json={"id": "pmt_1"})

    from datetime import date

    client = _client_with_valid_token(tmp_path, handler)
    result = await client.record_payment(
        invoice_id="inv_1",
        amount="1500.00",
        method="check",
        received_date=date(2026, 5, 28),
        explicit_approval=True,
    )
    # Replay is safe here only because the idempotency key dedupes it.
    assert result["id"] == "pmt_1"
    assert calls["n"] == 2


@pytest.mark.asyncio
async def test_non_idempotent_write_without_key_does_not_replay_on_401(tmp_path: Path):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(401, json={"error": "token expired"})

    client = _client_with_valid_token(tmp_path, handler)
    with pytest.raises(httpx.HTTPStatusError, match="refusing to replay"):
        await client.create_invoice_draft(
            client_id="cli_1",
            line_items=[{"description": "x", "quantity": 1, "unit_price": 10}],
        )
    # The POST was attempted exactly once — no blind replay.
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_record_payment_rejects_bad_amount_before_any_request(tmp_path: Path):
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(200, json={"id": "pmt_1"})

    from datetime import date

    client = _client_with_valid_token(tmp_path, handler)
    with pytest.raises(ValueError, match="2 decimal places"):
        await client.record_payment(
            invoice_id="inv_1",
            amount="19.999",
            method="check",
            received_date=date(2026, 5, 28),
            explicit_approval=True,
        )
    assert calls["n"] == 0, "must validate the amount before hitting the API"
