"""``DocumentStorage`` capability adapter -- Microsoft Graph OneDrive surface.

Implements the DocumentStorage interface from
`docs/specs/ai-employee/capability-contracts.md`. Phase 1 scope is
``Files.Read`` + ``Files.ReadWrite.AppFolder``: the agent reads from
the entire drive but writes ONLY into its own AppFolder subtree.
This is intentional containment -- `Files.ReadWrite` (drive-wide
write) is out of Phase 1 because it expands the blast radius far
beyond what Pattern A discipline requires for a v1 demo.

Graph endpoints used (delegated, Phase 1 scopes only):

* ``GET /me/drive/root:/{path}:/children`` -- list folder contents
* ``GET /me/drive/items/{id}`` -- item metadata
* ``GET /me/drive/items/{id}/content`` -- raw bytes
* ``PUT /me/drive/special/approot:/{path}:/content`` -- upload into the
  app folder (Files.ReadWrite.AppFolder scope)

Delete, copy across folders, and version listing are declared
unsupported in v1 -- they require either ``Files.ReadWrite`` (out of
Phase 1) or a thicker consent model than Pattern A provides.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from ._client import GraphClient
from ._types import (
    AdapterError,
    CapabilitySet,
    DocumentContent,
    DocumentRef,
    HealthStatus,
)


_SUPPORTED: tuple[str, ...] = (
    "describe_capabilities",
    "health_check",
    "list_folder",
    "get_document",
    "put_document",
)

# Methods declared by DocumentStorage interface but not shipped in v1.
_UNSUPPORTED: tuple[str, ...] = (
    "copy_document",
    "delete_document",
    "list_versions",
)


class MSGraphDrive:
    """``DocumentStorage`` capability adapter for OneDrive."""

    capability = "DocumentStorage"
    adapter = "microsoft-graph"
    version = "0.1.0"

    def __init__(self, client: GraphClient) -> None:
        self._client = client

    def describe_capabilities(self) -> CapabilitySet:
        return CapabilitySet(
            capability=self.capability,
            adapter=self.adapter,
            version=self.version,
            supported_methods=_SUPPORTED,
            unsupported_methods=_UNSUPPORTED,
            features=("app-folder-write", "drive-read"),
        )

    async def health_check(self) -> HealthStatus:
        try:
            await self._client.request(
                "GET",
                "/me/drive",
                capability=self.capability,
            )
            return HealthStatus(healthy=True, last_ok_at=_now_iso())
        except AdapterError as exc:
            return HealthStatus(
                healthy=False,
                last_ok_at="",
                last_error={
                    "kind": exc.code,
                    "capability": self.capability,
                    "adapter": self.adapter,
                },
            )

    async def list_folder(self, path: str) -> list[DocumentRef]:
        """List immediate children of the folder at ``path``.

        ``path`` is a OneDrive-relative path like ``/Documents`` or
        ``/Documents/2026/Q1``. Use the empty string or ``/`` to list
        the drive root.
        """
        normalized = _normalize_path(path)
        graph_path = (
            "/me/drive/root/children"
            if normalized in ("", "/")
            else f"/me/drive/root:/{normalized.lstrip('/')}:/children"
        )
        resp = await self._client.request(
            "GET",
            graph_path,
            capability=self.capability,
        )
        payload = resp.json()
        rows = payload.get("value") if isinstance(payload, dict) else []
        if not isinstance(rows, list):
            return []
        return [_docref_from_drive_item(r, parent_path=normalized) for r in rows if isinstance(r, dict)]

    async def get_document(self, id_: str) -> DocumentContent:
        """Return the document metadata + raw bytes."""
        if not id_:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="get_document requires id",
            )
        meta_resp = await self._client.request(
            "GET",
            f"/me/drive/items/{id_}",
            capability=self.capability,
        )
        meta = meta_resp.json()
        ref = _docref_from_drive_item(meta, parent_path=_parent_path_from_item(meta))
        content_resp = await self._client.request(
            "GET",
            f"/me/drive/items/{id_}/content",
            accept="*/*",
            capability=self.capability,
        )
        return DocumentContent(ref=ref, bytes_=content_resp.content)

    async def put_document(
        self,
        path: str,
        *,
        content: bytes,
        mime_type: str,
    ) -> DocumentRef:
        """Upload bytes into the agent's AppFolder.

        Phase 1 uses ``Files.ReadWrite.AppFolder``; the write path is
        confined to ``/Apps/SMD Services AI Employee/...`` (the
        AppFolder Microsoft provisions on the customer's drive). The
        ``path`` argument is interpreted as a path RELATIVE to the
        AppFolder root, not the drive root, to make this containment
        explicit.
        """
        if not path:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="put_document requires path",
            )
        if not content:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="put_document requires non-empty content",
            )
        if not mime_type:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="put_document requires mime_type",
            )
        normalized = _normalize_path(path).lstrip("/")
        if not normalized:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="put_document path cannot resolve to AppFolder root",
            )
        graph_path = f"/me/drive/special/approot:/{normalized}:/content"
        resp = await self._client.request(
            "PUT",
            graph_path,
            content=content,
            content_type=mime_type,
            capability=self.capability,
        )
        return _docref_from_drive_item(resp.json(), parent_path=_parent_path_from_path(normalized))


# ---------------------------------------------------------------------------
# Translation helpers
# ---------------------------------------------------------------------------


def _docref_from_drive_item(raw: dict[str, Any], *, parent_path: str) -> DocumentRef:
    item_id = str(raw.get("id") or "")
    filename = str(raw.get("name") or "")
    size_bytes = raw.get("size")
    file = raw.get("file") if isinstance(raw, dict) else None
    mime_type = "inode/directory"
    if isinstance(file, dict):
        mime_type = str(file.get("mimeType") or "application/octet-stream")
    created_at = str(raw.get("createdDateTime") or "")
    modified_at = str(raw.get("lastModifiedDateTime") or "")
    # Prefer Graph's parentReference.path when present (more accurate than the
    # caller-supplied parent_path for queries that traversed elsewhere).
    parent_ref = raw.get("parentReference")
    full_path = ""
    if isinstance(parent_ref, dict):
        graph_path = parent_ref.get("path")
        if isinstance(graph_path, str) and graph_path:
            # Graph paths look like "/drive/root:/Documents/2026"; strip the prefix.
            head, sep, tail = graph_path.partition(":")
            full_path = f"{tail}/{filename}" if sep else f"{head}/{filename}"
    if not full_path:
        joined = parent_path.rstrip("/")
        full_path = f"{joined}/{filename}" if joined else f"/{filename}"
    return DocumentRef(
        id=item_id,
        path=full_path,
        filename=filename,
        mime_type=mime_type,
        size_bytes=int(size_bytes) if isinstance(size_bytes, int) else 0,
        created_at=created_at,
        modified_at=modified_at,
    )


def _normalize_path(path: str) -> str:
    if not path:
        return ""
    # Strip the protocol scheme if the caller passed a storage_uri.
    if path.startswith("msgraph://"):
        path = path[len("msgraph://") :]
    # Collapse duplicate slashes; preserve leading slash semantics.
    parts = [p for p in path.split("/") if p]
    leading = "/" if path.startswith("/") else ""
    return leading + "/".join(parts)


def _parent_path_from_item(item: dict[str, Any]) -> str:
    parent_ref = item.get("parentReference") if isinstance(item, dict) else None
    if not isinstance(parent_ref, dict):
        return ""
    raw_path = parent_ref.get("path")
    if not isinstance(raw_path, str):
        return ""
    _, sep, tail = raw_path.partition(":")
    return tail if sep else raw_path


def _parent_path_from_path(path: str) -> str:
    parts = path.rstrip("/").split("/")
    if len(parts) <= 1:
        return "/"
    return "/" + "/".join(parts[:-1])


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


__all__ = [
    "MSGraphDrive",
]
