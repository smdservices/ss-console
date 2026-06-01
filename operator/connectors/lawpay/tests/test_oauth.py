"""Unit tests for the OAuth token management module.

Mocks the LawPay token endpoint via httpx mock. Exercises:
  - Auth code exchange
  - Token refresh
  - Token expiry detection
  - File-backed token storage round-trip
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import httpx
import pytest

from operator_lawpay.oauth import (
    PROD_BASE,
    SANDBOX_BASE,
    OAuthClient,
    REFRESH_MARGIN_SECONDS,
    TokenSet,
    TokenStore,
)


def _make_token_response(access: str = "access1", refresh: str = "refresh1", expires_in: int = 3600) -> dict:
    return {
        "access_token": access,
        "refresh_token": refresh,
        "expires_in": expires_in,
        "token_type": "Bearer",
    }


def test_token_set_is_expired_when_within_margin():
    tokens = TokenSet(
        access_token="a", refresh_token="r", expires_at=time.time() + REFRESH_MARGIN_SECONDS // 2
    )
    assert tokens.is_expired() is True


def test_token_set_not_expired_when_outside_margin():
    tokens = TokenSet(
        access_token="a", refresh_token="r", expires_at=time.time() + REFRESH_MARGIN_SECONDS * 2
    )
    assert tokens.is_expired() is False


def test_token_store_round_trip(tmp_path: Path):
    store = TokenStore(tmp_path, "smd")
    original = TokenSet(access_token="abc", refresh_token="def", expires_at=time.time() + 3600)
    store.save(original)
    loaded = store.load()
    assert loaded is not None
    assert loaded.access_token == original.access_token
    assert loaded.refresh_token == original.refresh_token
    assert loaded.expires_at == original.expires_at


def test_token_store_returns_none_when_no_tokens(tmp_path: Path):
    store = TokenStore(tmp_path, "smd")
    assert store.load() is None


def test_token_store_file_permissions(tmp_path: Path):
    store = TokenStore(tmp_path, "smd")
    store.save(TokenSet(access_token="a", refresh_token="r", expires_at=time.time() + 3600))
    # File must be 0o600 — secrets aren't world-readable
    mode = store.path.stat().st_mode & 0o777
    assert mode == 0o600


def test_oauth_client_rejects_invalid_env(tmp_path: Path):
    with pytest.raises(ValueError, match="must be 'prod' or 'sandbox'"):
        OAuthClient(
            client_id="x",
            client_secret="y",
            redirect_uri="https://example.com/cb",
            env="staging",  # invalid
            token_store=TokenStore(tmp_path, "smd"),
        )


def test_oauth_client_sandbox_base(tmp_path: Path):
    oauth = OAuthClient(
        client_id="x",
        client_secret="y",
        redirect_uri="https://example.com/cb",
        env="sandbox",
        token_store=TokenStore(tmp_path, "smd"),
    )
    assert oauth.base_url == SANDBOX_BASE


def test_oauth_client_prod_base(tmp_path: Path):
    oauth = OAuthClient(
        client_id="x",
        client_secret="y",
        redirect_uri="https://example.com/cb",
        env="prod",
        token_store=TokenStore(tmp_path, "smd"),
    )
    assert oauth.base_url == PROD_BASE


@pytest.mark.asyncio
async def test_exchange_auth_code(tmp_path: Path):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/oauth/token"
        return httpx.Response(200, json=_make_token_response(access="A1", refresh="R1"))

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        oauth = OAuthClient(
            client_id="x",
            client_secret="y",
            redirect_uri="https://example.com/cb",
            env="sandbox",
            token_store=TokenStore(tmp_path, "smd"),
            http=http,
        )
        tokens = await oauth.exchange_auth_code("CODE123")

    assert tokens.access_token == "A1"
    assert tokens.refresh_token == "R1"
    assert tokens.is_expired() is False
    # Verify persisted
    reloaded = TokenStore(tmp_path, "smd").load()
    assert reloaded is not None
    assert reloaded.access_token == "A1"


@pytest.mark.asyncio
async def test_get_valid_tokens_refreshes_when_expired(tmp_path: Path):
    store = TokenStore(tmp_path, "smd")
    # Pre-populate an expired token
    expired = TokenSet(access_token="OLD", refresh_token="REFRESH_OLD", expires_at=time.time() - 100)
    store.save(expired)

    call_count = {"value": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        call_count["value"] += 1
        body = dict(request.read().decode().split("&") and {})  # unused
        return httpx.Response(200, json=_make_token_response(access="NEW", refresh="REFRESH_NEW"))

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        oauth = OAuthClient(
            client_id="x",
            client_secret="y",
            redirect_uri="https://example.com/cb",
            env="sandbox",
            token_store=store,
            http=http,
        )
        tokens = await oauth.get_valid_tokens()

    assert tokens.access_token == "NEW"
    assert call_count["value"] == 1  # one refresh call


@pytest.mark.asyncio
async def test_get_valid_tokens_raises_without_setup(tmp_path: Path):
    oauth = OAuthClient(
        client_id="x",
        client_secret="y",
        redirect_uri="https://example.com/cb",
        env="sandbox",
        token_store=TokenStore(tmp_path, "smd"),
    )
    with pytest.raises(FileNotFoundError, match="No LawPay tokens stored"):
        await oauth.get_valid_tokens()
