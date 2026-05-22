"""Unit tests for the Filevine HTTP client error translation.

Covers the HTTP-status-to-AdapterError-code translation table in
`FilevineClient._request`:

* 401 -> ``unauthorized``
* 403 -> ``scope_violation``
* 404 -> caller-translates (None)
* 422 -> ``validation_failed``
* 429 -> ``rate_limited``
* 5xx -> ``transient``
* network exception -> ``transient``
* auth-provider failure -> ``unauthorized``

Plus:

* Bearer token + Accept header propagation
* Non-JSON 200 -> ``unknown``
"""

from __future__ import annotations

import asyncio
import time

import pytest

from connectors.filevine import AdapterError, TokenSet  # type: ignore[import-not-found]
from connectors.filevine.auth import (  # type: ignore[import-not-found]
    InMemoryFilevineAuth,
)

from _helpers import FakeResponse, make_client  # type: ignore[import-not-found]


# ---------------------------------------------------------------------------
# Status code translation
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "status, expected_code",
    [
        (401, "unauthorized"),
        (403, "scope_violation"),
        (422, "validation_failed"),
        (429, "rate_limited"),
        (500, "transient"),
        (502, "transient"),
        (503, "transient"),
        (599, "transient"),
        (418, "unknown"),  # any unmapped 4xx -> unknown
    ],
)
def test_request_translates_status_to_typed_error(status, expected_code):
    responses = {("GET", "/core/projects"): FakeResponse(status_code=status)}
    client, _, _ = make_client(responses=responses)

    with pytest.raises(AdapterError) as exc:
        asyncio.run(
            client._request(
                "GET", "/core/projects", capability="PracticeManagement"
            )
        )
    assert exc.value.code == expected_code
    assert exc.value.capability == "PracticeManagement"
    assert exc.value.adapter == "filevine"


def test_request_404_returns_none_not_raises():
    responses = {("GET", "/core/projects/missing"): FakeResponse(status_code=404)}
    client, _, _ = make_client(responses=responses)

    result = asyncio.run(
        client._request(
            "GET", "/core/projects/missing", capability="PracticeManagement"
        )
    )
    assert result is None


def test_request_network_error_wrapped_as_transient():
    client, _, _ = make_client(raise_on_request=ConnectionError("dns failed"))

    with pytest.raises(AdapterError) as exc:
        asyncio.run(
            client._request("GET", "/core/projects", capability="PracticeManagement")
        )
    assert exc.value.code == "transient"
    assert isinstance(exc.value.cause, ConnectionError)


def test_request_auth_failure_wrapped_as_unauthorized():
    expired = TokenSet(
        access_token="x",
        refresh_token="y",
        expires_at=time.time() - 100,  # already expired
    )
    client, _, _ = make_client(token=expired)

    with pytest.raises(AdapterError) as exc:
        asyncio.run(
            client._request("GET", "/core/projects", capability="PracticeManagement")
        )
    assert exc.value.code == "unauthorized"
    assert exc.value.cause is not None


def test_request_propagates_bearer_token_and_accept_header():
    responses = {("GET", "/core/projects"): FakeResponse(status_code=200, json_body={"items": []})}
    client, fake_http, _ = make_client(responses=responses)

    asyncio.run(
        client._request("GET", "/core/projects", capability="PracticeManagement")
    )
    headers = fake_http.calls[0].headers
    assert headers["Authorization"] == "Bearer test-access"
    assert headers["Accept"] == "application/json"


def test_request_uses_octet_stream_for_bytes_path():
    responses = {("GET", "/core/documents/d/download"): FakeResponse(status_code=200, content=b"abc")}
    client, fake_http, _ = make_client(responses=responses)

    body = asyncio.run(
        client._request(
            "GET",
            "/core/documents/d/download",
            capability="DocumentStorage",
            as_bytes=True,
        )
    )
    assert body == b"abc"
    headers = fake_http.calls[0].headers
    assert headers["Accept"] == "application/octet-stream"


def test_request_non_json_200_raises_unknown():
    class BadResponse(FakeResponse):
        def json(self):  # type: ignore[override]
            raise ValueError("not json")

    responses = {("GET", "/core/projects"): BadResponse(status_code=200)}
    client, _, _ = make_client(responses=responses)

    with pytest.raises(AdapterError) as exc:
        asyncio.run(
            client._request("GET", "/core/projects", capability="PracticeManagement")
        )
    assert exc.value.code == "unknown"


def test_request_post_with_json_body_sets_content_type():
    responses = {
        ("POST", "/core/projects/p/notes"): FakeResponse(
            status_code=201, json_body={"noteId": "n1"}
        )
    }
    client, fake_http, _ = make_client(responses=responses)

    asyncio.run(
        client._request(
            "POST",
            "/core/projects/p/notes",
            capability="PracticeManagement",
            json_body={"body": "hi"},
        )
    )
    headers = fake_http.calls[0].headers
    assert headers["Content-Type"] == "application/json"


# ---------------------------------------------------------------------------
# org_slug + ping
# ---------------------------------------------------------------------------


def test_client_org_slug_proxies_to_auth_provider():
    client, _, auth = make_client(org_slug="kelly-law")
    assert client.org_slug == "kelly-law"


def test_ping_issues_minimal_list_call_and_returns_true():
    responses = {("GET", "/core/projects"): FakeResponse(status_code=200, json_body={"items": []})}
    client, fake_http, _ = make_client(responses=responses)

    assert asyncio.run(client.ping(capability="PracticeManagement")) is True
    call = fake_http.calls[0]
    assert call.params["limit"] == 0
    assert call.params["orgUid"] == "example-firm"
