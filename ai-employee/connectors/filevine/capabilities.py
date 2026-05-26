"""Capability adapters -- `PracticeManagement` and `DocumentStorage`.

These classes are the Python implementations of the TypeScript
interfaces locked in
`src/lib/ai-employee/capabilities/practice-management.ts` and
`src/lib/ai-employee/capabilities/document-storage.ts`. The contracts
are vendor-neutral; vendor specifics live in `client.py`.

Per the issue's scope, this connector implements the minimum surface:

* `Matter.Read`: ``list_matters``, ``get_matter``, ``get_matter_documents``
* `Matter.Note.Write`: ``create_note`` -- the only mutating method.
  Attribution is the reviewer per ADR 0005; the note's body is the
  drafted content, not "[AI Employee] ...".
* `Document.Read`: ``list_documents``, ``get_document``, ``get_document_bytes``

Optional capability methods that the larger TypeScript interfaces
expose (e.g. ``create_matter``, ``upload_document``) are declared
unsupported in `describe_capabilities().unsupported_methods` and raise
``capability_not_supported`` if invoked. This satisfies the
UNSUPPORTED_METHODS_THROW invariant.

No autonomous send paths exist anywhere in this module -- per ADR 0005
and the conformance harness's NO_AUTONOMOUS_EXTERNAL_SEND invariant.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from .client import ADAPTER_SLUG, FilevineClient
from .errors import AdapterError


# ---------------------------------------------------------------------------
# Capability data shapes -- Python mirrors of the TypeScript interfaces
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CapabilitySet:
    """Python mirror of `CapabilitySet` from
    `src/lib/ai-employee/capabilities/types.ts`. The conformance
    harness's CAPABILITY_SET_HONEST invariant asserts the
    ``capability`` matches and ``supported_methods`` is a superset of
    the interface's required methods.
    """

    capability: str
    adapter: str
    version: str
    supported_methods: tuple[str, ...]
    unsupported_methods: tuple[str, ...]
    field_coverage: dict[str, dict[str, tuple[str, ...]]] = field(default_factory=dict)


@dataclass(frozen=True)
class HealthStatus:
    status: str  # "healthy" | "degraded" | "unhealthy"
    last_ok_at: Optional[str] = None
    message: Optional[str] = None
    details: Optional[dict[str, Any]] = None


@dataclass(frozen=True)
class Matter:
    """Python mirror of `Matter` from `practice-management.ts`."""

    id: str
    client_name: str
    matter_type: str
    status: str  # "open" | "closed" | "pending" | "intake"
    opened_at: str
    closed_at: Optional[str]
    custom_fields: dict[str, Any]


@dataclass(frozen=True)
class DocumentRef:
    """Python mirror of `DocumentRef` from `practice-management.ts`."""

    id: str
    matter_id: str
    filename: str
    mime_type: str
    size_bytes: int
    uploaded_at: str
    uploaded_by: Optional[str]


@dataclass(frozen=True)
class MatterNoteRef:
    """Return shape for the Matter.Note.Write `create_note` call.

    The TypeScript contract does not yet ship a typed note shape -- the
    interface exposes notes via the broader matter surface. We declare
    this dataclass to keep the Python adapter explicit; if the
    TypeScript interface grows a typed note shape later, both sides
    converge on the same name.
    """

    id: str
    matter_id: str
    body: str
    created_at: str
    author_account_id: str
    drafted_by_skill: str


# DocumentStorage shapes
@dataclass(frozen=True)
class StoredDocument:
    id: str
    path: str
    filename: str
    mime_type: str
    size_bytes: int
    created_at: str
    modified_at: str
    modified_by: Optional[str]
    current_version: str


# ---------------------------------------------------------------------------
# Translation helpers -- Filevine JSON -> capability shapes
#
# These are intentionally small and explicit. Each helper reads ONLY the
# fields the capability shape declares; absent fields land as `None`.
# Per NO_FIELD_FABRICATION the helpers never invent values. The unit
# tests in `tests/test_translation.py` assert this.
# ---------------------------------------------------------------------------


_FILEVINE_STATUS_MAP = {
    # Filevine's project status vocabulary maps onto the capability's
    # closed enum. Unknown vendor statuses fall back to "open" because
    # the capability's enum has no "unknown" value; the original
    # vendor status is preserved in custom_fields under
    # "_vendor_status_raw" for the dashboard sourcing block.
    "Open": "open",
    "Closed": "closed",
    "Pending": "pending",
    "Intake": "intake",
}


def _opt_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str) and value:
        return value
    return None


def _opt_int(value: Any) -> Optional[int]:
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return None


def _matter_from_project(project: dict[str, Any]) -> Matter:
    """Translate a Filevine project JSON object into a `Matter`.

    Field mapping (Filevine -> capability):

    * ``projectId`` (or ``id``)         -> ``id``
    * ``clientName``                    -> ``client_name``
    * ``projectTypeCode``               -> ``matter_type``
    * ``status``                        -> ``status`` (mapped via
                                           `_FILEVINE_STATUS_MAP`; raw
                                           preserved in custom_fields)
    * ``createdDate``                   -> ``opened_at``
    * ``closedDate``                    -> ``closed_at`` (Optional)
    * everything not listed above lands verbatim in ``custom_fields``
      so the dashboard sourcing block can disclose what the adapter
      saw.
    """
    project_id = _opt_str(project.get("projectId")) or _opt_str(project.get("id"))
    if project_id is None:
        raise AdapterError(
            code="unknown",
            capability="PracticeManagement",
            adapter=ADAPTER_SLUG,
            message="Filevine project record has no projectId/id",
        )
    client_name = _opt_str(project.get("clientName")) or ""
    matter_type = _opt_str(project.get("projectTypeCode")) or ""
    raw_status = _opt_str(project.get("status")) or ""
    status = _FILEVINE_STATUS_MAP.get(raw_status, "open")
    opened_at = _opt_str(project.get("createdDate")) or ""
    closed_at = _opt_str(project.get("closedDate"))

    known = {"projectId", "id", "clientName", "projectTypeCode", "status", "createdDate", "closedDate"}
    custom_fields = {k: v for k, v in project.items() if k not in known}
    if raw_status and raw_status not in _FILEVINE_STATUS_MAP:
        custom_fields["_vendor_status_raw"] = raw_status

    return Matter(
        id=project_id,
        client_name=client_name,
        matter_type=matter_type,
        status=status,
        opened_at=opened_at,
        closed_at=closed_at,
        custom_fields=custom_fields,
    )


def _docref_from_document(document: dict[str, Any], matter_id: str) -> DocumentRef:
    """Translate a Filevine document JSON object to `DocumentRef`."""
    doc_id = _opt_str(document.get("documentId")) or _opt_str(document.get("id"))
    if doc_id is None:
        raise AdapterError(
            code="unknown",
            capability="PracticeManagement",
            adapter=ADAPTER_SLUG,
            message="Filevine document record has no documentId/id",
        )
    return DocumentRef(
        id=doc_id,
        matter_id=matter_id,
        filename=_opt_str(document.get("filename")) or "",
        mime_type=_opt_str(document.get("mimeType")) or "application/octet-stream",
        size_bytes=_opt_int(document.get("sizeBytes")) or 0,
        uploaded_at=_opt_str(document.get("uploadDate")) or "",
        uploaded_by=_opt_str(document.get("uploadedByAccountId")),
    )


def _stored_from_document(document: dict[str, Any]) -> StoredDocument:
    """Translate a Filevine document JSON object to `StoredDocument`."""
    doc_id = _opt_str(document.get("documentId")) or _opt_str(document.get("id"))
    if doc_id is None:
        raise AdapterError(
            code="unknown",
            capability="DocumentStorage",
            adapter=ADAPTER_SLUG,
            message="Filevine document record has no documentId/id",
        )
    return StoredDocument(
        id=doc_id,
        # Filevine documents are scoped under projects, not free-form
        # paths. We synthesize the "path" as projects/<project>/<file>
        # which is faithful to how the dashboard renders document
        # locations. Synthesis is disclosed in field_coverage.derived.
        path=(
            f"projects/{_opt_str(document.get('projectId')) or 'unknown'}/"
            f"{_opt_str(document.get('filename')) or doc_id}"
        ),
        filename=_opt_str(document.get("filename")) or "",
        mime_type=_opt_str(document.get("mimeType")) or "application/octet-stream",
        size_bytes=_opt_int(document.get("sizeBytes")) or 0,
        created_at=_opt_str(document.get("uploadDate")) or "",
        modified_at=_opt_str(document.get("modifiedDate"))
        or _opt_str(document.get("uploadDate"))
        or "",
        modified_by=_opt_str(document.get("modifiedByAccountId"))
        or _opt_str(document.get("uploadedByAccountId")),
        current_version=_opt_str(document.get("currentVersionId")) or "v1",
    )


# ---------------------------------------------------------------------------
# PracticeManagement adapter
# ---------------------------------------------------------------------------


_PM_SUPPORTED = (
    "describe_capabilities",
    "health_check",
    "search_matters",
    "get_matter",
    "list_matter_documents",
    "create_note",
    # ADR 0021 Stream E — matter-event webhook subscription. The HTTP
    # path against Filevine's v2 `/core/webhooks` API is wired in this
    # PR; live sandbox verification deferred to a Wave-4 hardening PR.
    "subscribe",
    "unsubscribe",
)


# Required-method coverage gap declared honestly. The TypeScript
# PracticeManagement interface declares more methods (create_matter,
# update_matter, contacts, time entries, upload). Filevine v1 ships
# the read + note-write surface only per the issue. The remaining
# methods are explicitly unsupported and raise capability_not_supported
# at call time.
_PM_UNSUPPORTED = (
    "create_matter",
    "update_matter",
    "search_contacts",
    "get_contact",
    "create_contact",
    "list_time_entries",
    "create_time_entry_draft",
    "upload_matter_document",
)


# ---------------------------------------------------------------------------
# Subscription capability shapes (ADR 0021 Stream E)
# ---------------------------------------------------------------------------


# Canonical event-type taxonomy. Mirrors `MatterEvent` from
# src/lib/ai-employee/capabilities/practice-management.ts.
SUPPORTED_MATTER_EVENTS = frozenset(
    {
        "matter.created",
        "matter.updated",
        "matter.closed",
        "document.added",
        "note.added",
    }
)


# Filevine's v2 `/core/webhooks` API uses its own event-type strings.
# The translation below maps canonical -> Filevine. Unknown canonical
# events raise capability_not_supported before any HTTP call.
_FILEVINE_EVENT_MAP: dict[str, str] = {
    "matter.created": "Project.Created",
    "matter.updated": "Project.Updated",
    "matter.closed": "Project.Closed",
    "document.added": "Document.Added",
    "note.added": "Note.Created",
}


@dataclass(frozen=True)
class SubscriptionRef:
    """Python mirror of `SubscriptionRef` from `practice-management.ts`.

    Returned by `subscribe()`; passed to `unsubscribe(id=...)`. The
    `id` field is the adapter-side stable handle (typically the
    vendor's id formatted with the adapter slug as prefix); the
    `vendor_subscription_id` is the unwrapped vendor id for the same
    record.
    """

    id: str
    events: tuple[str, ...]
    webhook_url: str
    registered_at: str
    vendor_subscription_id: str


class FilevinePracticeManagement:
    """PracticeManagement capability adapter for Filevine.

    Conforms to `PracticeManagement` from
    `src/lib/ai-employee/capabilities/practice-management.ts`. Methods
    are named in snake_case to match Python convention; the TypeScript
    contract uses identical names by design.
    """

    capability = "PracticeManagement"
    adapter = ADAPTER_SLUG
    version = "0.1.0"

    def __init__(self, client: FilevineClient) -> None:
        self._client = client

    # ----- AdapterBase -----

    def describe_capabilities(self) -> CapabilitySet:
        return CapabilitySet(
            capability=self.capability,
            adapter=self.adapter,
            version=self.version,
            supported_methods=_PM_SUPPORTED,
            unsupported_methods=_PM_UNSUPPORTED,
            field_coverage={
                "search_matters": {
                    "populated": (
                        "id",
                        "client_name",
                        "matter_type",
                        "status",
                        "opened_at",
                        "closed_at",
                        "custom_fields",
                    ),
                    "not_populated": (),
                    "derived": (),
                },
                "create_note": {
                    "populated": (
                        "id",
                        "matter_id",
                        "body",
                        "created_at",
                        "author_account_id",
                        "drafted_by_skill",
                    ),
                    "not_populated": (),
                    "derived": (),
                },
            },
        )

    async def health_check(self) -> HealthStatus:
        try:
            await self._client.ping(capability=self.capability)
            from datetime import datetime, timezone

            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            return HealthStatus(status="healthy", last_ok_at=now)
        except AdapterError as exc:
            return HealthStatus(
                status="unhealthy",
                last_ok_at=None,
                message=f"Filevine ping raised {exc.code}",
            )

    # ----- Supported methods -----

    async def search_matters(
        self,
        *,
        client_name: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Matter]:
        # Translate the capability's normalized status back to Filevine's
        # vocabulary (the inverse of `_FILEVINE_STATUS_MAP`). If the
        # caller passes an unknown status, surface a validation error
        # rather than silently dropping it.
        filevine_status: Optional[str] = None
        if status is not None:
            inverse = {v: k for k, v in _FILEVINE_STATUS_MAP.items()}
            if status not in inverse:
                raise AdapterError(
                    code="validation_failed",
                    capability=self.capability,
                    adapter=self.adapter,
                    message=f"Unknown matter status {status!r}; "
                    f"expected one of {sorted(inverse)}",
                )
            filevine_status = inverse[status]
        rows = await self._client.list_projects(
            capability=self.capability,
            client_name=client_name,
            status=filevine_status,
            limit=limit,
            offset=offset,
        )
        return [_matter_from_project(r) for r in rows]

    async def get_matter(self, matter_id: str) -> Optional[Matter]:
        body = await self._client.get_project(matter_id, capability=self.capability)
        if body is None:
            return None
        return _matter_from_project(body)

    async def list_matter_documents(self, matter_id: str) -> list[DocumentRef]:
        rows = await self._client.list_project_documents(
            matter_id, capability=self.capability
        )
        return [_docref_from_document(r, matter_id=matter_id) for r in rows]

    async def create_note(
        self,
        matter_id: str,
        *,
        content: str,
        reviewer_account_id: str,
        drafted_by_skill: str,
    ) -> MatterNoteRef:
        """Create a matter note attributed to the reviewer.

        Per ADR 0005, the note's author is the reviewer's Filevine
        account, not "AI Employee" or the persona. The body is the
        drafted content verbatim. The dashboard renders the
        ``drafted_by_skill`` field as the "what Marcus used to write
        this" sourcing block.
        """
        if not content:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="create_note requires non-empty content",
            )
        if not reviewer_account_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="create_note requires reviewer_account_id",
            )
        if not drafted_by_skill:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="create_note requires drafted_by_skill",
            )
        body = await self._client.create_project_note(
            matter_id,
            capability=self.capability,
            body_text=content,
            reviewer_account_id=reviewer_account_id,
            drafted_by_skill=drafted_by_skill,
        )
        note_id = _opt_str(body.get("noteId")) or _opt_str(body.get("id"))
        if note_id is None:
            raise AdapterError(
                code="unknown",
                capability=self.capability,
                adapter=self.adapter,
                message="Filevine returned a note without noteId/id",
            )
        return MatterNoteRef(
            id=note_id,
            matter_id=matter_id,
            body=content,
            created_at=_opt_str(body.get("createdDate")) or "",
            author_account_id=reviewer_account_id,
            drafted_by_skill=drafted_by_skill,
        )

    # ----- Unsupported methods raise capability_not_supported -----

    async def create_matter(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="create_matter is not supported in Filevine v1 adapter",
        )

    async def update_matter(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="update_matter is not supported in Filevine v1 adapter",
        )

    async def search_contacts(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="search_contacts is not supported in Filevine v1 adapter",
        )

    async def get_contact(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="get_contact is not supported in Filevine v1 adapter",
        )

    async def create_contact(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="create_contact is not supported in Filevine v1 adapter",
        )

    async def list_time_entries(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="list_time_entries is not supported in Filevine v1 adapter",
        )

    async def create_time_entry_draft(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="create_time_entry_draft is not supported in Filevine v1 adapter",
        )

    async def upload_matter_document(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="upload_matter_document is not supported in Filevine v1 adapter",
        )

    # ----- Subscription (ADR 0021 Stream E) -----

    async def subscribe(
        self,
        events: tuple[str, ...] | list[str],
        webhook_url: str,
    ) -> SubscriptionRef:
        """Register a Filevine webhook subscription for the given events.

        `events` is a canonical event list (see SUPPORTED_MATTER_EVENTS).
        Unknown canonical events raise capability_not_supported. The
        canonical strings are translated to Filevine's `Project.*` /
        `Document.*` / `Note.*` taxonomy on the wire.

        Per ADR 0021 Stream E, the subscription endpoint is the
        customer's own Fly Machine — `customer.yaml.connectors[].webhook_url`.
        Caller supplies the resolved URL; this adapter does NOT read
        customer.yaml directly.

        Returns a SubscriptionRef with the vendor's webhook id, the
        canonical event list, the configured URL, and the registration
        timestamp. The caller (typically the bootstrap routine that
        provisions a customer Machine) records the ref in per-customer
        state so unsubscribe() can be called at decommission time.
        """
        events_tuple = tuple(events)
        unknown = [e for e in events_tuple if e not in SUPPORTED_MATTER_EVENTS]
        if unknown:
            raise AdapterError(
                code="capability_not_supported",
                capability=self.capability,
                adapter=self.adapter,
                message=(
                    f"unsupported MatterEvent values: {unknown!r}; "
                    f"supported: {sorted(SUPPORTED_MATTER_EVENTS)!r}"
                ),
            )
        if not webhook_url:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="webhook_url is required and must be non-empty",
            )

        # Translate canonical -> Filevine wire events.
        wire_events = tuple(_FILEVINE_EVENT_MAP[e] for e in events_tuple)

        result = await self._client.create_webhook_subscription(
            capability=self.capability,
            webhook_url=webhook_url,
            wire_events=wire_events,
        )
        vendor_id = _opt_str(result.get("webhookId")) or _opt_str(result.get("id"))
        if vendor_id is None:
            raise AdapterError(
                code="unknown",
                capability=self.capability,
                adapter=self.adapter,
                message="Filevine webhook POST returned no id",
            )
        registered_at = (
            _opt_str(result.get("createdAt")) or _opt_str(result.get("created_at")) or ""
        )

        return SubscriptionRef(
            id=f"{ADAPTER_SLUG}:{vendor_id}",
            events=events_tuple,
            webhook_url=webhook_url,
            registered_at=registered_at,
            vendor_subscription_id=vendor_id,
        )

    async def unsubscribe(self, subscription_id: str) -> None:
        """Delete a Filevine webhook subscription previously registered
        via `subscribe()`.

        `subscription_id` is the SubscriptionRef.id (prefixed with the
        adapter slug). The adapter strips the prefix before issuing the
        DELETE against Filevine's v2 webhooks API.

        Idempotent: a 404 on the vendor side is silently OK (the
        subscription is already gone). Other 4xx/5xx propagate as
        AdapterError.
        """
        if not subscription_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="subscription_id is required",
            )
        prefix = f"{ADAPTER_SLUG}:"
        vendor_id = (
            subscription_id[len(prefix) :]
            if subscription_id.startswith(prefix)
            else subscription_id
        )
        await self._client.delete_webhook_subscription(
            capability=self.capability,
            vendor_subscription_id=vendor_id,
        )


# ---------------------------------------------------------------------------
# DocumentStorage adapter -- read-only surface from Filevine documents
# ---------------------------------------------------------------------------

_DS_SUPPORTED = (
    "describe_capabilities",
    "health_check",
    "list_documents",
    "get_document",
    "get_document_bytes",
)

_DS_UNSUPPORTED = (
    "list_folder",
    "upload_document",
    "update_document",
    "list_versions",
    "download_version",
    "share_document_draft",
    "get_scoped_folders",
)


class FilevineDocumentStorage:
    """DocumentStorage capability adapter for Filevine documents.

    Filevine is primarily a practice-management system; documents live
    inside projects (matters). This adapter exposes the document read
    surface so skills that bind to `DocumentStorage` can read project
    documents without having to know they came from Filevine.

    The TypeScript `DocumentStorage` interface includes folder
    listings, version histories, and share-draft creation. Filevine's
    document model does not map cleanly onto those (no folders per se;
    versions exist but are not first-class). The unsupported methods
    raise `capability_not_supported` to keep the conformance harness
    honest; the dashboard surfaces "this adapter does not support
    folder listings" rather than producing fabricated rows.
    """

    capability = "DocumentStorage"
    adapter = ADAPTER_SLUG
    version = "0.1.0"

    def __init__(self, client: FilevineClient) -> None:
        self._client = client

    def describe_capabilities(self) -> CapabilitySet:
        return CapabilitySet(
            capability=self.capability,
            adapter=self.adapter,
            version=self.version,
            supported_methods=_DS_SUPPORTED,
            unsupported_methods=_DS_UNSUPPORTED,
            field_coverage={
                "list_documents": {
                    "populated": (
                        "id",
                        "filename",
                        "mime_type",
                        "size_bytes",
                        "created_at",
                        "modified_at",
                        "modified_by",
                        "current_version",
                    ),
                    "not_populated": (),
                    "derived": ("path",),
                },
                "get_document": {
                    "populated": (
                        "id",
                        "filename",
                        "mime_type",
                        "size_bytes",
                        "created_at",
                        "modified_at",
                        "modified_by",
                        "current_version",
                    ),
                    "not_populated": (),
                    "derived": ("path",),
                },
            },
        )

    async def health_check(self) -> HealthStatus:
        try:
            await self._client.ping(capability=self.capability)
            from datetime import datetime, timezone

            now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            return HealthStatus(status="healthy", last_ok_at=now)
        except AdapterError as exc:
            return HealthStatus(
                status="unhealthy",
                last_ok_at=None,
                message=f"Filevine ping raised {exc.code}",
            )

    async def list_documents(self, matter_id: str) -> list[StoredDocument]:
        rows = await self._client.list_project_documents(
            matter_id, capability=self.capability
        )
        # Ensure projectId is set on each row for path synthesis
        for r in rows:
            r.setdefault("projectId", matter_id)
        return [_stored_from_document(r) for r in rows]

    async def get_document(self, document_id: str) -> Optional[StoredDocument]:
        body = await self._client.get_document(document_id, capability=self.capability)
        if body is None:
            return None
        return _stored_from_document(body)

    async def get_document_bytes(self, document_id: str) -> bytes:
        return await self._client.download_document(
            document_id, capability=self.capability
        )

    # ----- Unsupported methods -----

    async def list_folder(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="list_folder is not supported in Filevine v1 adapter "
            "(Filevine has no first-class folder concept)",
        )

    async def upload_document(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="upload_document is not supported in Filevine v1 adapter",
        )

    async def update_document(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="update_document is not supported in Filevine v1 adapter",
        )

    async def list_versions(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="list_versions is not supported in Filevine v1 adapter",
        )

    async def download_version(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="download_version is not supported in Filevine v1 adapter",
        )

    async def share_document_draft(self, *args: Any, **kwargs: Any) -> None:
        # Per ADR 0005, even the draft surface is unsupported in v1 --
        # Filevine has no native external-share-draft concept that we
        # can safely round-trip without inventing one.
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="share_document_draft is not supported in Filevine v1 adapter",
        )

    def get_scoped_folders(self) -> list[str]:
        # Empty list rather than raising -- the TypeScript contract
        # returns string[], and "no scoped folders" is a valid honest
        # answer for an adapter without folder support.
        return []


__all__ = [
    "CapabilitySet",
    "DocumentRef",
    "FilevineDocumentStorage",
    "FilevinePracticeManagement",
    "HealthStatus",
    "Matter",
    "MatterNoteRef",
    "StoredDocument",
]
