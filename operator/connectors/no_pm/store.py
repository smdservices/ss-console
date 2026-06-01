"""Synthetic matter store -- the persistence seam for the no_pm adapter.

The no-PM-system adapter needs somewhere to keep matters, matter notes,
and matter document references for customers who do not have an
external practice-management vendor. Per ADR 0008 (customer-owned
memory artifact), that storage lives in the per-customer D1 + R2
substrate that the memory pipeline (PR #944) already owns.

This module defines the storage seam as a Protocol -- ``MatterStore``
-- so the adapter never touches D1 or R2 directly. Production wires an
implementation backed by the per-customer ``D1Executor`` and R2
binding; tests use ``InMemoryMatterStore``. The conformance harness
verifies the adapter satisfies the capability interface regardless of
which store backs it.

Storage layout (production -- planned)
--------------------------------------

The production ``D1MatterStore`` implementation (follow-on issue) maps
onto two per-customer D1 tables:

* ``no_pm_matters`` -- one row per matter
* ``no_pm_matter_notes`` -- one row per note, linked by ``matter_id``

Per-matter documents live in the per-customer R2 vault at
``vaults/{customer_id}/no_pm/matters/{matter_id}/documents/`` -- the
same naming convention the memory pipeline already uses. The store
records the R2 key in the matter document index; the adapter exposes
``list_matter_documents`` against that index.

Per ADR 0009, no tenant ID is ever passed in -- the D1 + R2 bindings
are scoped at the per-customer Machine boundary, so isolation is
structural rather than per-row.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Any, Iterable, Optional, Protocol


# Closed enum mirroring the capability's ``MatterStatus`` union.
_VALID_STATUSES = frozenset({"open", "closed", "pending", "intake"})


def _iso_utc(now: Optional[datetime] = None) -> str:
    dt = now if now is not None else datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


# ---------------------------------------------------------------------------
# Data shapes -- vendor-neutral, mirror capability fields
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StoredMatter:
    """Matter row as the store sees it.

    Field set matches the capability ``Matter`` shape so the adapter's
    translation step is a 1:1 copy. Custom fields are an open dict so
    the synthetic-tracker UI (or a future operator surface) can record
    free-form metadata (e.g. "Outlook thread ref", "Dropbox folder ref")
    without forcing a schema change.
    """

    id: str
    client_name: str
    matter_type: str
    status: str
    opened_at: str
    closed_at: Optional[str]
    custom_fields: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class StoredMatterNote:
    """Note attached to a matter, attributed to the reviewer per ADR 0005."""

    id: str
    matter_id: str
    body: str
    created_at: str
    author_account_id: str
    drafted_by_skill: str


@dataclass(frozen=True)
class StoredMatterDocument:
    """Pointer to a document associated with a matter.

    The synthetic store records the document metadata (filename, size,
    upload time) plus an ``r2_key`` pointing at the per-customer vault
    where the bytes live. The DocumentStorage capability binding is the
    one customers should use to read the bytes -- the no_pm adapter
    exposes only matter-scoped listings.
    """

    id: str
    matter_id: str
    filename: str
    mime_type: str
    size_bytes: int
    uploaded_at: str
    uploaded_by: Optional[str]
    r2_key: Optional[str]


# ---------------------------------------------------------------------------
# Protocol -- the seam the adapter binds to
# ---------------------------------------------------------------------------


class MatterStore(Protocol):
    """Storage seam for the no_pm adapter.

    All methods are async so the production D1 + R2 implementation can
    do real I/O; the in-memory test fake's methods are async-no-ops
    that satisfy the protocol.
    """

    async def list_matters(
        self,
        *,
        client_name: Optional[str] = None,
        matter_type: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[StoredMatter]: ...

    async def get_matter(self, matter_id: str) -> Optional[StoredMatter]: ...

    async def create_matter(self, matter: StoredMatter) -> StoredMatter: ...

    async def update_matter(
        self,
        matter_id: str,
        *,
        client_name: Optional[str] = None,
        matter_type: Optional[str] = None,
        status: Optional[str] = None,
        custom_fields: Optional[dict[str, Any]] = None,
    ) -> StoredMatter: ...

    async def list_matter_documents(
        self, matter_id: str
    ) -> list[StoredMatterDocument]: ...

    async def create_matter_note(self, note: StoredMatterNote) -> StoredMatterNote: ...


# ---------------------------------------------------------------------------
# In-memory implementation -- used by tests + local dev
# ---------------------------------------------------------------------------


class InMemoryMatterStore:
    """Reference implementation of ``MatterStore`` backed by Python dicts.

    The conformance + capability tests use this implementation. Local
    dev with the no_pm template wires it as well; production swaps in
    a D1 + R2 implementation that satisfies the same protocol.

    Records are stored in insertion order; queries iterate in that
    order and apply substring matches on string fields. The store does
    not invent values -- if a caller asks for a matter that does not
    exist, ``get_matter`` returns ``None`` per the capability contract.
    """

    def __init__(
        self,
        matters: Optional[Iterable[StoredMatter]] = None,
        notes: Optional[Iterable[StoredMatterNote]] = None,
        documents: Optional[Iterable[StoredMatterDocument]] = None,
        clock: Optional["object"] = None,
    ) -> None:
        self._matters: dict[str, StoredMatter] = {}
        self._notes: dict[str, StoredMatterNote] = {}
        self._documents: dict[str, StoredMatterDocument] = {}
        # Insertion-order index for documents per matter so list calls
        # return them in the order the store recorded them.
        self._docs_by_matter: dict[str, list[str]] = {}
        for m in matters or ():
            self._matters[m.id] = m
        for n in notes or ():
            self._notes[n.id] = n
        for d in documents or ():
            self._documents[d.id] = d
            self._docs_by_matter.setdefault(d.matter_id, []).append(d.id)
        # ``clock`` is a callable that returns the current ISO timestamp;
        # tests override it for deterministic ``created_at`` values.
        self._clock = clock if clock is not None else _iso_utc

    # ---------------------------------------------------------------- reads

    async def list_matters(
        self,
        *,
        client_name: Optional[str] = None,
        matter_type: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[StoredMatter]:
        rows = list(self._matters.values())
        if client_name is not None:
            needle = client_name.lower()
            rows = [m for m in rows if needle in m.client_name.lower()]
        if matter_type is not None:
            rows = [m for m in rows if m.matter_type == matter_type]
        if status is not None:
            rows = [m for m in rows if m.status == status]
        return rows[offset : offset + limit]

    async def get_matter(self, matter_id: str) -> Optional[StoredMatter]:
        return self._matters.get(matter_id)

    async def list_matter_documents(
        self, matter_id: str
    ) -> list[StoredMatterDocument]:
        doc_ids = self._docs_by_matter.get(matter_id, ())
        return [self._documents[doc_id] for doc_id in doc_ids if doc_id in self._documents]

    # --------------------------------------------------------------- writes

    async def create_matter(self, matter: StoredMatter) -> StoredMatter:
        if matter.status not in _VALID_STATUSES:
            raise ValueError(
                f"create_matter status {matter.status!r} not in valid set "
                f"{sorted(_VALID_STATUSES)}"
            )
        if matter.id in self._matters:
            raise ValueError(f"matter_id {matter.id!r} already exists")
        self._matters[matter.id] = matter
        return matter

    async def update_matter(
        self,
        matter_id: str,
        *,
        client_name: Optional[str] = None,
        matter_type: Optional[str] = None,
        status: Optional[str] = None,
        custom_fields: Optional[dict[str, Any]] = None,
    ) -> StoredMatter:
        existing = self._matters.get(matter_id)
        if existing is None:
            raise KeyError(matter_id)
        if status is not None and status not in _VALID_STATUSES:
            raise ValueError(
                f"update_matter status {status!r} not in valid set "
                f"{sorted(_VALID_STATUSES)}"
            )
        merged_custom = dict(existing.custom_fields)
        if custom_fields is not None:
            merged_custom.update(custom_fields)
        new_closed_at = existing.closed_at
        if status == "closed" and existing.closed_at is None:
            new_closed_at = self._clock()
        updated = replace(
            existing,
            client_name=client_name if client_name is not None else existing.client_name,
            matter_type=matter_type if matter_type is not None else existing.matter_type,
            status=status if status is not None else existing.status,
            closed_at=new_closed_at,
            custom_fields=merged_custom,
        )
        self._matters[matter_id] = updated
        return updated

    async def create_matter_note(self, note: StoredMatterNote) -> StoredMatterNote:
        if note.matter_id not in self._matters:
            raise KeyError(note.matter_id)
        if note.id in self._notes:
            raise ValueError(f"note_id {note.id!r} already exists")
        self._notes[note.id] = note
        return note

    # ----------------------------------------------------------- test seams

    def add_document(self, doc: StoredMatterDocument) -> None:
        """Insert a document row.

        Tests use this seam to populate a matter with documents the
        adapter can list; production wires the same shape from the
        memory pipeline's R2 + index path.
        """
        if doc.matter_id not in self._matters:
            raise KeyError(doc.matter_id)
        self._documents[doc.id] = doc
        self._docs_by_matter.setdefault(doc.matter_id, []).append(doc.id)


__all__ = [
    "InMemoryMatterStore",
    "MatterStore",
    "StoredMatter",
    "StoredMatterDocument",
    "StoredMatterNote",
]
