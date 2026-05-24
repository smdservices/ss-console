"""OAuth 2.0 token management for Microsoft Graph.

Implements the per-customer Fly-volume storage shape from
[ADR 0010](../../../../docs/adr/0010-per-customer-oauth-token-storage.md):
tokens live at ``/opt/data/oauth/microsoft.json`` (chmod 0600), atomic
write on refresh, the 10-minute safety margin from
[oauth-lifecycle.md](../../../../docs/specs/ai-employee/oauth-lifecycle.md).

The class shape mirrors the LawPay reference implementation at
``ai-employee/connectors/lawpay/src/ai_employee_lawpay/oauth.py``, with
two differences:

1. Refresh-token-revoked is surfaced as
   ``AdapterError(code="auth_expired", ...)`` per the
   ``capability-contracts.md`` ``CapabilityError`` mapping, so the
   runtime can drive the re-consent flow.
2. The token file lives at the canonical ADR-0010 path
   (``/opt/data/oauth/microsoft.json``), one file per provider in a
   single shared directory, rather than the LawPay
   ``<base>/<customer>/tokens.json`` layout. The customer scope is
   per-Machine (ADR 0007) so the per-customer subdirectory is
   redundant.
"""

from __future__ import annotations

import json
import os
import tempfile
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Optional

import httpx

from ._types import AdapterError


# Microsoft Graph delegated OAuth endpoints (multi-tenant).
AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"

# Fly-volume token storage path per ADR 0010.
DEFAULT_TOKEN_PATH = Path("/opt/data/oauth/microsoft.json")

# 10-minute safety margin from oauth-lifecycle.md.
REFRESH_MARGIN_SECONDS = 600

# Phase 1 delegated scopes per oauth-lifecycle.md. `offline_access` is
# required to receive a refresh token. `Mail.Send` is intentionally
# excluded from the Phase-1 set -- it is wave-2 and lives in
# PHASE_2_SCOPES below.
PHASE_1_SCOPES: tuple[str, ...] = (
    "offline_access",
    "User.Read",
    "Mail.Read",
    "Mail.ReadWrite",
    "MailboxSettings.Read",
    "Calendars.ReadWrite",
    "Files.Read",
    "Files.ReadWrite.AppFolder",
)

# Wave-2 (issue #881) scope addition for reviewer-as-sender per
# [ADR 0005](../../../../docs/adr/0005-reviewer-as-sender.md). The send
# itself is fired by the dashboard as a partner-tap action against an
# existing draft created via the Phase-1 `Mail.ReadWrite` scope; the
# agent never holds a send token, the reviewer always does. Customers
# opt into wave-2 by re-consenting against PHASE_2_SCOPES, which adds
# `Mail.Send` on top of PHASE_1_SCOPES.
MAIL_SEND_SCOPE = "Mail.Send"
PHASE_2_SCOPES: tuple[str, ...] = PHASE_1_SCOPES + (MAIL_SEND_SCOPE,)


@dataclass
class TokenSet:
    """OAuth token pair plus expiry metadata.

    Shape matches the JSON-on-disk format described in ADR 0010 §
    "Storage shape": ``{ access_token, refresh_token, scopes,
    expires_at (iso8601), obtained_at (iso8601), provider }``.
    Internally we keep ``expires_at`` as epoch seconds (the LawPay
    pattern) and translate at the disk boundary.
    """

    access_token: str
    refresh_token: str
    expires_at: float  # epoch seconds when access_token expires
    scopes: tuple[str, ...] = ()
    obtained_at: float = 0.0
    token_type: str = "Bearer"

    @classmethod
    def from_token_response(
        cls, payload: dict[str, Any], previous: Optional["TokenSet"] = None
    ) -> "TokenSet":
        """Build a TokenSet from a Microsoft Graph token-endpoint response.

        Microsoft Graph returns ``access_token``, ``expires_in``, ``scope``
        (space-separated), and ``refresh_token`` (only when
        ``offline_access`` is in the requested scopes). When a refresh
        call returns no new ``refresh_token`` we carry the previous one
        forward -- Microsoft refresh tokens are long-lived and only
        rotated occasionally.
        """
        access_token = str(payload.get("access_token") or "")
        if not access_token:
            raise ValueError("token response missing access_token")
        expires_in = float(payload.get("expires_in", 3600))
        refresh_token = payload.get("refresh_token")
        if not refresh_token and previous is not None:
            refresh_token = previous.refresh_token
        if not refresh_token:
            raise ValueError(
                "token response missing refresh_token and no previous token "
                "to carry forward (was offline_access requested?)"
            )
        scope_raw = payload.get("scope") or ""
        scopes = tuple(s for s in scope_raw.split(" ") if s) if isinstance(scope_raw, str) else ()
        return cls(
            access_token=access_token,
            refresh_token=str(refresh_token),
            expires_at=time.time() + expires_in,
            scopes=scopes,
            obtained_at=time.time(),
            token_type=str(payload.get("token_type") or "Bearer"),
        )

    def is_expired(self, *, margin_seconds: int = REFRESH_MARGIN_SECONDS) -> bool:
        """True if the access token expires within the refresh margin."""
        return time.time() + margin_seconds >= self.expires_at

    def authorization_header(self) -> str:
        return f"{self.token_type} {self.access_token}"

    def to_json_bytes(self) -> bytes:
        """Serialize to the ADR 0010 on-disk JSON shape."""
        payload = {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "scopes": list(self.scopes),
            "expires_at": _epoch_to_iso(self.expires_at),
            "obtained_at": _epoch_to_iso(self.obtained_at or time.time()),
            "provider": "microsoft",
            "token_type": self.token_type,
        }
        # Sort keys + newline for deterministic on-disk content.
        return (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")

    @classmethod
    def from_json_bytes(cls, raw: bytes) -> "TokenSet":
        data = json.loads(raw.decode("utf-8"))
        scopes = data.get("scopes") or []
        if not isinstance(scopes, list):
            raise ValueError("scopes must be a list of strings on disk")
        expires_at_raw = data.get("expires_at")
        if isinstance(expires_at_raw, (int, float)):
            expires_at = float(expires_at_raw)
        else:
            expires_at = _iso_to_epoch(str(expires_at_raw))
        obtained_at_raw = data.get("obtained_at")
        if isinstance(obtained_at_raw, (int, float)):
            obtained_at = float(obtained_at_raw)
        elif obtained_at_raw:
            obtained_at = _iso_to_epoch(str(obtained_at_raw))
        else:
            obtained_at = 0.0
        return cls(
            access_token=str(data["access_token"]),
            refresh_token=str(data["refresh_token"]),
            expires_at=expires_at,
            scopes=tuple(str(s) for s in scopes),
            obtained_at=obtained_at,
            token_type=str(data.get("token_type") or "Bearer"),
        )


def _epoch_to_iso(epoch_seconds: float) -> str:
    """Format epoch seconds as ISO 8601 UTC with trailing Z."""
    from datetime import datetime, timezone

    return datetime.fromtimestamp(epoch_seconds, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z"
    )


def _iso_to_epoch(iso: str) -> float:
    """Parse ISO 8601 UTC to epoch seconds. Accepts 'Z' or '+00:00' suffix."""
    from datetime import datetime

    cleaned = iso.replace("Z", "+00:00")
    return datetime.fromisoformat(cleaned).timestamp()


class TokenStore:
    """File-backed token storage on the per-customer Fly volume.

    The path defaults to ``/opt/data/oauth/microsoft.json`` per ADR 0010.
    Writes are atomic (tempfile + rename) and the resulting file is
    forced to mode 0600. Reads return ``None`` when no token has been
    saved yet -- that is the signal customer-zero has not completed
    initial OAuth consent.
    """

    def __init__(self, path: Path = DEFAULT_TOKEN_PATH) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def load(self) -> Optional[TokenSet]:
        if not self.path.exists():
            return None
        raw = self.path.read_bytes()
        return TokenSet.from_json_bytes(raw)

    def save(self, tokens: TokenSet) -> None:
        """Atomic write: write to a sibling tempfile then rename.

        The temp file is created in the same directory as the target
        so the rename is on the same filesystem (POSIX atomic rename
        guarantee). Mode is forced to 0600 BEFORE the rename so the
        file is never world-readable, even briefly, on the volume.
        """
        directory = self.path.parent
        # NamedTemporaryFile with delete=False so we can rename it.
        fd, tmp_path_str = tempfile.mkstemp(
            prefix=self.path.name + ".",
            suffix=".tmp",
            dir=str(directory),
        )
        tmp_path = Path(tmp_path_str)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(tokens.to_json_bytes())
                f.flush()
                os.fsync(f.fileno())
            os.chmod(tmp_path, 0o600)
            os.replace(tmp_path, self.path)
        except Exception:
            # Best-effort cleanup if the rename never happened.
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise


class MSGraphOAuth:
    """Microsoft Graph OAuth client.

    Owns the Fly-volume token store, the refresh-on-expiry loop, the
    initial authorization-code exchange, and the authorize-URL builder
    used by `bin/reauth-connector.sh`.
    """

    capability = "Email"  # informational; the same OAuth backs all three capabilities
    adapter = "microsoft-graph"

    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        scopes: tuple[str, ...] = PHASE_1_SCOPES,
        token_store: Optional[TokenStore] = None,
        http: Optional[httpx.AsyncClient] = None,
    ) -> None:
        if not client_id:
            raise ValueError("client_id is required")
        if not client_secret:
            raise ValueError("client_secret is required")
        if not redirect_uri:
            raise ValueError("redirect_uri is required")
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.scopes = scopes
        self.token_store = token_store or TokenStore()
        self._http = http or httpx.AsyncClient(timeout=30.0)
        self._owned_http = http is None

    def authorize_url(self, *, state: str, login_hint: Optional[str] = None) -> str:
        """Build the Entra ID authorize URL for the initial consent flow.

        The ``state`` value MUST be the signed token produced by
        ``src/lib/oauth/state.ts`` so the portal callback can verify
        provenance. Microsoft requires the scopes to be space-separated
        in the URL; ``offline_access`` MUST be present for a refresh
        token to be issued.
        """
        from urllib.parse import urlencode

        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "response_mode": "query",
            "scope": " ".join(self.scopes),
            "state": state,
        }
        if login_hint:
            params["login_hint"] = login_hint
        return f"{AUTHORIZE_URL}?{urlencode(params, safe=' :/.')}"

    async def exchange_auth_code(self, code: str) -> TokenSet:
        """Trade an authorization code for the initial token pair."""
        resp = await self._http.post(
            TOKEN_URL,
            data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "code": code,
                "redirect_uri": self.redirect_uri,
                "grant_type": "authorization_code",
                # Re-send scopes so the resulting token's scope claim is
                # explicit even when the consent prompt elided some.
                "scope": " ".join(self.scopes),
            },
        )
        self._raise_for_status(resp, operation="exchange_auth_code")
        tokens = TokenSet.from_token_response(resp.json())
        self.token_store.save(tokens)
        return tokens

    async def refresh(self, current: TokenSet) -> TokenSet:
        """Exchange a refresh token for a fresh access token.

        On ``invalid_grant`` (refresh token revoked or expired) raises
        ``AdapterError(code="auth_expired", ...)`` so the runtime can
        drive the re-consent flow per oauth-lifecycle.md § "Re-
        authorization (re-consent) flow".
        """
        resp = await self._http.post(
            TOKEN_URL,
            data={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "refresh_token": current.refresh_token,
                "grant_type": "refresh_token",
                "scope": " ".join(self.scopes),
            },
        )
        self._raise_for_status(resp, operation="refresh")
        tokens = TokenSet.from_token_response(resp.json(), previous=current)
        self.token_store.save(tokens)
        return tokens

    async def get_valid_tokens(self) -> TokenSet:
        """Return non-expired tokens, refreshing transparently.

        Raises ``AdapterError(code="auth_expired")`` if no tokens exist
        (initial consent not completed) or if the refresh attempt is
        rejected upstream.
        """
        tokens = self.token_store.load()
        if tokens is None:
            raise AdapterError(
                code="auth_expired",
                capability=self.capability,
                adapter=self.adapter,
                message=(
                    f"No Microsoft Graph tokens stored at {self.token_store.path}; "
                    "customer must complete initial OAuth consent"
                ),
            )
        if tokens.is_expired():
            tokens = await self.refresh(tokens)
        return tokens

    def _raise_for_status(self, resp: httpx.Response, *, operation: str) -> None:
        """Translate non-2xx token-endpoint responses into AdapterError.

        Microsoft Entra returns ``invalid_grant`` for revoked, expired,
        or otherwise unusable refresh tokens -- we map that to
        ``auth_expired`` per the capability contract. Everything else
        non-2xx becomes ``upstream_error`` with the HTTP status
        preserved.
        """
        if resp.is_success:
            return
        body_text = resp.text if resp.text else "(no body)"
        error_code = ""
        try:
            body = resp.json()
            if isinstance(body, dict):
                error_code = str(body.get("error") or "")
        except (ValueError, json.JSONDecodeError):
            pass
        if error_code == "invalid_grant":
            raise AdapterError(
                code="auth_expired",
                capability=self.capability,
                adapter=self.adapter,
                message=(
                    f"Microsoft Graph refresh rejected with invalid_grant "
                    f"({operation}); re-consent required"
                ),
            )
        raise AdapterError(
            code="upstream_error",
            capability=self.capability,
            adapter=self.adapter,
            message=(
                f"Microsoft Graph token endpoint returned HTTP {resp.status_code} "
                f"({operation}): {body_text[:200]}"
            ),
        )

    async def aclose(self) -> None:
        if self._owned_http:
            await self._http.aclose()


__all__ = [
    "AUTHORIZE_URL",
    "DEFAULT_TOKEN_PATH",
    "MAIL_SEND_SCOPE",
    "MSGraphOAuth",
    "PHASE_1_SCOPES",
    "PHASE_2_SCOPES",
    "REFRESH_MARGIN_SECONDS",
    "TOKEN_URL",
    "TokenSet",
    "TokenStore",
]
