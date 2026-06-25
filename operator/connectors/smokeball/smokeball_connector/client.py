"""SmokeballClient — the REST/OAuth engine the tool layer wraps.

Auth contract (confirmed against docs.smokeball.com, 2026-06-23, not assumed):

Two grants, selected by ``auth_mode`` (both mint a Bearer at the same Cognito
endpoint ``{auth_host}/oauth2/token`` with ``Authorization: Basic
base64(client_id:client_secret)`` and ``Content-Type:
application/x-www-form-urlencoded``):

- ``client_credentials`` (default) — body ``grant_type=client_credentials`` (+
  ``client_id``). Server-to-server; no user consent. The path proven live against
  our own staging tenant.
- ``authorization_code`` — the firm-delegated grant. The user-consent round-trip
  (authorize → code → first token) happens OUTSIDE this client (the connect flow);
  this client receives the resulting ``refresh_token`` and mints access tokens with
  body ``grant_type=refresh_token`` (+ ``client_id`` + ``refresh_token``). If the
  refresh response rotates the refresh token, we hold the new one in memory.

Both responses carry ``access_token`` / ``expires_in`` / ``token_type: Bearer``.

- EVERY API request carries TWO headers: ``x-api-key`` (the Smokeball-issued
  client key, identifies the app) and ``Authorization: Bearer <token>``.
- Region+environment select the host pair; the two MUST match (never cross
  US/AU/UK or prod/staging hosts).
- ``account_id`` (optional) — when set, every API path is prefixed ``/{account_id}``
  (the documented multi-account server-to-server shape; a single-firm seat usually
  leaves it unset).

This client is a FAITHFUL passthrough: read tools pass params straight through
and return the raw JSON. It deliberately does NOT bake the still-unverified
response/pagination shape or the ``updatedSince`` .NET-ticks conversion — those
are confirmed at the connect step against a live tenant (see smokeball-surface.md
ASSUMED list), and encoding a guess here would be the wrong kind of certainty.
"""

from __future__ import annotations

import base64
import os
import time
from typing import Any

import httpx

# region -> environment -> (auth_host, api_host). Confirmed from the base-URLs doc.
_HOSTS: dict[tuple[str, str], tuple[str, str]] = {
    ("us", "production"): ("https://auth.smokeball.com", "https://api.smokeball.com"),
    ("us", "staging"): ("https://datastaging-auth.smokeball.com", "https://stagingapi.smokeball.com"),
    ("au", "production"): ("https://auth.smokeball.com.au", "https://api.smokeball.com.au"),
    ("au", "staging"): (
        "https://datastaging-auth.smokeball.com.au",
        "https://stagingapi.smokeball.com.au",
    ),
    ("uk", "production"): ("https://auth.smokeball.co.uk", "https://api.smokeball.co.uk"),
    ("uk", "staging"): ("https://datastaging-auth.smokeball.co.uk", "https://stagingapi.smokeball.co.uk"),
}

_TOKEN_SKEW_SECONDS = 60
_MAX_ATTEMPTS = 4
_AUTH_MODES = ("client_credentials", "authorization_code")


def _clean(params: dict[str, Any] | None) -> dict[str, Any] | None:
    """Drop None-valued query params so optional tool args don't send ``None``."""
    if not params:
        return None
    return {k: v for k, v in params.items() if v is not None}


class SmokeballAuthError(RuntimeError):
    """Token mint failed — bad client creds, wrong region/env host, or the auth
    server rejected the grant. Surfaced (without the secret) so the agent gets a
    clear refusal rather than a raw 4xx."""


class SmokeballWriteError(RuntimeError):
    """A document write (upload/delete) failed — the metadata POST returned no
    upload URL, or the presigned PUT was rejected. Surfaced as a clear refusal."""


class SmokeballClient:
    def __init__(
        self,
        *,
        region: str,
        environment: str,
        client_id: str,
        client_secret: str,
        api_key: str,
        auth_mode: str = "client_credentials",
        refresh_token: str | None = None,
        refresh_token_file: str | None = None,
        account_id: str | None = None,
        timeout: float = 30.0,
    ) -> None:
        key = (region.lower(), environment.lower())
        if key not in _HOSTS:
            raise ValueError(
                f"unknown region/environment {region!r}/{environment!r}; "
                f"valid: {sorted(_HOSTS)}"
            )
        if auth_mode not in _AUTH_MODES:
            raise ValueError(f"unknown auth_mode {auth_mode!r}; valid: {_AUTH_MODES}")
        if auth_mode == "authorization_code" and not refresh_token:
            raise ValueError("auth_mode='authorization_code' requires a refresh_token")
        self.region = region.lower()
        self.environment = environment.lower()
        self.auth_host, self.api_host = _HOSTS[key]
        self.auth_mode = auth_mode
        self._client_id = client_id
        self._client_secret = client_secret
        self._api_key = api_key
        self._refresh_token = refresh_token
        # The firm-delegated refresh token's durable home (ADR 0054): the
        # Machine-hosted OAuth callback writes it here, and we rewrite it in place
        # when Smokeball rotates it on a refresh — so a rotated token survives a
        # restart (the Clio token-file pattern).
        self._refresh_token_file = refresh_token_file
        # Normalize the optional account prefix to a bare segment ("abc", not
        # "/abc/") so request() can build "{api_host}/{account_id}{path}" cleanly.
        self._account_id = account_id.strip("/") if account_id else None
        self._token: str | None = None
        self._token_deadline = 0.0
        self._http = httpx.Client(timeout=timeout)

    # ---- auth -------------------------------------------------------------
    def _token_request_body(self) -> dict[str, str]:
        """The grant-specific form body. client_credentials mints from the app's
        own creds; authorization_code mints from the firm-delegated refresh token."""
        if self.auth_mode == "authorization_code":
            # _refresh_token is guaranteed non-None for this mode (ctor enforces it).
            return {
                "grant_type": "refresh_token",
                "client_id": self._client_id,
                "refresh_token": self._refresh_token or "",
            }
        return {"grant_type": "client_credentials", "client_id": self._client_id}

    def _mint_token(self) -> int:
        basic = base64.b64encode(f"{self._client_id}:{self._client_secret}".encode()).decode()
        try:
            resp = self._http.post(
                f"{self.auth_host}/oauth2/token",
                headers={
                    "Authorization": f"Basic {basic}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data=self._token_request_body(),
            )
        except httpx.HTTPError as exc:
            raise SmokeballAuthError(f"token request to {self.auth_host} failed: {exc}") from exc
        if resp.status_code != 200:
            # Never include the response body verbatim — it can echo the grant.
            raise SmokeballAuthError(
                f"token mint ({self.auth_mode}) rejected with HTTP {resp.status_code} "
                f"at {self.auth_host}/oauth2/token"
            )
        body = resp.json()
        token = body.get("access_token")
        if not token:
            raise SmokeballAuthError("token response had no access_token")
        # Smokeball may rotate the refresh token on a refresh_token grant; if it
        # returns a new one, hold it in memory AND rewrite the durable token file
        # so the rotated token survives a restart (ADR 0054, Clio pattern).
        rotated = body.get("refresh_token")
        if self.auth_mode == "authorization_code" and rotated and rotated != self._refresh_token:
            self._refresh_token = rotated
            self._persist_refresh_token(rotated)
        expires_in = int(body.get("expires_in", 3600))
        self._token = token
        self._token_deadline = time.monotonic() + max(expires_in - _TOKEN_SKEW_SECONDS, 0)
        return expires_in

    def _persist_refresh_token(self, token: str) -> None:
        """Atomically rewrite the durable refresh-token file (0600). Best-effort —
        a write failure must not break minting (the in-memory token still works for
        this process); it only means the next restart falls back to the prior file."""
        if not self._refresh_token_file:
            return
        try:
            tmp = f"{self._refresh_token_file}.tmp"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            try:
                os.write(fd, token.encode())
            finally:
                os.close(fd)
            os.replace(tmp, self._refresh_token_file)
        except OSError:
            pass

    def _bearer(self) -> str:
        if self._token is None or time.monotonic() >= self._token_deadline:
            self._mint_token()
        assert self._token is not None
        return self._token

    # ---- requests ---------------------------------------------------------
    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any | None = None,
    ) -> Any:
        """Issue an authenticated request. Returns parsed JSON (or None for an
        empty body). Retries 429 with backoff and refreshes once on a 401."""
        prefix = f"/{self._account_id}" if self._account_id else ""
        url = f"{self.api_host}{prefix}{path}"
        refreshed = False
        last: httpx.Response | None = None
        for attempt in range(_MAX_ATTEMPTS):
            headers = {
                "x-api-key": self._api_key,
                "Authorization": f"Bearer {self._bearer()}",
                "Accept": "application/json",
            }
            last = self._http.request(method, url, params=_clean(params), json=json, headers=headers)
            if last.status_code == 429:
                time.sleep(min(2**attempt, 8))
                continue
            if last.status_code == 401 and not refreshed:
                self._token = None  # force a fresh mint, then retry once
                refreshed = True
                continue
            last.raise_for_status()
            if last.status_code == 204 or not last.content:
                return None
            return last.json()
        assert last is not None
        last.raise_for_status()
        return None

    def get(self, path: str, **params: Any) -> Any:
        return self.request("GET", path, params=params)

    # ---- document writes --------------------------------------------------
    def add_file(
        self,
        matter_id: str,
        file_name: str,
        data: bytes,
        *,
        folder_id: str | None = None,
    ) -> dict[str, Any]:
        """Upload a file to a matter via Smokeball's documented two-stage flow:

        1. ``POST /matters/{id}/documents/files`` with the metadata returns a
           presigned ``uploadUrl`` + ``fileId`` (HTTP 202).
        2. ``PUT`` the raw bytes to that URL with an **empty** ``Content-Type``
           (an S3 presigned-PUT requirement Smokeball calls out explicitly — a
           non-empty value breaks the signature → 403).

        Materialization is asynchronous: the file becomes readable once the
        firm's document worker ingests it, so callers that need to confirm should
        poll ``get_file``. Returns the ``fileId`` (and echoes the request)."""
        body: dict[str, Any] = {"fileName": file_name}
        if folder_id is not None:
            body["folderId"] = folder_id
        info = self.request("POST", f"/matters/{matter_id}/documents/files", json=body)
        if not isinstance(info, dict) or not info.get("uploadUrl"):
            raise SmokeballWriteError(
                "add_file: metadata POST did not return an uploadUrl "
                f"(matter {matter_id!r}, file {file_name!r})"
            )
        self._put_presigned(info["uploadUrl"], data)
        return {
            "fileId": info.get("fileId"),
            "matterId": matter_id,
            "fileName": file_name,
            "uploaded": True,
        }

    def _put_presigned(self, url: str, data: bytes) -> None:
        """PUT raw bytes to a presigned S3 upload URL. The URL is pre-authenticated
        by its signature, so we send NO ``x-api-key``/``Authorization`` and an
        EMPTY ``Content-Type`` (the header is not part of the signed request)."""
        try:
            resp = self._http.put(url, content=data, headers={"Content-Type": ""})
        except httpx.HTTPError as exc:
            raise SmokeballWriteError(f"presigned upload PUT failed: {exc}") from exc
        if resp.status_code >= 400:
            raise SmokeballWriteError(
                f"presigned upload PUT rejected with HTTP {resp.status_code}"
            )

    def delete_file(self, matter_id: str, file_id: str) -> Any:
        """Delete a file from a matter (``DELETE /matters/{id}/documents/files/{fileId}``,
        async — returns the tracking Link). DESTRUCTIVE at the overlay."""
        return self.request("DELETE", f"/matters/{matter_id}/documents/files/{file_id}")

    # ---- health -----------------------------------------------------------
    def auth_status(self) -> dict[str, Any]:
        """Mint a token and report connectivity — never the token/refresh value."""
        expires_in = self._mint_token()
        return {
            "authenticated": True,
            "auth_mode": self.auth_mode,
            "account_scoped": self._account_id is not None,
            "region": self.region,
            "environment": self.environment,
            "api_host": self.api_host,
            "token_expires_in": expires_in,
        }
