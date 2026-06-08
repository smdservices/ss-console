"""Unit tests for the no_pm capability adapter.

Covers:

* CapabilitySet shape -- capability name, supported/unsupported method
  declarations, field_coverage disclosure
* Matter.Read + Matter.Write happy paths (search, get, create, update)
* Note.Write attribution (reviewer, not "Operator")
* Unsupported methods raise ``capability_not_supported``
  (UNSUPPORTED_METHODS_THROW)
* ``get_matter`` returns None on unknown id (NULL_FOR_ABSENT)
* No banned methods on the adapter (NO_AUTONOMOUS_EXTERNAL_SEND)
* No field fabrication -- the 1:1 store-to-capability mapping
  preserves the store's values without invention
"""

from __future__ import annotations

import asyncio

import pytest

from connectors.no_pm import (  # type: ignore[import-not-found]
    AdapterError,
    InMemoryMatterStore,
    NoPmPracticeManagement,
    StoredMatter,
    StoredMatterDocument,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _seed_store_with_smith_matter() -> InMemoryMatterStore:
    store = InMemoryMatterStore()
    asyncio.run(
        store.create_matter(
            StoredMatter(
                id="mat-smith",
                client_name="Smith, John",
                matter_type="PI-Auto",
                status="open",
                opened_at="2026-01-15T10:30:00.000Z",
                closed_at=None,
                custom_fields={"outlook_thread_ref": "thr-101"},
            )
        )
    )
    return store


# ---------------------------------------------------------------------------
# describe_capabilities
# ---------------------------------------------------------------------------


def test_describe_capabilities_is_honest():
    pm = NoPmPracticeManagement()
    cs = pm.describe_capabilities()

    assert cs.capability == "PracticeManagement"
    assert cs.adapter == "no_pm"
    # The required read + write surface for the demo flow.
    for method in (
        "search_matters",
        "get_matter",
        "create_matter",
        "update_matter",
        "list_matter_documents",
        "create_note",
        "describe_capabilities",
        "health_check",
    ):
        assert method in cs.supported_methods

    # The synthetic store cannot honestly serve these.
    for method in (
        "search_contacts",
        "get_contact",
        "create_contact",
        "list_time_entries",
        "create_time_entry_draft",
        "upload_matter_document",
    ):
        assert method in cs.unsupported_methods

    # Supported and unsupported are disjoint -- the conformance harness
    # asserts this; restating here so a regression fails locally first.
    assert set(cs.supported_methods).isdisjoint(set(cs.unsupported_methods))


def test_describe_capabilities_discloses_derived_fields_on_writes():
    pm = NoPmPracticeManagement()
    cs = pm.describe_capabilities()
    # ``create_matter`` synthesizes id + opened_at if the caller omits
    # them. The dashboard sourcing block needs this declared.
    create_coverage = cs.field_coverage["create_matter"]
    assert "id" in create_coverage["derived"]
    assert "opened_at" in create_coverage["derived"]
    # ``create_note`` synthesizes id + created_at.
    note_coverage = cs.field_coverage["create_note"]
    assert "id" in note_coverage["derived"]
    assert "created_at" in note_coverage["derived"]


# ---------------------------------------------------------------------------
# search_matters / get_matter
# ---------------------------------------------------------------------------


def test_search_matters_returns_typed_matters():
    store = _seed_store_with_smith_matter()
    pm = NoPmPracticeManagement(store=store)
    matters = asyncio.run(pm.search_matters())
    assert len(matters) == 1
    m = matters[0]
    assert m.id == "mat-smith"
    assert m.client_name == "Smith, John"
    assert m.matter_type == "PI-Auto"
    assert m.status == "open"
    assert m.custom_fields == {"outlook_thread_ref": "thr-101"}


def test_search_matters_validation_failed_on_unknown_status():
    pm = NoPmPracticeManagement()
    with pytest.raises(AdapterError) as exc:
        asyncio.run(pm.search_matters(status="bogus"))
    assert exc.value.code == "validation_failed"
    assert exc.value.capability == "PracticeManagement"


def test_search_matters_filters_by_status():
    store = _seed_store_with_smith_matter()
    asyncio.run(
        store.create_matter(
            StoredMatter(
                id="mat-closed",
                client_name="Doe, Jane",
                matter_type="PI-Slip",
                status="closed",
                opened_at="2025-12-01T08:00:00.000Z",
                closed_at="2026-04-01T08:00:00.000Z",
                custom_fields={},
            )
        )
    )
    pm = NoPmPracticeManagement(store=store)
    closed = asyncio.run(pm.search_matters(status="closed"))
    assert [m.id for m in closed] == ["mat-closed"]


def test_get_matter_returns_none_on_unknown_id():
    pm = NoPmPracticeManagement(store=_seed_store_with_smith_matter())
    assert asyncio.run(pm.get_matter("mat-missing")) is None


def test_get_matter_happy_path():
    pm = NoPmPracticeManagement(store=_seed_store_with_smith_matter())
    m = asyncio.run(pm.get_matter("mat-smith"))
    assert m is not None
    assert m.id == "mat-smith"


def test_get_matter_validates_empty_id():
    pm = NoPmPracticeManagement()
    with pytest.raises(AdapterError) as exc:
        asyncio.run(pm.get_matter(""))
    assert exc.value.code == "validation_failed"


# ---------------------------------------------------------------------------
# create_matter / update_matter
# ---------------------------------------------------------------------------


def test_create_matter_persists_and_returns_typed_record():
    pm = NoPmPracticeManagement()
    m = asyncio.run(
        pm.create_matter(client_name="Roe, Richard", matter_type="PI-Premises")
    )
    assert m.client_name == "Roe, Richard"
    assert m.matter_type == "PI-Premises"
    assert m.status == "open"
    # Adapter-synthesized id + opened_at are populated.
    assert m.id.startswith("mat_")
    assert m.opened_at  # non-empty ISO string
    assert m.closed_at is None


def test_create_matter_accepts_caller_supplied_id():
    pm = NoPmPracticeManagement()
    m = asyncio.run(
        pm.create_matter(
            client_name="Smith, John",
            matter_type="PI-Auto",
            matter_id="custom-id",
        )
    )
    assert m.id == "custom-id"


def test_create_matter_validation_failed_on_missing_fields():
    pm = NoPmPracticeManagement()
    with pytest.raises(AdapterError) as exc:
        asyncio.run(pm.create_matter(client_name="", matter_type="PI-Auto"))
    assert exc.value.code == "validation_failed"

    with pytest.raises(AdapterError) as exc:
        asyncio.run(pm.create_matter(client_name="Smith", matter_type=""))
    assert exc.value.code == "validation_failed"


def test_create_matter_validation_failed_on_unknown_status():
    pm = NoPmPracticeManagement()
    with pytest.raises(AdapterError) as exc:
        asyncio.run(
            pm.create_matter(
                client_name="Smith", matter_type="PI-Auto", status="archived"
            )
        )
    assert exc.value.code == "validation_failed"


def test_create_matter_duplicate_id_surfaces_as_validation_failed():
    pm = NoPmPracticeManagement()
    asyncio.run(
        pm.create_matter(
            client_name="Smith", matter_type="PI-Auto", matter_id="dup"
        )
    )
    with pytest.raises(AdapterError) as exc:
        asyncio.run(
            pm.create_matter(
                client_name="Roe", matter_type="PI-Auto", matter_id="dup"
            )
        )
    assert exc.value.code == "validation_failed"


def test_update_matter_changes_status_and_merges_custom_fields():
    pm = NoPmPracticeManagement(store=_seed_store_with_smith_matter())
    updated = asyncio.run(
        pm.update_matter(
            "mat-smith",
            status="pending",
            custom_fields={"deposition_date": "2026-06-10"},
        )
    )
    assert updated.status == "pending"
    assert updated.custom_fields["outlook_thread_ref"] == "thr-101"
    assert updated.custom_fields["deposition_date"] == "2026-06-10"


def test_update_matter_not_found_on_unknown_id():
    pm = NoPmPracticeManagement()
    with pytest.raises(AdapterError) as exc:
        asyncio.run(pm.update_matter("mat-missing", status="closed"))
    assert exc.value.code == "not_found"


def test_update_matter_validation_failed_on_unknown_status():
    pm = NoPmPracticeManagement(store=_seed_store_with_smith_matter())
    with pytest.raises(AdapterError) as exc:
        asyncio.run(pm.update_matter("mat-smith", status="archived"))
    assert exc.value.code == "validation_failed"


def test_update_matter_validates_empty_id():
    pm = NoPmPracticeManagement()
    with pytest.raises(AdapterError) as exc:
        asyncio.run(pm.update_matter("", status="closed"))
    assert exc.value.code == "validation_failed"


# ---------------------------------------------------------------------------
# list_matter_documents
# ---------------------------------------------------------------------------


def test_list_matter_documents_returns_typed_docrefs():
    store = _seed_store_with_smith_matter()
    store.add_document(
        StoredMatterDocument(
            id="doc-1",
            matter_id="mat-smith",
            filename="police-report.pdf",
            mime_type="application/pdf",
            size_bytes=184320,
            uploaded_at="2026-01-18T14:22:00.000Z",
            uploaded_by="paralegal-12",
            r2_key="vaults/example/no_pm/matters/mat-smith/documents/police-report.pdf",
        )
    )
    pm = NoPmPracticeManagement(store=store)
    docs = asyncio.run(pm.list_matter_documents("mat-smith"))
    assert len(docs) == 1
    d = docs[0]
    assert d.id == "doc-1"
    assert d.matter_id == "mat-smith"
    assert d.filename == "police-report.pdf"
    assert d.size_bytes == 184320
    assert d.uploaded_by == "paralegal-12"


def test_list_matter_documents_validates_empty_id():
    pm = NoPmPracticeManagement()
    with pytest.raises(AdapterError) as exc:
        asyncio.run(pm.list_matter_documents(""))
    assert exc.value.code == "validation_failed"


def test_list_matter_documents_returns_empty_for_unknown_matter():
    pm = NoPmPracticeManagement()
    assert asyncio.run(pm.list_matter_documents("mat-missing")) == []


# ---------------------------------------------------------------------------
# create_note -- ADR 0005 attribution
# ---------------------------------------------------------------------------


def test_create_note_attributes_to_reviewer_not_persona():
    pm = NoPmPracticeManagement(store=_seed_store_with_smith_matter())
    note = asyncio.run(
        pm.create_note(
            "mat-smith",
            content="Status update: deposition scheduled 2026-06-10.",
            reviewer_account_id="reviewer-attorney-99",
            drafted_by_skill="status-report-assembler",
        )
    )
    assert note.matter_id == "mat-smith"
    assert note.author_account_id == "reviewer-attorney-99"
    assert note.drafted_by_skill == "status-report-assembler"
    # Body is the drafted content verbatim. The persona is NOT in the body.
    assert note.body == "Status update: deposition scheduled 2026-06-10."
    assert "Operator" not in note.body
    assert "Marcus" not in note.body


def test_create_note_not_found_on_unknown_matter():
    pm = NoPmPracticeManagement()
    with pytest.raises(AdapterError) as exc:
        asyncio.run(
            pm.create_note(
                "mat-missing",
                content="hi",
                reviewer_account_id="r",
                drafted_by_skill="s",
            )
        )
    assert exc.value.code == "not_found"


def test_create_note_validates_required_fields():
    pm = NoPmPracticeManagement(store=_seed_store_with_smith_matter())
    invalid_calls = (
        {"content": "", "reviewer_account_id": "r", "drafted_by_skill": "s"},
        {"content": "x", "reviewer_account_id": "", "drafted_by_skill": "s"},
        {"content": "x", "reviewer_account_id": "r", "drafted_by_skill": ""},
    )
    for kwargs in invalid_calls:
        with pytest.raises(AdapterError) as exc:
            asyncio.run(pm.create_note("mat-smith", **kwargs))
        assert exc.value.code == "validation_failed"

    with pytest.raises(AdapterError) as exc:
        asyncio.run(
            pm.create_note(
                "",
                content="x",
                reviewer_account_id="r",
                drafted_by_skill="s",
            )
        )
    assert exc.value.code == "validation_failed"


# ---------------------------------------------------------------------------
# Unsupported methods + conformance invariants
# ---------------------------------------------------------------------------


def test_unsupported_methods_raise_capability_not_supported():
    pm = NoPmPracticeManagement()
    for method in (
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


# This no_pm PM adapter is read+write-to-store only and exposes no send/publish
# surface; this test asserts none of these out-of-scope names slip in. (Send,
# where a connector has it, is ceiling-gated at runtime, not method-banned --
# ADR 0035.)
_BANNED_METHOD_NAMES = frozenset(
    {
        "send",
        "send_email",
        "send_message",
        "send_invoice",
        "post_invoice",
        "publish",
        "submit_filing",
        "schedule_meeting",
        "rsvp",
        "share_externally",
    }
)


def test_adapter_has_no_banned_method_names():
    pm = NoPmPracticeManagement()
    for name in dir(pm):
        assert name not in _BANNED_METHOD_NAMES, (
            f"NoPmPracticeManagement exposes banned method name {name!r}; "
            "the no_pm adapter must not expose autonomous send paths"
        )


# ---------------------------------------------------------------------------
# health_check
# ---------------------------------------------------------------------------


def test_health_check_is_healthy_when_store_is_reachable():
    pm = NoPmPracticeManagement()
    h = asyncio.run(pm.health_check())
    assert h.status == "healthy"
    assert h.last_ok_at is not None


# ---------------------------------------------------------------------------
# Cross-method demo flow -- end-to-end through the synthetic substrate
# ---------------------------------------------------------------------------


def test_demo_flow_create_then_note_then_close():
    """End-to-end exercise of the no_pm adapter against an in-memory
    store -- the demo flow that the spec promises works without an
    external PM vendor.
    """
    pm = NoPmPracticeManagement()

    # 1. Operator creates a synthetic matter from an Outlook intake.
    matter = asyncio.run(
        pm.create_matter(
            client_name="Smith, John",
            matter_type="PI-Auto",
            custom_fields={"outlook_thread_ref": "thr-101"},
        )
    )
    assert matter.status == "open"

    # 2. The agent drafts a status-update note; reviewer signs off.
    note = asyncio.run(
        pm.create_note(
            matter.id,
            content="Deposition scheduled 2026-06-10.",
            reviewer_account_id="reviewer-attorney-99",
            drafted_by_skill="status-report-assembler",
        )
    )
    assert note.author_account_id == "reviewer-attorney-99"
    assert note.body == "Deposition scheduled 2026-06-10."

    # 3. Matter is closed; closed_at is recorded.
    closed = asyncio.run(pm.update_matter(matter.id, status="closed"))
    assert closed.status == "closed"
    assert closed.closed_at is not None

    # 4. List confirms the matter is searchable as closed.
    rows = asyncio.run(pm.search_matters(status="closed"))
    assert [m.id for m in rows] == [matter.id]
