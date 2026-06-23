"""SmokeballClient — the REST/OAuth engine the tool layer wraps.

Auth contract (confirmed against docs.smokeball.com, 2026-06-23, not assumed):

- client_credentials grant → AWS Cognito token endpoint ``{auth_host}/oauth2/token``,
  POST with ``Authorization: Basic base64(client_id:client_secret)`` and
  ``Content-Type: application/x-www-form-urlencoded``, body
  ``grant_type=client_credentials`` (+ ``client_id``). Response carries
  ``access_token`` / ``expires_in`` / ``token_type: Bearer``.
- EVERY API request carries TWO headers: ``x-api-key`` (the Smokeball-issued
  client key, identifies the app) and ``Authorization: Bearer <token>``.
- Region+environment select the host pair; the two MUST match (never cross
  US/AU/UK or prod/staging hosts).

This client is a FAITHFUL passthrough: read tools pass params straight through
and return the raw JSON. It deliberately does NOT bake the still-unverified
response/pagination shape or the ``updatedSince`` .NET-ticks conversion — those
are confirmed at the connect step against a live tenant (see smokeball-surface.md
ASSUMED list), and encoding a guess here would be the wrong kind of certainty.
"""

from __future__ import annotations

import base64
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


def _clean(params: dict[str, Any] | None) -> dict[str, Any] | None:
    """Drop None-valued query params so optional tool args don't send ``None``."""
    if not params:
        return None
    return {k: v for k, v in params.items() if v is not None}


class SmokeballAuthError(RuntimeError):
    """Token mint failed — bad client creds, wrong region/env host, or the auth
    server rejected the grant. Surfaced (without the secret) so the agent gets a
    clear refusal rather than a raw 4xx."""


class SmokeballClient:
    def __init__(
        self,
        *,
        region: str,
        environment: str,
        client_id: str,
        client_secret: str,
        api_key: str,
        timeout: float = 30.0,
    ) -> None:
        key = (region.lower(), environment.lower())
        if key not in _HOSTS:
            raise ValueError(
                f"unknown region/environment {region!r}/{environment!r}; "
                f"valid: {sorted(_HOSTS)}"
            )
        self.region = region.lower()
        self.environment = environment.lower()
        self.auth_host, self.api_host = _HOSTS[key]
        self._client_id = client_id
        self._client_secret = client_secret
        self._api_key = api_key
        self._token: str | None = None
        self._token_deadline = 0.0
        self._http = httpx.Client(timeout=timeout)

    # ---- auth -------------------------------------------------------------
    def _mint_token(self) -> int:
        basic = base64.b64encode(f"{self._client_id}:{self._client_secret}".encode()).decode()
        try:
            resp = self._http.post(
                f"{self.auth_host}/oauth2/token",
                headers={
                    "Authorization": f"Basic {basic}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={"grant_type": "client_credentials", "client_id": self._client_id},
            )
        except httpx.HTTPError as exc:
            raise SmokeballAuthError(f"token request to {self.auth_host} failed: {exc}") from exc
        if resp.status_code != 200:
            # Never include the response body verbatim — it can echo the grant.
            raise SmokeballAuthError(
                f"token mint rejected with HTTP {resp.status_code} at {self.auth_host}/oauth2/token"
            )
        body = resp.json()
        token = body.get("access_token")
        if not token:
            raise SmokeballAuthError("token response had no access_token")
        expires_in = int(body.get("expires_in", 3600))
        self._token = token
        self._token_deadline = time.monotonic() + max(expires_in - _TOKEN_SKEW_SECONDS, 0)
        return expires_in

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
        url = f"{self.api_host}{path}"
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

    # ---- health -----------------------------------------------------------
    def auth_status(self) -> dict[str, Any]:
        """Mint a token and report connectivity — never the token value."""
        expires_in = self._mint_token()
        return {
            "authenticated": True,
            "region": self.region,
            "environment": self.environment,
            "api_host": self.api_host,
            "token_expires_in": expires_in,
        }
