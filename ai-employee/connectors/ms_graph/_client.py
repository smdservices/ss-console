"""Thin async HTTP wrapper around https://graph.microsoft.com/v1.0/.

Centralizes the auth-header injection, 401-retry-once-after-refresh
pattern, and translation of Graph-layer errors into ``AdapterError``.
The capability adapters in ``mailbox.py``, ``calendar_adapter.py``, and
``drive.py`` consume this client; no adapter speaks httpx directly.
"""

from __future__ import annotations

from typing import Any, Optional

import httpx

from .oauth import MSGraphOAuth
from ._types import AdapterError


GRAPH_BASE = "https://graph.microsoft.com/v1.0"


class GraphClient:
    """Per-customer async client. One instance per Hermes Machine."""

    def __init__(
        self,
        oauth: MSGraphOAuth,
        *,
        http: Optional[httpx.AsyncClient] = None,
        capability: str = "Email",
    ) -> None:
        self.oauth = oauth
        self._http = http or httpx.AsyncClient(base_url=GRAPH_BASE, timeout=30.0)
        self._owned_http = http is None
        # Stamped on AdapterError so logs disambiguate which surface tripped.
        self._capability = capability

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json: Optional[dict[str, Any]] = None,
        content: Optional[bytes] = None,
        content_type: Optional[str] = None,
        accept: str = "application/json",
        capability: Optional[str] = None,
    ) -> httpx.Response:
        cap = capability or self._capability
        tokens = await self.oauth.get_valid_tokens()
        headers = {
            "Authorization": tokens.authorization_header(),
            "Accept": accept,
        }
        if content_type:
            headers["Content-Type"] = content_type

        resp = await self._http.request(
            method,
            path,
            params=params,
            json=json,
            content=content,
            headers=headers,
        )
        # If the upstream says the token is no good, refresh and retry once.
        if resp.status_code == 401:
            # Force a refresh by calling refresh() directly; if the refresh
            # itself fails the auth_expired AdapterError surfaces.
            tokens = await self.oauth.refresh(tokens)
            headers["Authorization"] = tokens.authorization_header()
            resp = await self._http.request(
                method,
                path,
                params=params,
                json=json,
                content=content,
                headers=headers,
            )
        if not resp.is_success:
            self._raise_from_response(resp, capability=cap)
        return resp

    def _raise_from_response(self, resp: httpx.Response, *, capability: str) -> None:
        status = resp.status_code
        # Microsoft Graph error envelope is `{ "error": { "code": ..., "message": ... } }`.
        graph_code = ""
        graph_message = ""
        try:
            body = resp.json()
            if isinstance(body, dict):
                err = body.get("error")
                if isinstance(err, dict):
                    graph_code = str(err.get("code") or "")
                    graph_message = str(err.get("message") or "")
        except ValueError:
            graph_message = (resp.text or "")[:200]

        if status == 401 or graph_code.lower() == "invalidauthenticationtoken":
            raise AdapterError(
                code="auth_expired",
                capability=capability,
                adapter=self.oauth.adapter,
                message=f"Microsoft Graph returned 401 ({graph_code or 'unauthenticated'}): {graph_message[:200]}",
            )
        if status == 403:
            raise AdapterError(
                code="forbidden",
                capability=capability,
                adapter=self.oauth.adapter,
                message=f"Microsoft Graph returned 403 ({graph_code}): {graph_message[:200]}",
            )
        if status == 404:
            raise AdapterError(
                code="not_found",
                capability=capability,
                adapter=self.oauth.adapter,
                message=f"Microsoft Graph returned 404: {graph_message[:200]}",
            )
        if status == 429:
            raise AdapterError(
                code="rate_limited",
                capability=capability,
                adapter=self.oauth.adapter,
                message=f"Microsoft Graph rate-limited: {graph_message[:200]}",
            )
        raise AdapterError(
            code="upstream_error",
            capability=capability,
            adapter=self.oauth.adapter,
            message=f"Microsoft Graph HTTP {status} ({graph_code}): {graph_message[:200]}",
        )

    async def aclose(self) -> None:
        if self._owned_http:
            await self._http.aclose()


__all__ = [
    "GRAPH_BASE",
    "GraphClient",
]
