"""Unit tests for the Microsoft Graph OAuth lifecycle.

Coverage targets (from `docs/specs/ai-employee/oauth-lifecycle.md`
§Verification "Unit tests"):

* Token storage round-trip (atomic write + 0600 mode + JSON shape)
* Refresh on expiry within the 10-minute safety margin
* Refresh failure (invalid_grant) -> AdapterError(auth_expired)
* Re-consent URL generation (authorize URL includes signed state +
  every Phase-1 scope; no Mail.Send)
* AppFolder-only write scope is enforced via PHASE_1_SCOPES (the
  client refuses to construct with Mail.Send)
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import httpx
import pytest

# When invoked from the package directory the import path is the
# package itself; when invoked from ai-employee/ via the conftest
# sys.path hook it's ``connectors.ms_graph``. Try both.
try:
    from connectors.ms_graph.oauth import (
        AUTHORIZE_URL,
        MAIL_SEND_SCOPE,
        MSGraphOAuth,
        PHASE_1_SCOPES,
        PHASE_2_SCOPES,
        REFRESH_MARGIN_SECONDS,
        TOKEN_URL,
        TokenSet,
        TokenStore,
    )
    from connectors.ms_graph._types import AdapterError
except ModuleNotFoundError:
    from ms_graph.oauth import (  # type: ignore[no-redef]
        AUTHORIZE_URL,
        MAIL_SEND_SCOPE,
        MSGraphOAuth,
        PHASE_1_SCOPES,
        PHASE_2_SCOPES,
        REFRESH_MARGIN_SECONDS,
        TOKEN_URL,
        TokenSet,
        TokenStore,
    )
    from ms_graph._types import AdapterError  # type: ignore[no-redef]


def _token_payload(
    *,
    access: str = "access1",
    refresh: str | None = "refresh1",
    expires_in: int = 3600,
    scope: str = " ".join(PHASE_1_SCOPES),
) -> dict:
    payload = {
        "access_token": access,
        "expires_in": expires_in,
        "token_type": "Bearer",
        "scope": scope,
    }
    if refresh is not None:
        payload["refresh_token"] = refresh
    return payload


# ----- TokenSet -----


def test_token_set_is_expired_within_safety_margin() -> None:
    tokens = TokenSet(
        access_token="a",
        refresh_token="r",
        expires_at=time.time() + REFRESH_MARGIN_SECONDS // 2,
    )
    assert tokens.is_expired() is True


def test_token_set_not_expired_outside_safety_margin() -> None:
    tokens = TokenSet(
        access_token="a",
        refresh_token="r",
        expires_at=time.time() + REFRESH_MARGIN_SECONDS * 2,
    )
    assert tokens.is_expired() is False


def test_token_set_from_token_response_carries_refresh_forward() -> None:
    previous = TokenSet(
        access_token="old-access",
        refresh_token="long-lived-refresh",
        expires_at=time.time() - 1,
    )
    new = TokenSet.from_token_response(
        _token_payload(access="new-access", refresh=None),
        previous=previous,
    )
    assert new.access_token == "new-access"
    assert new.refresh_token == "long-lived-refresh"


def test_token_set_rejects_missing_access_token() -> None:
    with pytest.raises(ValueError, match="missing access_token"):
        TokenSet.from_token_response({"expires_in": 100})


def test_token_set_rejects_missing_refresh_with_no_previous() -> None:
    with pytest.raises(ValueError, match="missing refresh_token"):
        TokenSet.from_token_response(_token_payload(refresh=None))


# ----- TokenStore -----


def test_token_store_round_trip(tmp_path: Path) -> None:
    store = TokenStore(tmp_path / "microsoft.json")
    original = TokenSet(
        access_token="abc",
        refresh_token="def",
        expires_at=time.time() + 3600,
        scopes=("Mail.Read", "Calendars.ReadWrite"),
        obtained_at=time.time(),
    )
    store.save(original)
    loaded = store.load()
    assert loaded is not None
    assert loaded.access_token == "abc"
    assert loaded.refresh_token == "def"
    assert loaded.scopes == ("Mail.Read", "Calendars.ReadWrite")


def test_token_store_returns_none_when_no_tokens(tmp_path: Path) -> None:
    store = TokenStore(tmp_path / "microsoft.json")
    assert store.load() is None


def test_token_store_enforces_0600_permissions(tmp_path: Path) -> None:
    store = TokenStore(tmp_path / "microsoft.json")
    store.save(TokenSet(access_token="a", refresh_token="r", expires_at=time.time() + 3600))
    mode = store.path.stat().st_mode & 0o777
    assert mode == 0o600


def test_token_store_writes_adr_0010_json_shape(tmp_path: Path) -> None:
    store = TokenStore(tmp_path / "microsoft.json")
    now = time.time()
    store.save(
        TokenSet(
            access_token="a",
            refresh_token="r",
            expires_at=now + 3600,
            scopes=("Mail.Read",),
            obtained_at=now,
        )
    )
    on_disk = json.loads(store.path.read_bytes())
    # Required fields per ADR 0010 §Storage shape
    assert set(on_disk.keys()) >= {
        "access_token",
        "refresh_token",
        "scopes",
        "expires_at",
        "obtained_at",
        "provider",
    }
    assert on_disk["provider"] == "microsoft"
    assert on_disk["scopes"] == ["Mail.Read"]
    # ISO 8601 UTC, trailing Z
    assert on_disk["expires_at"].endswith("Z")
    assert on_disk["obtained_at"].endswith("Z")


def test_token_store_atomic_replace(tmp_path: Path) -> None:
    """A second write replaces atomically; no .tmp files left behind."""
    store = TokenStore(tmp_path / "microsoft.json")
    store.save(TokenSet(access_token="v1", refresh_token="r", expires_at=time.time() + 3600))
    store.save(TokenSet(access_token="v2", refresh_token="r", expires_at=time.time() + 3600))
    loaded = store.load()
    assert loaded is not None and loaded.access_token == "v2"
    leftover = list(tmp_path.glob("microsoft.json.*.tmp"))
    assert leftover == []


# ----- MSGraphOAuth construction -----


def test_oauth_accepts_mail_send_scope_when_explicitly_requested(tmp_path: Path) -> None:
    """Wave-2 (#881) -- customers opting in to reviewer-as-sender pass
    PHASE_2_SCOPES (which adds Mail.Send) and the OAuth client accepts
    it. The Phase-1 default (PHASE_1_SCOPES) still excludes Mail.Send,
    so a customer who has not opted in cannot accidentally request it."""
    oauth = MSGraphOAuth(
        client_id="x",
        client_secret="y",
        redirect_uri="https://portal.example/ai-employee/oauth/microsoft-graph/callback",
        scopes=PHASE_2_SCOPES,
        token_store=TokenStore(tmp_path / "microsoft.json"),
    )
    assert MAIL_SEND_SCOPE in oauth.scopes


def test_oauth_requires_client_id(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="client_id is required"):
        MSGraphOAuth(
            client_id="",
            client_secret="y",
            redirect_uri="https://example/cb",
            token_store=TokenStore(tmp_path / "microsoft.json"),
        )


def test_oauth_requires_client_secret(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="client_secret is required"):
        MSGraphOAuth(
            client_id="x",
            client_secret="",
            redirect_uri="https://example/cb",
            token_store=TokenStore(tmp_path / "microsoft.json"),
        )


def test_oauth_requires_redirect_uri(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="redirect_uri is required"):
        MSGraphOAuth(
            client_id="x",
            client_secret="y",
            redirect_uri="",
            token_store=TokenStore(tmp_path / "microsoft.json"),
        )


# ----- Authorize URL generation -----


def test_authorize_url_includes_state_and_phase_1_scopes(tmp_path: Path) -> None:
    oauth = MSGraphOAuth(
        client_id="abc-123",
        client_secret="secret",
        redirect_uri="https://portal.smd.services/ai-employee/oauth/microsoft-graph/callback",
        token_store=TokenStore(tmp_path / "microsoft.json"),
    )
    url = oauth.authorize_url(state="signed-state-token")
    assert url.startswith(AUTHORIZE_URL)
    assert "client_id=abc-123" in url
    assert "state=signed-state-token" in url
    assert "response_type=code" in url
    assert "redirect_uri=" in url
    # Every Phase-1 scope must be in the URL
    for scope in PHASE_1_SCOPES:
        assert scope in url
    # Mail.Send must NOT be in the URL
    assert "Mail.Send" not in url
    assert "mail.send" not in url


def test_authorize_url_optional_login_hint(tmp_path: Path) -> None:
    oauth = MSGraphOAuth(
        client_id="abc",
        client_secret="secret",
        redirect_uri="https://example/cb",
        token_store=TokenStore(tmp_path / "microsoft.json"),
    )
    url = oauth.authorize_url(state="s", login_hint="user@example.com")
    assert "login_hint=user%40example.com" in url or "login_hint=user@example.com" in url


# ----- Auth code exchange -----


@pytest.mark.asyncio
async def test_exchange_auth_code_hits_token_endpoint(tmp_path: Path) -> None:
    captured_request: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_request["url"] = str(request.url)
        captured_request["method"] = request.method
        captured_request["body"] = request.read().decode()
        return httpx.Response(200, json=_token_payload(access="A1", refresh="R1"))

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        oauth = MSGraphOAuth(
            client_id="cid",
            client_secret="csecret",
            redirect_uri="https://portal.example/cb",
            token_store=TokenStore(tmp_path / "microsoft.json"),
            http=http,
        )
        tokens = await oauth.exchange_auth_code("CODE123")

    assert tokens.access_token == "A1"
    assert tokens.refresh_token == "R1"
    assert captured_request["url"] == TOKEN_URL
    assert captured_request["method"] == "POST"
    body = str(captured_request["body"])
    assert "grant_type=authorization_code" in body
    assert "code=CODE123" in body
    # Persisted to disk
    persisted = TokenStore(tmp_path / "microsoft.json").load()
    assert persisted is not None and persisted.access_token == "A1"


# ----- Refresh -----


@pytest.mark.asyncio
async def test_get_valid_tokens_refreshes_within_safety_margin(tmp_path: Path) -> None:
    """A token that expires inside the 10-minute window triggers refresh."""
    store = TokenStore(tmp_path / "microsoft.json")
    # Expires in 5 minutes -- well inside the 10-minute margin.
    store.save(
        TokenSet(
            access_token="OLD",
            refresh_token="REFRESH_OLD",
            expires_at=time.time() + 300,
        )
    )
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.read().decode()
        calls.append(body)
        return httpx.Response(200, json=_token_payload(access="NEW", refresh="REFRESH_NEW"))

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        oauth = MSGraphOAuth(
            client_id="cid",
            client_secret="csecret",
            redirect_uri="https://portal.example/cb",
            token_store=store,
            http=http,
        )
        tokens = await oauth.get_valid_tokens()

    assert tokens.access_token == "NEW"
    assert tokens.refresh_token == "REFRESH_NEW"
    assert len(calls) == 1
    assert "grant_type=refresh_token" in calls[0]
    assert "refresh_token=REFRESH_OLD" in calls[0]


@pytest.mark.asyncio
async def test_get_valid_tokens_skips_refresh_when_well_in_future(tmp_path: Path) -> None:
    store = TokenStore(tmp_path / "microsoft.json")
    store.save(
        TokenSet(
            access_token="STILL_GOOD",
            refresh_token="r",
            expires_at=time.time() + 3600,
        )
    )
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=_token_payload())

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        oauth = MSGraphOAuth(
            client_id="cid",
            client_secret="csecret",
            redirect_uri="https://portal.example/cb",
            token_store=store,
            http=http,
        )
        tokens = await oauth.get_valid_tokens()

    assert tokens.access_token == "STILL_GOOD"
    assert calls == 0


@pytest.mark.asyncio
async def test_refresh_translates_invalid_grant_to_auth_expired(tmp_path: Path) -> None:
    store = TokenStore(tmp_path / "microsoft.json")
    store.save(
        TokenSet(access_token="OLD", refresh_token="REVOKED", expires_at=time.time() - 1)
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={
                "error": "invalid_grant",
                "error_description": "AADSTS70008: refresh token expired",
            },
        )

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        oauth = MSGraphOAuth(
            client_id="cid",
            client_secret="csecret",
            redirect_uri="https://portal.example/cb",
            token_store=store,
            http=http,
        )
        with pytest.raises(AdapterError) as excinfo:
            await oauth.get_valid_tokens()
    assert excinfo.value.code == "auth_expired"
    assert excinfo.value.adapter == "microsoft-graph"


@pytest.mark.asyncio
async def test_refresh_translates_other_errors_to_upstream_error(tmp_path: Path) -> None:
    store = TokenStore(tmp_path / "microsoft.json")
    store.save(
        TokenSet(access_token="OLD", refresh_token="r", expires_at=time.time() - 1)
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="Service Unavailable")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        oauth = MSGraphOAuth(
            client_id="cid",
            client_secret="csecret",
            redirect_uri="https://portal.example/cb",
            token_store=store,
            http=http,
        )
        with pytest.raises(AdapterError) as excinfo:
            await oauth.get_valid_tokens()
    assert excinfo.value.code == "upstream_error"


@pytest.mark.asyncio
async def test_get_valid_tokens_raises_auth_expired_without_initial_consent(
    tmp_path: Path,
) -> None:
    oauth = MSGraphOAuth(
        client_id="cid",
        client_secret="csecret",
        redirect_uri="https://portal.example/cb",
        token_store=TokenStore(tmp_path / "microsoft.json"),
    )
    with pytest.raises(AdapterError) as excinfo:
        await oauth.get_valid_tokens()
    assert excinfo.value.code == "auth_expired"
    assert "customer must complete initial OAuth consent" in str(excinfo.value)


@pytest.mark.asyncio
async def test_refresh_carries_previous_refresh_token_when_response_omits_it(
    tmp_path: Path,
) -> None:
    store = TokenStore(tmp_path / "microsoft.json")
    store.save(
        TokenSet(
            access_token="OLD",
            refresh_token="LONG_LIVED",
            expires_at=time.time() - 1,
        )
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        # Graph sometimes returns a refreshed token without a new refresh_token
        # when it elects not to rotate.
        return httpx.Response(200, json=_token_payload(access="NEW", refresh=None))

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as http:
        oauth = MSGraphOAuth(
            client_id="cid",
            client_secret="csecret",
            redirect_uri="https://portal.example/cb",
            token_store=store,
            http=http,
        )
        tokens = await oauth.get_valid_tokens()

    assert tokens.access_token == "NEW"
    assert tokens.refresh_token == "LONG_LIVED"


# ----- Phase-1 scopes -----


def test_phase_1_scopes_have_no_mail_send() -> None:
    assert "Mail.Send" not in PHASE_1_SCOPES
    assert all(s.lower() != "mail.send" for s in PHASE_1_SCOPES)


def test_phase_1_scopes_match_lifecycle_spec() -> None:
    """The scope set must match oauth-lifecycle.md §"Per-connector OAuth scope inventory"."""
    required = {
        "offline_access",
        "User.Read",
        "Mail.Read",
        "Mail.ReadWrite",
        "MailboxSettings.Read",
        "Calendars.ReadWrite",
        "Files.Read",
        "Files.ReadWrite.AppFolder",
    }
    assert set(PHASE_1_SCOPES) == required


# ----- Wave-2 scopes (#881) -----


def test_phase_2_scopes_extend_phase_1_with_mail_send() -> None:
    """Wave-2 reviewer-as-sender opts in to Mail.Send on top of the
    Phase-1 set. PHASE_2_SCOPES must be a strict superset so a customer
    who is on PHASE_2 keeps every Phase-1 capability."""
    assert set(PHASE_1_SCOPES).issubset(set(PHASE_2_SCOPES))
    assert MAIL_SEND_SCOPE in PHASE_2_SCOPES
    # And the only addition is Mail.Send; nothing else creeps in.
    assert set(PHASE_2_SCOPES) - set(PHASE_1_SCOPES) == {MAIL_SEND_SCOPE}


def test_authorize_url_with_phase_2_scopes_includes_mail_send(tmp_path: Path) -> None:
    """When the customer is on the wave-2 consent, the authorize URL
    advertises Mail.Send so the Entra consent prompt asks for it."""
    oauth = MSGraphOAuth(
        client_id="abc-123",
        client_secret="secret",
        redirect_uri="https://portal.smd.services/ai-employee/oauth/microsoft-graph/callback",
        scopes=PHASE_2_SCOPES,
        token_store=TokenStore(tmp_path / "microsoft.json"),
    )
    url = oauth.authorize_url(state="signed-state-token")
    assert "Mail.Send" in url
    # Phase-1 scopes still all present so wave-2 doesn't accidentally
    # narrow the grant.
    for scope in PHASE_1_SCOPES:
        assert scope in url
