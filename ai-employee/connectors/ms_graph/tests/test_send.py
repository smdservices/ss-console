"""Unit tests for the wave-2 reviewer-as-sender concrete impl.

Covers ``ai-employee/connectors/ms_graph/send.py:send_draft_as_reviewer``,
the Microsoft Graph send surface that issue #881 lands. The send
pathway is partner-tap-triggered per
[ADR 0005](../../../../docs/adr/0005-reviewer-as-sender.md):

* Drafts are created by the Email capability adapter (mailbox.py)
  via the Phase-1 ``Mail.ReadWrite`` scope. That path is exercised
  by the existing mailbox tests.
* The reviewer taps Approve in the dashboard. The dashboard's send
  endpoint invokes ``send_draft_as_reviewer`` with the reviewer's
  OAuth grant.
* Graph ``POST /me/messages/{id}/send`` fires under the wave-2
  ``Mail.Send`` scope. HTTP 202 = sent. HTTP 403 = scope missing
  (mapped to forbidden). Other 4xx/5xx = upstream_error.

Coverage targets:

* HTTP 202 response -> SendOutcome(status="sent")
* HTTP 403 response -> SendOutcome(status="failed") with the
  forbidden error code surfaced so the dashboard renders the
  re-consent prompt rather than fabricating success
* HTTP 5xx response -> SendOutcome(status="failed") with the
  upstream_error code surfaced
* Empty draft_id / reviewer_email -> AdapterError(validation_failed)
* No method named ``send_*`` is added to the Email capability
  adapter (ADR 0005 / capability-contracts.md §"Pattern A vs Pattern B
  resolution" -- the Email interface deliberately omits send)
"""

from __future__ import annotations

import time

import httpx
import pytest

try:
    from connectors.ms_graph._client import GraphClient
    from connectors.ms_graph._types import AdapterError
    from connectors.ms_graph.mailbox import MSGraphMailbox
    from connectors.ms_graph.oauth import (
        MSGraphOAuth,
        PHASE_2_SCOPES,
        TokenSet,
        TokenStore,
    )
    from connectors.ms_graph.send import (
        SendOutcome,
        send_draft_as_reviewer,
    )
except ModuleNotFoundError:
    from ms_graph._client import GraphClient  # type: ignore[no-redef]
    from ms_graph._types import AdapterError  # type: ignore[no-redef]
    from ms_graph.mailbox import MSGraphMailbox  # type: ignore[no-redef]
    from ms_graph.oauth import (  # type: ignore[no-redef]
        MSGraphOAuth,
        PHASE_2_SCOPES,
        TokenSet,
        TokenStore,
    )
    from ms_graph.send import (  # type: ignore[no-redef]
        SendOutcome,
        send_draft_as_reviewer,
    )


# ---------------------------------------------------------------------------
# Test fixtures -- mirror the existing test_oauth.py helpers
# ---------------------------------------------------------------------------


def _build_client(
    tmp_path,
    *,
    handler,
) -> tuple[GraphClient, httpx.AsyncClient]:
    """Build a GraphClient with a pre-seeded valid token and a mock
    transport. Returns (client, transport_http) so the caller can close
    the http client."""
    store = TokenStore(tmp_path / "microsoft.json")
    store.save(
        TokenSet(
            access_token="VALID_ACCESS",
            refresh_token="VALID_REFRESH",
            expires_at=time.time() + 3600,
            scopes=PHASE_2_SCOPES,
        )
    )
    transport = httpx.MockTransport(handler)
    http = httpx.AsyncClient(
        base_url="https://graph.microsoft.com/v1.0",
        transport=transport,
        timeout=30.0,
    )
    oauth = MSGraphOAuth(
        client_id="cid",
        client_secret="csecret",
        redirect_uri="https://portal.example/cb",
        scopes=PHASE_2_SCOPES,
        token_store=store,
    )
    client = GraphClient(oauth, http=http)
    return client, http


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_draft_returns_sent_on_202(tmp_path) -> None:
    """Graph returns 202 Accepted with no body on a successful send."""
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["method"] = request.method
        captured["auth"] = request.headers.get("Authorization", "")
        return httpx.Response(202)

    client, http = _build_client(tmp_path, handler=handler)
    try:
        outcome = await send_draft_as_reviewer(
            client,
            draft_id="AQMkAGI0...DRAFT123",
            reviewer_email="pat.owner@smithlaw.com",
        )
    finally:
        await http.aclose()

    assert isinstance(outcome, SendOutcome)
    assert outcome.status == "sent"
    assert outcome.reviewer_email == "pat.owner@smithlaw.com"
    assert outcome.error is None
    # Timestamp populated even on success -- audit attribution requires it.
    assert outcome.sent_at.endswith("Z")

    # Graph endpoint shape per send-an-existing-draft surface.
    assert captured["method"] == "POST"
    assert "/me/messages/AQMkAGI0...DRAFT123/send" in str(captured["url"])
    # Bearer token from the reviewer's grant is on the request.
    assert "VALID_ACCESS" in str(captured["auth"])


# ---------------------------------------------------------------------------
# Failure: missing Mail.Send scope (403)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_draft_surfaces_403_as_forbidden(tmp_path) -> None:
    """A 403 from Graph indicates the reviewer's token lacks Mail.Send.
    The dashboard surfaces a re-consent prompt; the SendOutcome must
    carry the forbidden code so the dashboard can route correctly --
    no silent success, no fabricated `sent` status."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={
                "error": {
                    "code": "ErrorAccessDenied",
                    "message": "The token does not include Mail.Send",
                }
            },
        )

    client, http = _build_client(tmp_path, handler=handler)
    try:
        outcome = await send_draft_as_reviewer(
            client,
            draft_id="DRAFT123",
            reviewer_email="pat.owner@smithlaw.com",
        )
    finally:
        await http.aclose()

    assert outcome.status == "failed"
    assert outcome.reviewer_email == "pat.owner@smithlaw.com"
    assert outcome.error is not None
    # Forbidden is the load-bearing signal; the dashboard branches on it.
    assert outcome.error.startswith("forbidden:")


# ---------------------------------------------------------------------------
# Failure: upstream 5xx
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_draft_surfaces_5xx_as_upstream_error(tmp_path) -> None:
    """Transient upstream failures map to upstream_error so the
    dashboard can offer retry rather than a re-consent prompt."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="Bad Gateway")

    client, http = _build_client(tmp_path, handler=handler)
    try:
        outcome = await send_draft_as_reviewer(
            client,
            draft_id="DRAFT123",
            reviewer_email="pat.owner@smithlaw.com",
        )
    finally:
        await http.aclose()

    assert outcome.status == "failed"
    assert outcome.error is not None
    assert outcome.error.startswith("upstream_error:")


# ---------------------------------------------------------------------------
# Failure: expired token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_draft_surfaces_401_as_auth_expired(tmp_path) -> None:
    """If the access token is rejected and refresh also fails, the
    auth_expired AdapterError bubbles up. The dashboard reads this and
    routes the reviewer through the re-consent flow."""

    # Two-call sequence: first the send 401s, then the refresh 401s.
    state: dict[str, int] = {"calls": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        state["calls"] += 1
        # The OAuth refresh call goes to login.microsoftonline.com which
        # is NOT base_url'd onto the http client we built; httpx will
        # follow the absolute URL. The MockTransport intercepts both.
        if "login.microsoftonline.com" in str(request.url):
            return httpx.Response(400, json={"error": "invalid_grant"})
        return httpx.Response(
            401,
            json={
                "error": {
                    "code": "InvalidAuthenticationToken",
                    "message": "Access token expired",
                }
            },
        )

    client, http = _build_client(tmp_path, handler=handler)
    try:
        outcome = await send_draft_as_reviewer(
            client,
            draft_id="DRAFT123",
            reviewer_email="pat.owner@smithlaw.com",
        )
    finally:
        await http.aclose()

    assert outcome.status == "failed"
    assert outcome.error is not None
    assert outcome.error.startswith("auth_expired:")


# ---------------------------------------------------------------------------
# Validation failures
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_draft_rejects_empty_draft_id(tmp_path) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        # No HTTP call should fire -- the validation guard fails first.
        raise AssertionError("HTTP transport should not be invoked")

    client, http = _build_client(tmp_path, handler=handler)
    try:
        with pytest.raises(AdapterError) as excinfo:
            await send_draft_as_reviewer(
                client,
                draft_id="",
                reviewer_email="pat.owner@smithlaw.com",
            )
    finally:
        await http.aclose()
    assert excinfo.value.code == "validation_failed"


@pytest.mark.asyncio
async def test_send_draft_rejects_empty_reviewer_email(tmp_path) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("HTTP transport should not be invoked")

    client, http = _build_client(tmp_path, handler=handler)
    try:
        with pytest.raises(AdapterError) as excinfo:
            await send_draft_as_reviewer(
                client,
                draft_id="DRAFT123",
                reviewer_email="",
            )
    finally:
        await http.aclose()
    assert excinfo.value.code == "validation_failed"


# ---------------------------------------------------------------------------
# Capability-surface invariant
# ---------------------------------------------------------------------------


def test_email_capability_adapter_has_no_send_method() -> None:
    """capability-contracts.md §"Pattern A vs Pattern B resolution"
    locks the rule: the Email interface deliberately omits ``send``.
    The wave-2 send pathway is a sibling module (send.py), not an
    addition to MSGraphMailbox. This test pins the rule -- adding a
    ``send`` (or ``send_*``) method to MSGraphMailbox fails CI."""
    forbidden = {name for name in dir(MSGraphMailbox) if name.startswith("send")}
    # `send_draft_as_reviewer` is a module-level function in send.py,
    # not a method on the Email adapter. The Email adapter has no
    # send-shaped surface.
    assert forbidden == set(), (
        f"MSGraphMailbox must not expose send-shaped methods; found {forbidden}. "
        "The wave-2 send pathway lives at send.send_draft_as_reviewer, "
        "not on the Email capability adapter (capability-contracts.md "
        '§"Pattern A vs Pattern B resolution").'
    )
