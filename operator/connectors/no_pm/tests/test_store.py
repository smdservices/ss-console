"""Unit tests for ``InMemoryMatterStore``.

Covers the reference implementation of the ``MatterStore`` protocol the
no_pm adapter binds to. Production swaps in a D1 + R2-backed
implementation that satisfies the same protocol; these tests assert
the in-memory variant honors the contract the adapter expects.
"""

from __future__ import annotations

import asyncio

import pytest

from connectors.no_pm.store import (  # type: ignore[import-not-found]
    InMemoryMatterStore,
    StoredMatter,
    StoredMatterDocument,
    StoredMatterNote,
)


def _matter(
    matter_id: str = "mat-1",
    *,
    client_name: str = "Smith, John",
    matter_type: str = "PI-Auto",
    status: str = "open",
) -> StoredMatter:
    return StoredMatter(
        id=matter_id,
        client_name=client_name,
        matter_type=matter_type,
        status=status,
        opened_at="2026-01-15T10:30:00.000Z",
        closed_at=None,
        custom_fields={},
    )


def test_list_matters_returns_empty_for_fresh_store():
    store = InMemoryMatterStore()
    assert asyncio.run(store.list_matters()) == []


def test_create_matter_persists_and_can_be_read():
    store = InMemoryMatterStore()
    asyncio.run(store.create_matter(_matter()))
    matters = asyncio.run(store.list_matters())
    assert len(matters) == 1
    assert matters[0].id == "mat-1"
    assert matters[0].client_name == "Smith, John"


def test_create_matter_rejects_duplicate_id():
    store = InMemoryMatterStore()
    asyncio.run(store.create_matter(_matter()))
    with pytest.raises(ValueError):
        asyncio.run(store.create_matter(_matter()))


def test_create_matter_rejects_invalid_status():
    store = InMemoryMatterStore()
    with pytest.raises(ValueError):
        asyncio.run(store.create_matter(_matter(status="archived")))


def test_get_matter_returns_none_for_unknown_id():
    store = InMemoryMatterStore()
    assert asyncio.run(store.get_matter("mat-missing")) is None


def test_list_matters_filters_by_client_name_substring():
    store = InMemoryMatterStore()
    asyncio.run(store.create_matter(_matter("mat-1", client_name="Smith, John")))
    asyncio.run(store.create_matter(_matter("mat-2", client_name="Doe, Jane")))
    smiths = asyncio.run(store.list_matters(client_name="smith"))
    assert [m.id for m in smiths] == ["mat-1"]


def test_list_matters_filters_by_status():
    store = InMemoryMatterStore()
    asyncio.run(store.create_matter(_matter("mat-1", status="open")))
    asyncio.run(store.create_matter(_matter("mat-2", status="closed")))
    closed = asyncio.run(store.list_matters(status="closed"))
    assert [m.id for m in closed] == ["mat-2"]


def test_list_matters_paginates_by_limit_offset():
    store = InMemoryMatterStore()
    for i in range(5):
        asyncio.run(store.create_matter(_matter(f"mat-{i}")))
    page = asyncio.run(store.list_matters(limit=2, offset=1))
    assert [m.id for m in page] == ["mat-1", "mat-2"]


def test_update_matter_merges_custom_fields():
    store = InMemoryMatterStore()
    asyncio.run(store.create_matter(_matter()))
    asyncio.run(
        store.update_matter("mat-1", custom_fields={"outlook_thread": "thr-99"})
    )
    asyncio.run(store.update_matter("mat-1", custom_fields={"dropbox_folder": "f1"}))
    m = asyncio.run(store.get_matter("mat-1"))
    assert m is not None
    assert m.custom_fields == {"outlook_thread": "thr-99", "dropbox_folder": "f1"}


def test_update_matter_records_closed_at_when_status_flips_to_closed():
    store = InMemoryMatterStore(clock=lambda: "2026-05-21T12:00:00.000Z")
    asyncio.run(store.create_matter(_matter()))
    m = asyncio.run(store.update_matter("mat-1", status="closed"))
    assert m.status == "closed"
    assert m.closed_at == "2026-05-21T12:00:00.000Z"


def test_update_matter_rejects_unknown_status():
    store = InMemoryMatterStore()
    asyncio.run(store.create_matter(_matter()))
    with pytest.raises(ValueError):
        asyncio.run(store.update_matter("mat-1", status="archived"))


def test_update_matter_raises_keyerror_for_unknown_id():
    store = InMemoryMatterStore()
    with pytest.raises(KeyError):
        asyncio.run(store.update_matter("mat-missing", status="open"))


def test_create_matter_note_requires_matter_to_exist():
    store = InMemoryMatterStore()
    note = StoredMatterNote(
        id="note-1",
        matter_id="mat-missing",
        body="hi",
        created_at="2026-05-21T12:00:00.000Z",
        author_account_id="reviewer-1",
        drafted_by_skill="status-report-assembler",
    )
    with pytest.raises(KeyError):
        asyncio.run(store.create_matter_note(note))


def test_add_document_lists_in_insertion_order():
    store = InMemoryMatterStore()
    asyncio.run(store.create_matter(_matter()))
    store.add_document(
        StoredMatterDocument(
            id="doc-1",
            matter_id="mat-1",
            filename="intake.pdf",
            mime_type="application/pdf",
            size_bytes=100,
            uploaded_at="2026-01-15T10:30:00.000Z",
            uploaded_by=None,
            r2_key="vaults/example/no_pm/matters/mat-1/documents/intake.pdf",
        )
    )
    store.add_document(
        StoredMatterDocument(
            id="doc-2",
            matter_id="mat-1",
            filename="medical-records.pdf",
            mime_type="application/pdf",
            size_bytes=200,
            uploaded_at="2026-01-16T10:30:00.000Z",
            uploaded_by=None,
            r2_key="vaults/example/no_pm/matters/mat-1/documents/medical-records.pdf",
        )
    )
    docs = asyncio.run(store.list_matter_documents("mat-1"))
    assert [d.id for d in docs] == ["doc-1", "doc-2"]


def test_list_matter_documents_returns_empty_for_unknown_matter():
    store = InMemoryMatterStore()
    assert asyncio.run(store.list_matter_documents("mat-missing")) == []


def test_add_document_rejects_unknown_matter():
    store = InMemoryMatterStore()
    with pytest.raises(KeyError):
        store.add_document(
            StoredMatterDocument(
                id="doc-1",
                matter_id="mat-missing",
                filename="x.pdf",
                mime_type="application/pdf",
                size_bytes=1,
                uploaded_at="2026-01-15T10:30:00.000Z",
                uploaded_by=None,
                r2_key=None,
            )
        )
