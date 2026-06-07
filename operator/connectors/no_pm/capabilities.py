"""Capability adapter -- ``PracticeManagement`` for customers with no
external PM system.

Conforms to the ``PracticeManagement`` interface locked in
``src/lib/operator/capabilities/practice-management.ts``. Storage is
the per-customer ``MatterStore`` (D1 + R2 in production, in-memory in
tests).

The adapter supports the read + create/update matter surface plus
matter-scoped note + document listings. Methods that no synthetic
store can faithfully serve (contacts, time entries, document uploads
into a PM system that does not exist) are declared in
``unsupported_methods`` and raise ``capability_not_supported`` at call
time -- per the UNSUPPORTED_METHODS_THROW conformance invariant. There
are no silent stubs and no autonomous send paths anywhere in this
module.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from .errors import AdapterError
from .store import (
    InMemoryMatterStore,
    MatterStore,
    StoredMatter,
    StoredMatterDocument,
    StoredMatterNote,
)


ADAPTER_SLUG = "no_pm"

_VALID_MATTER_STATUSES = frozenset({"open", "closed", "pending", "intake"})


# ---------------------------------------------------------------------------
# Capability data shapes -- Python mirrors of the TypeScript interfaces
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CapabilitySet:
    """Python mirror of ``CapabilitySet`` from
    ``src/lib/operator/capabilities/types.ts``."""

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
    """Python mirror of ``Matter`` from ``practice-management.ts``."""

    id: str
    client_name: str
    matter_type: str
    status: str  # "open" | "closed" | "pending" | "intake"
    opened_at: str
    closed_at: Optional[str]
    custom_fields: dict[str, Any]


@dataclass(frozen=True)
class DocumentRef:
    """Python mirror of ``DocumentRef`` from ``practice-management.ts``."""

    id: str
    matter_id: str
    filename: str
    mime_type: str
    size_bytes: int
    uploaded_at: str
    uploaded_by: Optional[str]


@dataclass(frozen=True)
class NoPmMatterNoteRef:
    """Return shape for ``create_note``.

    The TypeScript interface does not yet declare a typed note shape;
    the Filevine adapter uses the same workaround. If the TypeScript
    interface grows a typed note shape later, both adapters converge.
    """

    id: str
    matter_id: str
    body: str
    created_at: str
    author_account_id: str
    drafted_by_skill: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _iso_utc() -> str:
    dt = datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def _gen_matter_id() -> str:
    return f"mat_{secrets.token_hex(8)}"


def _gen_note_id() -> str:
    return f"note_{secrets.token_hex(8)}"


def _matter_from_stored(stored: StoredMatter) -> Matter:
    """1:1 translate from store shape to capability shape.

    The store shape mirrors the capability shape, so this is a copy
    rather than a translation. Listed explicitly because the
    NO_FIELD_FABRICATION invariant says adapters declare what they
    populate; the test suite asserts no fields are invented here.
    """
    return Matter(
        id=stored.id,
        client_name=stored.client_name,
        matter_type=stored.matter_type,
        status=stored.status,
        opened_at=stored.opened_at,
        closed_at=stored.closed_at,
        custom_fields=dict(stored.custom_fields),
    )


def _docref_from_stored(stored: StoredMatterDocument) -> DocumentRef:
    return DocumentRef(
        id=stored.id,
        matter_id=stored.matter_id,
        filename=stored.filename,
        mime_type=stored.mime_type,
        size_bytes=stored.size_bytes,
        uploaded_at=stored.uploaded_at,
        uploaded_by=stored.uploaded_by,
    )


# ---------------------------------------------------------------------------
# PracticeManagement adapter
# ---------------------------------------------------------------------------


_PM_SUPPORTED = (
    "describe_capabilities",
    "health_check",
    "search_matters",
    "get_matter",
    "create_matter",
    "update_matter",
    "list_matter_documents",
    "create_note",
)


# Methods the synthetic store cannot honestly serve. Contacts and time
# entries are first-class records in an external PM vendor; here, the
# customer keeps them in Outlook contacts and a billing system (e.g.
# QuickBooks). Surfacing a fake contacts list from the no_pm adapter
# would invite drift; skills that need contacts should bind to the
# ``IntakeCRM`` capability instead.
_PM_UNSUPPORTED = (
    "search_contacts",
    "get_contact",
    "create_contact",
    "list_time_entries",
    "create_time_entry_draft",
    "upload_matter_document",
)


class NoPmPracticeManagement:
    """PracticeManagement capability adapter for customers without a PM
    system.

    Conforms to ``PracticeManagement`` from
    ``src/lib/operator/capabilities/practice-management.ts``. Storage
    is injected via ``MatterStore``; defaults to ``InMemoryMatterStore``
    so local-dev and the conformance tests work without wiring a real
    D1 + R2 binding.
    """

    capability = "PracticeManagement"
    adapter = ADAPTER_SLUG
    version = "0.1.0"

    def __init__(self, store: Optional[MatterStore] = None) -> None:
        self._store: MatterStore = store if store is not None else InMemoryMatterStore()

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
                "create_matter": {
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
                    # ``id`` is generated by the adapter when the caller does
                    # not supply one; ``opened_at`` is the create timestamp.
                    # Both are disclosed so the dashboard sourcing block can
                    # show "synthesized by no_pm adapter".
                    "derived": ("id", "opened_at"),
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
                    "derived": ("id", "created_at"),
                },
            },
        )

    async def health_check(self) -> HealthStatus:
        # The synthetic store is always reachable -- it lives in the
        # same Machine. Issue a no-arg list to confirm the store is
        # responsive; convert any failure into the unhealthy state.
        try:
            await self._store.list_matters(limit=1)
            return HealthStatus(status="healthy", last_ok_at=_iso_utc())
        except Exception as exc:  # pragma: no cover -- defensive
            return HealthStatus(
                status="unhealthy",
                last_ok_at=None,
                message=f"no_pm store ping raised {type(exc).__name__}",
            )

    # ----- Supported methods -----

    async def search_matters(
        self,
        *,
        client_name: Optional[str] = None,
        matter_type: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Matter]:
        if status is not None and status not in _VALID_MATTER_STATUSES:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message=(
                    f"Unknown matter status {status!r}; "
                    f"expected one of {sorted(_VALID_MATTER_STATUSES)}"
                ),
            )
        rows = await self._store.list_matters(
            client_name=client_name,
            matter_type=matter_type,
            status=status,
            limit=limit,
            offset=offset,
        )
        return [_matter_from_stored(r) for r in rows]

    async def get_matter(self, matter_id: str) -> Optional[Matter]:
        if not matter_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="get_matter requires a non-empty matter_id",
            )
        stored = await self._store.get_matter(matter_id)
        if stored is None:
            return None
        return _matter_from_stored(stored)

    async def create_matter(
        self,
        *,
        client_name: str,
        matter_type: str,
        status: Optional[str] = None,
        custom_fields: Optional[dict[str, Any]] = None,
        matter_id: Optional[str] = None,
        opened_at: Optional[str] = None,
    ) -> Matter:
        if not client_name:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="create_matter requires client_name",
            )
        if not matter_type:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="create_matter requires matter_type",
            )
        effective_status = status if status is not None else "open"
        if effective_status not in _VALID_MATTER_STATUSES:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message=(
                    f"create_matter status {effective_status!r} not in "
                    f"valid set {sorted(_VALID_MATTER_STATUSES)}"
                ),
            )
        stored = StoredMatter(
            id=matter_id or _gen_matter_id(),
            client_name=client_name,
            matter_type=matter_type,
            status=effective_status,
            opened_at=opened_at or _iso_utc(),
            closed_at=None,
            custom_fields=dict(custom_fields or {}),
        )
        try:
            saved = await self._store.create_matter(stored)
        except ValueError as exc:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message=str(exc),
                cause=exc,
            ) from exc
        return _matter_from_stored(saved)

    async def update_matter(
        self,
        matter_id: str,
        *,
        client_name: Optional[str] = None,
        matter_type: Optional[str] = None,
        status: Optional[str] = None,
        custom_fields: Optional[dict[str, Any]] = None,
    ) -> Matter:
        if not matter_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="update_matter requires a non-empty matter_id",
            )
        if status is not None and status not in _VALID_MATTER_STATUSES:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message=(
                    f"update_matter status {status!r} not in valid set "
                    f"{sorted(_VALID_MATTER_STATUSES)}"
                ),
            )
        try:
            saved = await self._store.update_matter(
                matter_id,
                client_name=client_name,
                matter_type=matter_type,
                status=status,
                custom_fields=custom_fields,
            )
        except KeyError as exc:
            raise AdapterError(
                code="not_found",
                capability=self.capability,
                adapter=self.adapter,
                message=f"matter {matter_id!r} not found",
                cause=exc,
            ) from exc
        except ValueError as exc:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message=str(exc),
                cause=exc,
            ) from exc
        return _matter_from_stored(saved)

    async def list_matter_documents(self, matter_id: str) -> list[DocumentRef]:
        if not matter_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="list_matter_documents requires a non-empty matter_id",
            )
        rows = await self._store.list_matter_documents(matter_id)
        return [_docref_from_stored(r) for r in rows]

    async def create_note(
        self,
        matter_id: str,
        *,
        content: str,
        reviewer_account_id: str,
        drafted_by_skill: str,
    ) -> NoPmMatterNoteRef:
        """Create a matter note attributed to the reviewer.

        Per ADR 0005, the note's author is the reviewer, not the
        persona. The body is the drafted content verbatim. The
        ``drafted_by_skill`` is recorded for the dashboard sourcing
        block.
        """
        if not matter_id:
            raise AdapterError(
                code="validation_failed",
                capability=self.capability,
                adapter=self.adapter,
                message="create_note requires a non-empty matter_id",
            )
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
        note = StoredMatterNote(
            id=_gen_note_id(),
            matter_id=matter_id,
            body=content,
            created_at=_iso_utc(),
            author_account_id=reviewer_account_id,
            drafted_by_skill=drafted_by_skill,
        )
        try:
            saved = await self._store.create_matter_note(note)
        except KeyError as exc:
            raise AdapterError(
                code="not_found",
                capability=self.capability,
                adapter=self.adapter,
                message=f"matter {matter_id!r} not found",
                cause=exc,
            ) from exc
        return NoPmMatterNoteRef(
            id=saved.id,
            matter_id=saved.matter_id,
            body=saved.body,
            created_at=saved.created_at,
            author_account_id=saved.author_account_id,
            drafted_by_skill=saved.drafted_by_skill,
        )

    # ----- Unsupported methods raise capability_not_supported -----

    async def search_contacts(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message=(
                "search_contacts is not supported in the no_pm adapter; "
                "bind to the IntakeCRM capability for contact records"
            ),
        )

    async def get_contact(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="get_contact is not supported in the no_pm adapter",
        )

    async def create_contact(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message="create_contact is not supported in the no_pm adapter",
        )

    async def list_time_entries(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message=(
                "list_time_entries is not supported in the no_pm adapter; "
                "bind to the Accounting capability (e.g. QuickBooks) for "
                "billing records"
            ),
        )

    async def create_time_entry_draft(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message=(
                "create_time_entry_draft is not supported in the no_pm "
                "adapter; bind to the Accounting capability for time "
                "entries"
            ),
        )

    async def upload_matter_document(self, *args: Any, **kwargs: Any) -> None:
        raise AdapterError(
            code="capability_not_supported",
            capability=self.capability,
            adapter=self.adapter,
            message=(
                "upload_matter_document is not supported in the no_pm "
                "adapter; bind to the DocumentStorage capability (e.g. "
                "OneDrive) to upload bytes, then attach the link via "
                "create_note"
            ),
        )


__all__ = [
    "ADAPTER_SLUG",
    "CapabilitySet",
    "DocumentRef",
    "HealthStatus",
    "Matter",
    "NoPmMatterNoteRef",
    "NoPmPracticeManagement",
]
