"""Unit coverage for the two auth modes + the optional accountId URL prefix.

No live Smokeball calls: an ``httpx.MockTransport`` (built into httpx, no extra
dep) is injected into the client's HTTP engine so the real ``_mint_token`` /
``request`` logic runs against scripted responses. The client_credentials path is
deliberately re-asserted here so a regression in the auth-code branch can't
silently change the proven default.
"""

from __future__ import annotations

from urllib.parse import parse_qs

import httpx
import pytest

from smokeball_connector.client import SmokeballClient, SmokeballAuthError


def _mock_client(handler, **overrides) -> SmokeballClient:
    kwargs = dict(
        region="us",
        environment="staging",
        client_id="cid",
        client_secret="sec",
        api_key="apikey",
    )
    kwargs.update(overrides)
    client = SmokeballClient(**kwargs)
    client._http = httpx.Client(transport=httpx.MockTransport(handler))
    return client


def _token_handler(captured: list[httpx.Request], *, rotate: str | None = None):
    """A handler that answers the token endpoint and echoes any API call as {ok}."""

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        if request.url.path.endswith("/oauth2/token"):
            body: dict = {
                "access_token": "zzz-access-secret",
                "expires_in": 3600,
                "token_type": "Bearer",
            }
            if rotate is not None:
                body["refresh_token"] = rotate
            return httpx.Response(200, json=body)
        return httpx.Response(200, json={"ok": True, "path": request.url.path})

    return handler


# ---- grant selection ------------------------------------------------------
def test_client_credentials_mint_body_is_unchanged() -> None:
    captured: list[httpx.Request] = []
    client = _mock_client(_token_handler(captured))
    client.auth_status()
    token_req = next(r for r in captured if r.url.path.endswith("/oauth2/token"))
    form = parse_qs(token_req.content.decode())
    assert form["grant_type"] == ["client_credentials"]
    assert form["client_id"] == ["cid"]
    assert "refresh_token" not in form


def test_authorization_code_mints_via_refresh_token() -> None:
    captured: list[httpx.Request] = []
    client = _mock_client(
        _token_handler(captured), auth_mode="authorization_code", refresh_token="rt-123"
    )
    client.auth_status()
    token_req = next(r for r in captured if r.url.path.endswith("/oauth2/token"))
    form = parse_qs(token_req.content.decode())
    assert form["grant_type"] == ["refresh_token"]
    assert form["refresh_token"] == ["rt-123"]
    assert form["client_id"] == ["cid"]


def test_authorization_code_requires_refresh_token() -> None:
    with pytest.raises(ValueError, match="refresh_token"):
        SmokeballClient(
            region="us",
            environment="staging",
            client_id="cid",
            client_secret="sec",
            api_key="apikey",
            auth_mode="authorization_code",
        )


def test_unknown_auth_mode_rejected() -> None:
    with pytest.raises(ValueError, match="auth_mode"):
        SmokeballClient(
            region="us",
            environment="staging",
            client_id="cid",
            client_secret="sec",
            api_key="apikey",
            auth_mode="implicit",
        )


def test_refresh_token_rotation_is_adopted() -> None:
    captured: list[httpx.Request] = []
    client = _mock_client(
        _token_handler(captured, rotate="rt-NEW"),
        auth_mode="authorization_code",
        refresh_token="rt-OLD",
    )
    client.auth_status()
    assert client._refresh_token == "rt-NEW"


# ---- accountId prefix -----------------------------------------------------
def test_no_account_id_means_no_prefix() -> None:
    captured: list[httpx.Request] = []
    client = _mock_client(_token_handler(captured))
    client.get("/matters")
    api_req = next(r for r in captured if r.url.path.endswith("/matters"))
    assert api_req.url.path == "/matters"


def test_account_id_prefixes_every_request() -> None:
    captured: list[httpx.Request] = []
    client = _mock_client(_token_handler(captured), account_id="acct-9")
    client.get("/matters")
    api_req = next(r for r in captured if r.url.path.endswith("/matters"))
    assert api_req.url.path == "/acct-9/matters"


def test_account_id_is_normalized_to_a_bare_segment() -> None:
    captured: list[httpx.Request] = []
    client = _mock_client(_token_handler(captured), account_id="/acct-9/")
    client.get("/matters")
    api_req = next(r for r in captured if r.url.path.endswith("/matters"))
    assert api_req.url.path == "/acct-9/matters"


# ---- auth_status surface (never leaks the token) --------------------------
def test_auth_status_reports_mode_not_token() -> None:
    captured: list[httpx.Request] = []
    client = _mock_client(
        _token_handler(captured),
        auth_mode="authorization_code",
        refresh_token="rt-123",
        account_id="acct-9",
    )
    status = client.auth_status()
    assert status["auth_mode"] == "authorization_code"
    assert status["account_scoped"] is True
    blob = repr(status)
    assert "rt-123" not in blob and "zzz-access-secret" not in blob


def test_mint_failure_does_not_echo_grant() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid_grant", "secret_echo": "rt-123"})

    client = _mock_client(handler, auth_mode="authorization_code", refresh_token="rt-123")
    with pytest.raises(SmokeballAuthError) as exc:
        client.auth_status()
    assert "rt-123" not in str(exc.value)
    assert "authorization_code" in str(exc.value)
