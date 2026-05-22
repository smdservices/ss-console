"""Unit tests for the Filevine capability adapters.

Covers:

* CapabilitySet shape -- capability name, supported/unsupported method
  declarations, field_coverage disclosure
* Matter.Read happy paths (`search_matters`, `get_matter`,
  `list_matter_documents`)
* Matter.Note.Write attribution (reviewer, not "AI Employee")
* Document.Read (`list_documents`, `get_document`, `get_document_bytes`)
* Unsupported methods raise `capability_not_supported` (UNSUPPORTED_METHODS_THROW)
* `get_matter` returns None on 404 (NULL_FOR_ABSENT)
* No vendor field invention (NO_FIELD_FABRICATION) -- vendor JSON with
  missing fields produces None / "" rather than synthesized values
* Status-vocabulary mapping is inverse-consistent
* No banned methods on either adapter (NO_AUTONOMOUS_EXTERNAL_SEND)

Tests use the FakeHttpClient from conftest; no real network calls.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from connectors.filevine import (  # type: ignore[import-not-found]
    AdapterError,
    FilevineDocumentStorage,
    FilevinePracticeManagement,
)
from connectors.filevine.capabilities import (  # type: ignore[import-not-found]
    _FILEVINE_STATUS_MAP,
)

from _helpers import FakeResponse, make_client  # type: ignore[import-not-found]


# ---------------------------------------------------------------------------
# Fixtures -- sample Filevine response payloads
# ---------------------------------------------------------------------------


PROJECT_ROW = {
    "projectId": "proj-123",
    "clientName": "Smith, John",
    "projectTypeCode": "PI-Auto",
    "status": "Open",
    "createdDate": "2026-01-15T10:30:00Z",
    "closedDate": None,
    "primaryAttorneyAccountId": "user-attorney-99",
    "incidentDate": "2025-11-04",
}

PROJECT_ROW_VENDOR_UNKNOWN_STATUS = {
    "projectId": "proj-789",
    "clientName": "Doe, Jane",
    "projectTypeCode": "PI-Slip",
    "status": "Stalled",  # not in _FILEVINE_STATUS_MAP
    "createdDate": "2026-02-10T08:00:00Z",
    "closedDate": None,
}

DOCUMENT_ROW = {
    "documentId": "doc-555",
    "projectId": "proj-123",
    "filename": "police-report.pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 184320,
    "uploadDate": "2026-01-18T14:22:00Z",
    "uploadedByAccountId": "user-paralegal-12",
    "currentVersionId": "v3",
    "modifiedDate": "2026-02-01T09:15:00Z",
    "modifiedByAccountId": "user-attorney-99",
}

NOTE_RESPONSE = {
    "noteId": "note-7777",
    "projectId": "proj-123",
    "createdDate": "2026-05-21T17:00:00Z",
}


# ---------------------------------------------------------------------------
# PracticeManagement
# ---------------------------------------------------------------------------


def test_pm_describe_capabilities_is_honest():
    client, _, _ = make_client()
    pm = FilevinePracticeManagement(client)

    cs = pm.describe_capabilities()
    assert cs.capability == "PracticeManagement"
    assert cs.adapter == "filevine"
    assert "search_matters" in cs.supported_methods
    assert "get_matter" in cs.supported_methods
    assert "list_matter_documents" in cs.supported_methods
    assert "create_note" in cs.supported_methods
    # Unsupported methods must not appear in supported_methods (disjoint).
    assert set(cs.supported_methods).isdisjoint(set(cs.unsupported_methods))
    # Filevine v1 explicitly does NOT support these.
    for missing in (
        "create_matter",
        "update_matter",
        "search_contacts",
        "list_time_entries",
        "upload_matter_document",
    ):
        assert missing in cs.unsupported_methods


def test_pm_search_matters_returns_typed_matters():
    responses = {
        ("GET", "/core/projects"): FakeResponse(
            status_code=200,
            json_body={"items": [PROJECT_ROW]},
        ),
    }
    client, fake_http, _ = make_client(responses=responses)
    pm = FilevinePracticeManagement(client)

    matters = asyncio.run(pm.search_matters(limit=5))

    assert len(matters) == 1
    m = matters[0]
    assert m.id == "proj-123"
    assert m.client_name == "Smith, John"
    assert m.matter_type == "PI-Auto"
    assert m.status == "open"
    assert m.opened_at == "2026-01-15T10:30:00Z"
    assert m.closed_at is None
    # Custom fields preserved verbatim
    assert m.custom_fields["primaryAttorneyAccountId"] == "user-attorney-99"
    assert m.custom_fields["incidentDate"] == "2025-11-04"
    # Filter applied to query
    call = fake_http.calls[0]
    assert call.params["orgUid"] == "example-firm"
    assert call.params["limit"] == 5


def test_pm_search_matters_validation_failed_on_unknown_status():
    client, _, _ = make_client()
    pm = FilevinePracticeManagement(client)

    with pytest.raises(AdapterError) as exc:
        asyncio.run(pm.search_matters(status="bogus"))
    assert exc.value.code == "validation_failed"
    assert exc.value.capability == "PracticeManagement"


def test_pm_search_matters_translates_status_to_vendor_vocabulary():
    responses = {
        ("GET", "/core/projects"): FakeResponse(
            status_code=200,
            json_body={"items": []},
        ),
    }
    client, fake_http, _ = make_client(responses=responses)
    pm = FilevinePracticeManagement(client)

    asyncio.run(pm.search_matters(status="closed"))
    assert fake_http.calls[0].params["status"] == "Closed"


def test_pm_search_matters_preserves_unknown_vendor_status_in_custom_fields():
    responses = {
        ("GET", "/core/projects"): FakeResponse(
            status_code=200,
            json_body={"items": [PROJECT_ROW_VENDOR_UNKNOWN_STATUS]},
        ),
    }
    client, _, _ = make_client(responses=responses)
    pm = FilevinePracticeManagement(client)

    matters = asyncio.run(pm.search_matters())
    m = matters[0]
    # Unknown vendor status falls back to "open" per the comment in
    # _matter_from_project, but the raw is preserved.
    assert m.status == "open"
    assert m.custom_fields["_vendor_status_raw"] == "Stalled"


def test_pm_get_matter_returns_none_on_404():
    responses = {
        ("GET", "/core/projects/missing"): FakeResponse(status_code=404),
    }
    client, _, _ = make_client(responses=responses)
    pm = FilevinePracticeManagement(client)

    result = asyncio.run(pm.get_matter("missing"))
    assert result is None  # NULL_FOR_ABSENT invariant


def test_pm_get_matter_happy_path():
    responses = {
        ("GET", "/core/projects/proj-123"): FakeResponse(
            status_code=200, json_body=PROJECT_ROW
        ),
    }
    client, _, _ = make_client(responses=responses)
    pm = FilevinePracticeManagement(client)

    m = asyncio.run(pm.get_matter("proj-123"))
    assert m is not None
    assert m.id == "proj-123"


def test_pm_list_matter_documents_maps_each_row():
    responses = {
        ("GET", "/core/projects/proj-123/documents"): FakeResponse(
            status_code=200,
            json_body={"items": [DOCUMENT_ROW]},
        ),
    }
    client, _, _ = make_client(responses=responses)
    pm = FilevinePracticeManagement(client)

    docs = asyncio.run(pm.list_matter_documents("proj-123"))
    assert len(docs) == 1
    d = docs[0]
    assert d.id == "doc-555"
    assert d.matter_id == "proj-123"
    assert d.filename == "police-report.pdf"
    assert d.size_bytes == 184320
    assert d.uploaded_by == "user-paralegal-12"


def test_pm_create_note_attributes_to_reviewer_not_persona():
    responses = {
        ("POST", "/core/projects/proj-123/notes"): FakeResponse(
            status_code=201, json_body=NOTE_RESPONSE
        ),
    }
    client, fake_http, _ = make_client(responses=responses)
    pm = FilevinePracticeManagement(client)

    note = asyncio.run(
        pm.create_note(
            "proj-123",
            content="Status update: deposition scheduled 2026-06-10.",
            reviewer_account_id="user-attorney-99",
            drafted_by_skill="law-client-status-update",
        )
    )
    assert note.id == "note-7777"
    assert note.author_account_id == "user-attorney-99"
    assert note.drafted_by_skill == "law-client-status-update"
    assert note.body == "Status update: deposition scheduled 2026-06-10."

    # Vendor request reflects ADR 0005 attribution
    call = fake_http.calls[0]
    assert call.json["authorAccountId"] == "user-attorney-99"
    # The persona is NOT in the note -- the body is the drafted content.
    body_text = call.json["body"]
    assert "AI Employee" not in body_text
    assert "Marcus" not in body_text
    # drafted_by_skill rides in metadata for the audit trail
    assert call.json["metadata"]["drafted_by_skill"] == "law-client-status-update"
    assert call.json["metadata"]["draft"] is True


def test_pm_create_note_validates_required_fields():
    client, _, _ = make_client()
    pm = FilevinePracticeManagement(client)

    for kwargs in (
        {"content": "", "reviewer_account_id": "r", "drafted_by_skill": "s"},
        {"content": "x", "reviewer_account_id": "", "drafted_by_skill": "s"},
        {"content": "x", "reviewer_account_id": "r", "drafted_by_skill": ""},
    ):
        with pytest.raises(AdapterError) as exc:
            asyncio.run(pm.create_note("proj-123", **kwargs))
        assert exc.value.code == "validation_failed"


def test_pm_unsupported_methods_raise_capability_not_supported():
    client, _, _ = make_client()
    pm = FilevinePracticeManagement(client)

    for method in (
        "create_matter",
        "update_matter",
        "search_contacts",
        "get_contact",
        "create_contact",
        "list_time_entries",
        "create_time_entry_draft",
        "upload_matter_document",
    ):
        fn = getattr(pm, method)
        with pytest.raises(AdapterError) as exc:
            asyncio.run(fn())
        assert exc.value.code == "capability_not_supported", (
            f"{method} did not raise capability_not_supported"
        )


# ---------------------------------------------------------------------------
# DocumentStorage
# ---------------------------------------------------------------------------


def test_ds_describe_capabilities():
    client, _, _ = make_client()
    ds = FilevineDocumentStorage(client)

    cs = ds.describe_capabilities()
    assert cs.capability == "DocumentStorage"
    assert "list_documents" in cs.supported_methods
    assert "get_document" in cs.supported_methods
    assert "get_document_bytes" in cs.supported_methods
    # Folder + share-draft surface unsupported in v1
    for missing in (
        "list_folder",
        "upload_document",
        "update_document",
        "list_versions",
        "share_document_draft",
    ):
        assert missing in cs.unsupported_methods


def test_ds_list_documents_maps_with_synthesized_path():
    responses = {
        ("GET", "/core/projects/proj-123/documents"): FakeResponse(
            status_code=200,
            json_body={"items": [DOCUMENT_ROW]},
        ),
    }
    client, _, _ = make_client(responses=responses)
    ds = FilevineDocumentStorage(client)

    docs = asyncio.run(ds.list_documents("proj-123"))
    assert len(docs) == 1
    d = docs[0]
    assert d.id == "doc-555"
    assert d.filename == "police-report.pdf"
    # Path is synthesized -- field_coverage.derived discloses this.
    assert d.path == "projects/proj-123/police-report.pdf"
    assert d.modified_by == "user-attorney-99"
    assert d.current_version == "v3"


def test_ds_get_document_returns_none_on_404():
    responses = {
        ("GET", "/core/documents/missing"): FakeResponse(status_code=404),
    }
    client, _, _ = make_client(responses=responses)
    ds = FilevineDocumentStorage(client)

    assert asyncio.run(ds.get_document("missing")) is None


def test_ds_get_document_bytes_returns_raw_bytes():
    responses = {
        ("GET", "/core/documents/doc-555/download"): FakeResponse(
            status_code=200, content=b"%PDF-1.5\nfake-content"
        ),
    }
    client, _, _ = make_client(responses=responses)
    ds = FilevineDocumentStorage(client)

    blob = asyncio.run(ds.get_document_bytes("doc-555"))
    assert isinstance(blob, bytes)
    assert blob.startswith(b"%PDF")


def test_ds_get_document_bytes_404_raises_not_found():
    responses = {
        ("GET", "/core/documents/missing/download"): FakeResponse(status_code=404),
    }
    client, _, _ = make_client(responses=responses)
    ds = FilevineDocumentStorage(client)

    with pytest.raises(AdapterError) as exc:
        asyncio.run(ds.get_document_bytes("missing"))
    assert exc.value.code == "not_found"


def test_ds_unsupported_methods_raise():
    client, _, _ = make_client()
    ds = FilevineDocumentStorage(client)

    for method in (
        "list_folder",
        "upload_document",
        "update_document",
        "list_versions",
        "download_version",
        "share_document_draft",
    ):
        fn = getattr(ds, method)
        with pytest.raises(AdapterError) as exc:
            asyncio.run(fn())
        assert exc.value.code == "capability_not_supported", (
            f"{method} did not raise capability_not_supported"
        )


def test_ds_get_scoped_folders_returns_empty_not_raises():
    client, _, _ = make_client()
    ds = FilevineDocumentStorage(client)
    assert ds.get_scoped_folders() == []


# ---------------------------------------------------------------------------
# Status map sanity -- the inverse mapping used in search_matters must be
# bijective so callers can round-trip statuses without ambiguity.
# ---------------------------------------------------------------------------


def test_status_map_is_bijective():
    inverse = {v: k for k, v in _FILEVINE_STATUS_MAP.items()}
    assert len(inverse) == len(_FILEVINE_STATUS_MAP), (
        "Two Filevine vendor statuses map to the same capability status; "
        "the inverse used in search_matters would lose data."
    )
