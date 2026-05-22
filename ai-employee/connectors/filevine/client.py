"""Filevine REST API client -- thin async HTTP wrapper.

Endpoints used (Filevine API v2; https://developer.filevine.io/):

* ``GET  /core/projects?orgUid=<org>&...``         -- list matters
* ``GET  /core/projects/{projectId}``              -- get matter
* ``GET  /core/projects/{projectId}/documents``    -- list matter documents
* ``GET  /core/documents/{documentId}``            -- get document metadata
* ``GET  /core/documents/{documentId}/download``   -- download document bytes
* ``POST /core/projects/{projectId}/notes``        -- create matter note (draft body, reviewer attribution)

Filevine project = matter, in capability vocabulary.

The client never invents fields. Every method maps Filevine's response
verbatim into the capability shape. Missing fields are returned as
``None`` so the conformance harness's NO_FIELD_FABRICATION invariant
holds.

This module deliberately does not import the capability adapters
themselves -- `capabilities.py` imports this client. Keeping the HTTP
layer separable from the capability adapters lets tests exercise either
in isolation.
"""

from __future__ import annotations

from typing import Any, Optional

try:  # pragma: no cover -- httpx is required in production but not in unit tests
    import httpx
except ImportError:  # pragma: no cover
    httpx = None  # type: ignore[assignment]

from .auth import FilevineAuthProvider
from .errors import AdapterError


# Filevine REST API base URL (production). Filevine does not document a
# distinct sandbox host -- tenants are sandbox-or-prod via org config. The
# smoke-test script in `bin/smoke-test-filevine.py` accepts a base URL
# override so a test tenant can be exercised.
PROD_API_BASE = "https://api.filevine.io"

# Capability constant -- the client is used by both PracticeManagement
# and DocumentStorage adapters, so the wrap-vendor-error helper accepts
# the capability at call time rather than baking it in.
ADAPTER_SLUG = "filevine"


class FilevineClient:
    """Async HTTP client over the Filevine REST API.

    One instance per customer per Hermes Machine. The client holds:

    * an `httpx.AsyncClient` for connection pooling,
    * a `FilevineAuthProvider` for token acquisition.

    All public methods return raw Filevine JSON (a `dict[str, Any]` or
    `list[...]`). The capability adapters in `capabilities.py` translate
    those into capability shapes.
    """

    def __init__(
        self,
        *,
        auth: FilevineAuthProvider,
        http: Any = None,
        base_url: str = PROD_API_BASE,
    ) -> None:
        if http is None:
            if httpx is None:  # pragma: no cover
                raise RuntimeError(
                    "FilevineClient requires httpx; install ai-employee[connector] extras"
                )
            http = httpx.AsyncClient(base_url=base_url, timeout=30.0)
        self._auth = auth
        self._http = http
        self._base_url = base_url

    @property
    def org_slug(self) -> str:
        return self._auth.org_slug()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        capability: str,
        params: Optional[dict[str, Any]] = None,
        json_body: Optional[dict[str, Any]] = None,
        as_bytes: bool = False,
    ) -> Any:
        """Issue an authorized request and translate transport errors.

        Translates HTTP status codes into the capability layer's typed
        `AdapterError` codes per the contract:

        * 401 -> ``unauthorized``
        * 403 -> ``scope_violation`` (Filevine's "access denied")
        * 404 -> caller decides (the client returns ``None``)
        * 422 -> ``validation_failed``
        * 429 -> ``rate_limited``
        * 5xx -> ``transient``
        * network exception -> ``transient``

        The 404 case is special: the conformance contract says
        `get_*` methods return ``None`` for absent records, so the
        client surfaces 404 by returning ``None`` rather than raising.
        Callers that distinguish semantic-distinct absence (parent
        deleted, etc.) translate that on their side.
        """
        try:
            token = await self._auth.get_valid_token()
        except Exception as exc:  # noqa: BLE001 -- wrap any auth failure
            raise AdapterError(
                code="unauthorized",
                capability=capability,
                adapter=ADAPTER_SLUG,
                message="Filevine auth provider could not return a valid token",
                cause=exc,
            ) from exc

        headers = {
            "Authorization": token.authorization_header(),
            "Accept": "application/octet-stream" if as_bytes else "application/json",
        }
        if json_body is not None:
            headers["Content-Type"] = "application/json"

        try:
            resp = await self._http.request(
                method,
                path,
                params=params,
                json=json_body,
                headers=headers,
            )
        except Exception as exc:  # noqa: BLE001 -- wrap network errors
            raise AdapterError(
                code="transient",
                capability=capability,
                adapter=ADAPTER_SLUG,
                message=f"Filevine HTTP {method} {path} raised a transport error",
                cause=exc,
            ) from exc

        status = resp.status_code
        if status == 200 or status == 201:
            if as_bytes:
                # httpx exposes raw bytes via .content
                return resp.content
            try:
                return resp.json()
            except Exception as exc:  # noqa: BLE001 -- bad JSON from vendor
                raise AdapterError(
                    code="unknown",
                    capability=capability,
                    adapter=ADAPTER_SLUG,
                    message=f"Filevine returned non-JSON body for {method} {path}",
                    cause=exc,
                ) from exc
        if status == 204:
            return None
        if status == 401:
            raise AdapterError(
                code="unauthorized",
                capability=capability,
                adapter=ADAPTER_SLUG,
                message=f"Filevine returned 401 for {method} {path}",
            )
        if status == 403:
            raise AdapterError(
                code="scope_violation",
                capability=capability,
                adapter=ADAPTER_SLUG,
                message=f"Filevine returned 403 for {method} {path}",
            )
        if status == 404:
            # Caller decides -- most read methods translate to None.
            return None
        if status == 422:
            raise AdapterError(
                code="validation_failed",
                capability=capability,
                adapter=ADAPTER_SLUG,
                message=f"Filevine rejected {method} {path}: 422 validation_failed",
            )
        if status == 429:
            raise AdapterError(
                code="rate_limited",
                capability=capability,
                adapter=ADAPTER_SLUG,
                message=f"Filevine rate-limited {method} {path}",
            )
        if 500 <= status < 600:
            raise AdapterError(
                code="transient",
                capability=capability,
                adapter=ADAPTER_SLUG,
                message=f"Filevine returned {status} for {method} {path}",
            )
        raise AdapterError(
            code="unknown",
            capability=capability,
            adapter=ADAPTER_SLUG,
            message=f"Filevine returned unexpected status {status} for {method} {path}",
        )

    # ---------- Matter.Read ----------

    async def list_projects(
        self,
        *,
        capability: str,
        client_name: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "orgUid": self.org_slug,
            "limit": min(limit, 200),
            "offset": offset,
        }
        if client_name:
            params["clientName"] = client_name
        if status:
            params["status"] = status
        body = await self._request(
            "GET",
            "/core/projects",
            capability=capability,
            params=params,
        )
        if body is None:
            return []
        items = body.get("items") if isinstance(body, dict) else body
        return list(items) if isinstance(items, list) else []

    async def get_project(
        self, project_id: str, *, capability: str
    ) -> Optional[dict[str, Any]]:
        return await self._request(
            "GET",
            f"/core/projects/{project_id}",
            capability=capability,
        )

    async def list_project_documents(
        self, project_id: str, *, capability: str
    ) -> list[dict[str, Any]]:
        body = await self._request(
            "GET",
            f"/core/projects/{project_id}/documents",
            capability=capability,
        )
        if body is None:
            return []
        items = body.get("items") if isinstance(body, dict) else body
        return list(items) if isinstance(items, list) else []

    # ---------- Matter.Note.Write (draft-as-note attributed to reviewer) ----------

    async def create_project_note(
        self,
        project_id: str,
        *,
        capability: str,
        body_text: str,
        reviewer_account_id: str,
        drafted_by_skill: str,
    ) -> dict[str, Any]:
        """Create a matter note.

        Attribution per ADR 0005: the note's `authorAccountId` is the
        reviewer's Filevine account, not the AI Employee. The
        `metadata` carries `drafted_by_skill` for the audit trail. The
        body is plain text; Filevine renders linkified text on read.
        """
        payload = {
            "body": body_text,
            "authorAccountId": reviewer_account_id,
            "metadata": {
                "drafted_by_skill": drafted_by_skill,
                "draft": True,
            },
        }
        result = await self._request(
            "POST",
            f"/core/projects/{project_id}/notes",
            capability=capability,
            json_body=payload,
        )
        if result is None:
            raise AdapterError(
                code="unknown",
                capability=capability,
                adapter=ADAPTER_SLUG,
                message=f"Filevine returned empty body for note POST on project {project_id}",
            )
        return result

    # ---------- Document.Read ----------

    async def get_document(
        self, document_id: str, *, capability: str
    ) -> Optional[dict[str, Any]]:
        return await self._request(
            "GET",
            f"/core/documents/{document_id}",
            capability=capability,
        )

    async def download_document(
        self, document_id: str, *, capability: str
    ) -> bytes:
        result = await self._request(
            "GET",
            f"/core/documents/{document_id}/download",
            capability=capability,
            as_bytes=True,
        )
        if result is None:
            raise AdapterError(
                code="not_found",
                capability=capability,
                adapter=ADAPTER_SLUG,
                message=f"Filevine has no bytes for document {document_id}",
            )
        if not isinstance(result, (bytes, bytearray)):
            raise AdapterError(
                code="unknown",
                capability=capability,
                adapter=ADAPTER_SLUG,
                message=f"Filevine returned non-bytes payload for document {document_id}",
            )
        return bytes(result)

    # ---------- Health check ----------

    async def ping(self, *, capability: str) -> bool:
        """Lightweight health probe.

        Filevine has no dedicated health endpoint; the cheapest probe
        is a 0-limit list call which exercises auth + transport without
        materializing data. Returns True on 200, raises on 401/transient.
        """
        await self._request(
            "GET",
            "/core/projects",
            capability=capability,
            params={"orgUid": self.org_slug, "limit": 0},
        )
        return True

    async def aclose(self) -> None:
        close = getattr(self._http, "aclose", None)
        if close is not None:
            await close()


__all__ = [
    "ADAPTER_SLUG",
    "PROD_API_BASE",
    "FilevineClient",
]
