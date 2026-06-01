"""Test helpers shared across the Filevine connector test suite.

Helpers live in this module rather than `conftest.py` so they can be
imported by name from each test file. (Pytest's `conftest.py` is
auto-discovered for fixtures, but plain functions imported from it
require the `tests` package to be import-resolvable from the rootdir,
which is brittle when the suite is invoked from different working
directories.)

Provides:

* `FakeHttpClient` -- minimal `httpx.AsyncClient` stand-in (records
  calls, replays canned responses).
* `FakeResponse` -- minimal `httpx.Response` stand-in.
* `RecordedCall` -- what `FakeHttpClient` captures per request.
* `make_client` -- convenience constructor wiring a `FilevineClient`
  with `InMemoryFilevineAuth` + `FakeHttpClient`.
"""

from __future__ import annotations

import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

_HERE = Path(__file__).resolve()
# Make `operator/` importable so `from connectors.filevine import ...` works.
sys.path.insert(0, str(_HERE.parents[3]))

from connectors.filevine import (  # noqa: E402
    FilevineClient,
    InMemoryFilevineAuth,
    TokenSet,
)


@dataclass
class FakeResponse:
    status_code: int
    json_body: Optional[Any] = None
    content: bytes = b""

    def json(self) -> Any:
        if self.json_body is None:
            raise ValueError("FakeResponse has no json_body")
        return self.json_body


@dataclass
class RecordedCall:
    method: str
    path: str
    params: Optional[dict[str, Any]]
    json: Optional[dict[str, Any]]
    headers: dict[str, str]


@dataclass
class FakeHttpClient:
    """Minimal `httpx.AsyncClient` stand-in.

    The connector calls only `request(method, path, params=, json=, headers=)`.
    """

    responses: dict[tuple[str, str], FakeResponse] = field(default_factory=dict)
    default_response: Optional[FakeResponse] = None
    calls: list[RecordedCall] = field(default_factory=list)
    raise_on_request: Optional[Exception] = None

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict[str, Any]] = None,
        json: Optional[dict[str, Any]] = None,
        headers: Optional[dict[str, str]] = None,
    ) -> FakeResponse:
        self.calls.append(
            RecordedCall(
                method=method,
                path=path,
                params=dict(params) if params else None,
                json=dict(json) if json else None,
                headers=dict(headers) if headers else {},
            )
        )
        if self.raise_on_request is not None:
            raise self.raise_on_request
        key = (method.upper(), path)
        resp = self.responses.get(key)
        if resp is None:
            if self.default_response is None:
                raise AssertionError(
                    f"FakeHttpClient has no canned response for {method} {path} "
                    f"(known: {sorted(self.responses)})"
                )
            return self.default_response
        return resp

    async def aclose(self) -> None:
        pass


def make_client(
    *,
    responses: Optional[dict[tuple[str, str], FakeResponse]] = None,
    org_slug: str = "example-firm",
    token: Optional[TokenSet] = None,
    raise_on_request: Optional[Exception] = None,
) -> tuple[FilevineClient, FakeHttpClient, InMemoryFilevineAuth]:
    """Construct a `FilevineClient` with a fake HTTP + in-memory auth."""
    fake_http = FakeHttpClient(
        responses=responses or {}, raise_on_request=raise_on_request
    )
    auth = InMemoryFilevineAuth(
        token=token
        or TokenSet(
            access_token="test-access",
            refresh_token="test-refresh",
            expires_at=time.time() + 3600,
        ),
        org_slug=org_slug,
    )
    client = FilevineClient(auth=auth, http=fake_http)
    return client, fake_http, auth


__all__ = ["FakeHttpClient", "FakeResponse", "RecordedCall", "make_client"]
