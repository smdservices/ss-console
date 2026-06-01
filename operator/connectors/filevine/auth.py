"""OAuth 2.0 auth provider -- protocol + in-memory fake.

Per the issue's "Identity & Access seam" instruction, the real Identity
& Access layer (#789, #822) is not yet built. This module defines the
auth seam:

* `FilevineAuthProvider` -- a Protocol describing what the connector
  needs from token acquisition. Production constructs an instance
  backed by the Identity & Access layer; tests construct an
  `InMemoryFilevineAuth` fake.

* `TokenSet` -- the OAuth token pair plus expiry metadata; identical
  shape to the LawPay connector for cross-adapter consistency.

The connector's `FilevineClient` accepts a `FilevineAuthProvider`. It
never reads tokens from disk, env, or a static config -- that is the
responsibility of whatever implementation backs the protocol. This is
the seam #789/#822 plug into.

Filevine OAuth notes
--------------------

Filevine uses Authorization Code grant per
https://developer.filevine.io/. The connector itself does not run the
interactive OAuth dance; the Identity & Access layer (issues #789 /
#822) handles the browser-based authorize-redirect-exchange flow and
hands the connector refresh tokens through the protocol below. The
Filevine token endpoint is at the customer's tenant base (e.g.
`https://identity.filevine.io/connect/token`) with `client_id`,
`client_secret`, and `refresh_token` grant. The connector calls only
`get_valid_token()` and the implementation handles refresh.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional, Protocol


# Safety margin: a token within this many seconds of stated expiry is
# treated as expired so the consumer refreshes before the next API call.
REFRESH_MARGIN_SECONDS = 60


@dataclass
class TokenSet:
    """OAuth token pair plus expiry metadata.

    Lives outside the protocol so the Identity & Access layer and the
    connector agree on a wire shape without one having to import the
    other.
    """

    access_token: str
    refresh_token: str
    expires_at: float  # epoch seconds when access_token expires
    token_type: str = "Bearer"

    def is_expired(self) -> bool:
        return time.time() + REFRESH_MARGIN_SECONDS >= self.expires_at

    def authorization_header(self) -> str:
        return f"{self.token_type} {self.access_token}"


class FilevineAuthProvider(Protocol):
    """Token-acquisition seam between the connector and Identity & Access.

    The connector calls `get_valid_token()` before every API request. The
    implementation is responsible for refresh-when-expired, storage,
    rotation telemetry, and any per-customer isolation guarantees. The
    connector does not see customer IDs -- per ADR 0007/0009 the
    connector is instantiated per-customer in the Hermes Machine and
    its auth provider is already scoped.
    """

    async def get_valid_token(self) -> TokenSet:
        """Return a non-expired `TokenSet`.

        Raises
        ------
        Exception
            Implementations raise whatever they like; the connector
            wraps any exception in `AdapterError('unauthorized', ...)`
            before re-raising. The protocol intentionally does not
            constrain the implementation's error type because the
            Identity & Access layer's contract is not yet locked.
        """

    def org_slug(self) -> str:
        """Filevine `org_slug` for this customer.

        Bound from `customer.yaml -> connectors.PracticeManagement.config.org_slug`.
        The Hermes Machine provisions the protocol implementation with
        the slug baked in at boot.
        """


@dataclass
class InMemoryFilevineAuth:
    """In-memory fake for tests + local dev.

    Usage
    -----
    .. code-block:: python

        auth = InMemoryFilevineAuth(
            token=TokenSet(
                access_token="fake-token",
                refresh_token="fake-refresh",
                expires_at=time.time() + 3600,
            ),
            org_slug="example-firm",
        )
        client = FilevineClient(auth=auth, http=httpx.AsyncClient(...))

    The fake never network-refreshes. Tests that want to exercise the
    "token expired" code path construct one with `expires_at` in the
    past and assert the connector raises `AdapterError('unauthorized')`.
    """

    token: TokenSet
    _org_slug: str = field(default="example-firm")
    refresh_callable: Optional[
        "object"
    ] = None  # tests may set this to a callable to simulate refresh

    def __init__(
        self,
        token: TokenSet,
        org_slug: str = "example-firm",
    ) -> None:
        self.token = token
        self._org_slug = org_slug

    async def get_valid_token(self) -> TokenSet:
        if self.token.is_expired():
            raise RuntimeError(
                "InMemoryFilevineAuth token expired and no refresh hook "
                "configured. Tests asserting expired-token handling should "
                "expect this RuntimeError."
            )
        return self.token

    def org_slug(self) -> str:
        return self._org_slug


__all__ = [
    "REFRESH_MARGIN_SECONDS",
    "FilevineAuthProvider",
    "InMemoryFilevineAuth",
    "TokenSet",
]
