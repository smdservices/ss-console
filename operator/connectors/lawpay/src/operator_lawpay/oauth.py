"""OAuth 2.0 token management for LawPay (8am) API.

Implements the Authorization Code flow per developers.8am.com. Per-customer
tokens are stored on the customer's Fly machine's persistent volume so they
never leave the customer's instance. Refresh handling is automatic — token
expiry is detected at request time and a refresh is issued in-process.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any

import httpx

# Default base URL is prod; LAWPAY_ENV=sandbox switches to api-sandbox.8am.com
PROD_BASE = "https://api.8am.com"
SANDBOX_BASE = "https://api-sandbox.8am.com"

# Token endpoint relative to the base URL
TOKEN_PATH = "/oauth/token"

# Safety margin: refresh tokens this many seconds before stated expiry
REFRESH_MARGIN_SECONDS = 60


@dataclass
class TokenSet:
    """The OAuth token pair plus expiry metadata."""

    access_token: str
    refresh_token: str
    expires_at: float  # epoch seconds when access_token expires
    token_type: str = "Bearer"

    @classmethod
    def from_token_response(cls, payload: dict[str, Any]) -> "TokenSet":
        expires_in = float(payload.get("expires_in", 3600))
        return cls(
            access_token=str(payload["access_token"]),
            refresh_token=str(payload["refresh_token"]),
            expires_at=time.time() + expires_in,
            token_type=str(payload.get("token_type", "Bearer")),
        )

    def is_expired(self) -> bool:
        return time.time() + REFRESH_MARGIN_SECONDS >= self.expires_at

    def authorization_header(self) -> str:
        return f"{self.token_type} {self.access_token}"


class TokenStore:
    """File-backed per-customer token storage on the persistent volume."""

    def __init__(self, base_path: Path, customer_id: str) -> None:
        self.path = base_path / customer_id / "tokens.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> TokenSet | None:
        if not self.path.exists():
            return None
        with self.path.open() as f:
            data = json.load(f)
        return TokenSet(**data)

    def save(self, tokens: TokenSet) -> None:
        tmp = self.path.with_suffix(".tmp")
        with tmp.open("w") as f:
            json.dump(asdict(tokens), f)
        tmp.replace(self.path)
        self.path.chmod(0o600)


class OAuthClient:
    """LawPay OAuth client. Handles auth-code exchange + refresh."""

    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        env: str = "prod",
        token_store: TokenStore,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        if env not in ("prod", "sandbox"):
            raise ValueError(f"env must be 'prod' or 'sandbox', got {env!r}")
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.base_url = SANDBOX_BASE if env == "sandbox" else PROD_BASE
        self.token_store = token_store
        self._http = http or httpx.AsyncClient(timeout=30.0)

    @property
    def authorize_url(self) -> str:
        """The URL a customer visits to authorize the SMD application.

        Customer logs into LawPay, approves, redirects to redirect_uri with
        ?code=AUTH_CODE attached. The customer then runs the setup command
        with that auth code to complete the exchange.
        """
        # LawPay's auth endpoint per developers.8am.com (path may need
        # adjustment once we verify against the live sandbox).
        return (
            f"{self.base_url}/oauth/authorize"
            f"?response_type=code"
            f"&client_id={self.client_id}"
            f"&redirect_uri={self.redirect_uri}"
            f"&scope=invoices.read payments.read clients.read aging.read"
        )

    async def exchange_auth_code(self, code: str) -> TokenSet:
        """Trade an auth code for the initial token pair."""
        resp = await self._http.post(
            f"{self.base_url}{TOKEN_PATH}",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.redirect_uri,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
        )
        resp.raise_for_status()
        tokens = TokenSet.from_token_response(resp.json())
        self.token_store.save(tokens)
        return tokens

    async def refresh(self, current: TokenSet) -> TokenSet:
        """Refresh an expired access token using the refresh token."""
        resp = await self._http.post(
            f"{self.base_url}{TOKEN_PATH}",
            data={
                "grant_type": "refresh_token",
                "refresh_token": current.refresh_token,
                "client_id": self.client_id,
                "client_secret": self.client_secret,
            },
        )
        resp.raise_for_status()
        tokens = TokenSet.from_token_response(resp.json())
        self.token_store.save(tokens)
        return tokens

    async def get_valid_tokens(self) -> TokenSet:
        """Return a non-expired TokenSet, refreshing if needed.

        Raises FileNotFoundError if no tokens are stored (customer hasn't
        completed initial OAuth setup yet).
        """
        tokens = self.token_store.load()
        if tokens is None:
            raise FileNotFoundError(
                f"No LawPay tokens stored at {self.token_store.path}. "
                f"Run `python -m operator_lawpay.setup` to complete initial OAuth."
            )
        if tokens.is_expired():
            tokens = await self.refresh(tokens)
        return tokens

    async def aclose(self) -> None:
        await self._http.aclose()
