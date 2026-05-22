"""Unit-level smoke test -- happy path for each capability method.

This is the CI-runnable version of `bin/smoke-test-filevine.py`. It
exercises each capability method through the adapter with a
mock-backed HTTP client and asserts the round-trip succeeds without
network access. The full sandbox-credentialed smoke test is
`bin/smoke-test-filevine.py` and is NOT run in CI.

Coverage matrix:

| Capability         | Method                  | Asserted here |
| ------------------ | ----------------------- | ------------- |
| PracticeManagement | search_matters          | Y             |
| PracticeManagement | get_matter              | Y             |
| PracticeManagement | list_matter_documents   | Y             |
| PracticeManagement | create_note             | Y             |
| PracticeManagement | health_check            | Y (healthy)   |
| DocumentStorage    | list_documents          | Y             |
| DocumentStorage    | get_document            | Y             |
| DocumentStorage    | get_document_bytes      | Y             |
| DocumentStorage    | health_check            | Y (healthy)   |

This is the "smoke test against Filevine sandbox/test tenant"
acceptance criterion's CI-side coverage.
"""

from __future__ import annotations

import asyncio

from connectors.filevine import (  # type: ignore[import-not-found]
    FilevineDocumentStorage,
    FilevinePracticeManagement,
)

from _helpers import FakeResponse, make_client  # type: ignore[import-not-found]


SMOKE_PROJECT_ID = "proj-smoke-1"
SMOKE_DOCUMENT_ID = "doc-smoke-1"


def _build_responses() -> dict:
    return {
        ("GET", "/core/projects"): FakeResponse(
            status_code=200,
            json_body={
                "items": [
                    {
                        "projectId": SMOKE_PROJECT_ID,
                        "clientName": "Smoke Tester",
                        "projectTypeCode": "PI-Auto",
                        "status": "Open",
                        "createdDate": "2026-05-01T00:00:00Z",
                        "closedDate": None,
                    },
                ]
            },
        ),
        ("GET", f"/core/projects/{SMOKE_PROJECT_ID}"): FakeResponse(
            status_code=200,
            json_body={
                "projectId": SMOKE_PROJECT_ID,
                "clientName": "Smoke Tester",
                "projectTypeCode": "PI-Auto",
                "status": "Open",
                "createdDate": "2026-05-01T00:00:00Z",
                "closedDate": None,
            },
        ),
        ("GET", f"/core/projects/{SMOKE_PROJECT_ID}/documents"): FakeResponse(
            status_code=200,
            json_body={
                "items": [
                    {
                        "documentId": SMOKE_DOCUMENT_ID,
                        "projectId": SMOKE_PROJECT_ID,
                        "filename": "intake-form.pdf",
                        "mimeType": "application/pdf",
                        "sizeBytes": 4096,
                        "uploadDate": "2026-05-01T01:00:00Z",
                        "uploadedByAccountId": "user-1",
                        "currentVersionId": "v1",
                    },
                ]
            },
        ),
        ("POST", f"/core/projects/{SMOKE_PROJECT_ID}/notes"): FakeResponse(
            status_code=201,
            json_body={
                "noteId": "note-smoke-1",
                "projectId": SMOKE_PROJECT_ID,
                "createdDate": "2026-05-21T17:00:00Z",
            },
        ),
        ("GET", f"/core/documents/{SMOKE_DOCUMENT_ID}"): FakeResponse(
            status_code=200,
            json_body={
                "documentId": SMOKE_DOCUMENT_ID,
                "projectId": SMOKE_PROJECT_ID,
                "filename": "intake-form.pdf",
                "mimeType": "application/pdf",
                "sizeBytes": 4096,
                "uploadDate": "2026-05-01T01:00:00Z",
                "uploadedByAccountId": "user-1",
                "currentVersionId": "v1",
            },
        ),
        ("GET", f"/core/documents/{SMOKE_DOCUMENT_ID}/download"): FakeResponse(
            status_code=200,
            content=b"%PDF-1.5\nfake-content\n",
        ),
    }


def test_pm_full_happy_path():
    client, _, _ = make_client(responses=_build_responses())
    pm = FilevinePracticeManagement(client)

    # search_matters
    matters = asyncio.run(pm.search_matters(limit=5))
    assert len(matters) == 1
    assert matters[0].id == SMOKE_PROJECT_ID

    # get_matter
    m = asyncio.run(pm.get_matter(SMOKE_PROJECT_ID))
    assert m is not None
    assert m.client_name == "Smoke Tester"

    # list_matter_documents
    docs = asyncio.run(pm.list_matter_documents(SMOKE_PROJECT_ID))
    assert len(docs) == 1
    assert docs[0].filename == "intake-form.pdf"

    # create_note
    note = asyncio.run(
        pm.create_note(
            SMOKE_PROJECT_ID,
            content="smoke note",
            reviewer_account_id="user-reviewer",
            drafted_by_skill="connector-smoke-test",
        )
    )
    assert note.id == "note-smoke-1"
    assert note.author_account_id == "user-reviewer"

    # health_check
    health = asyncio.run(pm.health_check())
    assert health.status == "healthy"


def test_ds_full_happy_path():
    client, _, _ = make_client(responses=_build_responses())
    ds = FilevineDocumentStorage(client)

    # list_documents
    docs = asyncio.run(ds.list_documents(SMOKE_PROJECT_ID))
    assert len(docs) == 1
    assert docs[0].id == SMOKE_DOCUMENT_ID
    assert docs[0].path.startswith(f"projects/{SMOKE_PROJECT_ID}/")

    # get_document
    d = asyncio.run(ds.get_document(SMOKE_DOCUMENT_ID))
    assert d is not None
    assert d.filename == "intake-form.pdf"

    # get_document_bytes
    blob = asyncio.run(ds.get_document_bytes(SMOKE_DOCUMENT_ID))
    assert blob.startswith(b"%PDF")

    # health_check
    health = asyncio.run(ds.health_check())
    assert health.status == "healthy"
