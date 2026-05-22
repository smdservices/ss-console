"""Conformance checks -- Python mirror of the harness in
`src/lib/ai-employee/capabilities/conformance.ts`.

The TypeScript harness inspects an adapter and asserts the eight
invariants:

* CAPABILITY_SET_HONEST
* NULL_FOR_ABSENT
* TYPED_ERRORS
* NO_AUTONOMOUS_EXTERNAL_SEND
* NO_AUTONOMOUS_TRUST_TRANSFER (N/A for non-Payments)
* HEALTH_CHECK_BOUNDED
* UNSUPPORTED_METHODS_THROW
* NO_FIELD_FABRICATION

Because the Python adapter lives in a different language, we cannot
share the harness instance directly. This test module asserts the
same invariants against the Python adapters so the cross-language
contract holds end-to-end.

The banned-name lists below MUST stay in sync with `BANNED_METHOD_NAMES`
in conformance.ts. A drift between the two languages is a P0.
"""

from __future__ import annotations

import asyncio
import inspect
import time

import pytest

from connectors.filevine import (  # type: ignore[import-not-found]
    AdapterError,
    FilevineDocumentStorage,
    FilevinePracticeManagement,
)
from connectors.filevine.errors import (  # type: ignore[import-not-found]
    CAPABILITY_NAMES,
)

from _helpers import FakeResponse, make_client  # type: ignore[import-not-found]


# Pinned from `BANNED_METHOD_NAMES` in conformance.ts.
BANNED_METHOD_NAMES = {
    "Email": ["send", "send_message", "send_draft", "send_email"],
    "Calendar": ["send_invitation", "send_invite", "send_event"],
    "ESign": [
        "send_envelope",
        "create_and_send_envelope",
        "send_signing_request",
        "initiate_signing",
    ],
    "DocumentStorage": ["share_document", "send_share_invitation"],
    "Payments": [
        "send_payment_request",
        "initiate_transfer",
        "trust_disbursement",
        "transfer_funds",
        "disburse",
    ],
    "Accounting": ["post_invoice", "post_expense_entry", "post_to_general_ledger"],
    "IntakeCRM": ["send_to_lead", "send_lead_email", "message_lead"],
    "CourtAccess": ["file_document", "submit_filing", "send_to_court"],
    "CallTracking": [
        "create_call",
        "originate_call",
        "place_call",
        "send_text",
        "send_sms",
    ],
    "InternalComms": [],
    "PracticeManagement": [],
}


@pytest.mark.parametrize(
    "ctor",
    [FilevinePracticeManagement, FilevineDocumentStorage],
)
def test_adapter_has_no_banned_method_names(ctor):
    """NO_AUTONOMOUS_EXTERNAL_SEND + NO_AUTONOMOUS_TRUST_TRANSFER."""
    client, _, _ = make_client()
    adapter = ctor(client)
    cs = adapter.describe_capabilities()

    banned = BANNED_METHOD_NAMES.get(cs.capability, [])
    present = [name for name in banned if hasattr(adapter, name)]
    assert present == [], (
        f"{cs.adapter}/{cs.capability} exposes banned method(s) {present}. "
        "See CONFORMANCE_INVARIANTS.NO_AUTONOMOUS_EXTERNAL_SEND."
    )


@pytest.mark.parametrize(
    "ctor",
    [FilevinePracticeManagement, FilevineDocumentStorage],
)
def test_capability_set_well_formed(ctor):
    """CAPABILITY_SET_HONEST shape checks."""
    client, _, _ = make_client()
    adapter = ctor(client)
    cs = adapter.describe_capabilities()
    assert cs.adapter, "CapabilitySet.adapter must be non-empty"
    assert cs.version, "CapabilitySet.version must be non-empty"
    assert cs.supported_methods, "supported_methods must declare at least one method"
    # supported and unsupported are disjoint
    overlap = set(cs.supported_methods) & set(cs.unsupported_methods)
    assert not overlap, f"supported/unsupported overlap: {overlap}"
    # The declared capability is one of the eleven known capabilities.
    assert cs.capability in CAPABILITY_NAMES


def test_pm_declared_unsupported_actually_throw():
    """UNSUPPORTED_METHODS_THROW for PracticeManagement."""
    client, _, _ = make_client()
    pm = FilevinePracticeManagement(client)
    cs = pm.describe_capabilities()

    for name in cs.unsupported_methods:
        fn = getattr(pm, name, None)
        if fn is None:
            # Not defined at all is acceptable -- the harness only
            # asserts that defined-but-unsupported methods throw.
            continue
        # Call with no args / kwargs since unsupported methods accept
        # *args/**kwargs and throw before validating anything.
        if inspect.iscoroutinefunction(fn):
            with pytest.raises(AdapterError) as exc:
                asyncio.run(fn())
            assert exc.value.code == "capability_not_supported"


def test_ds_declared_unsupported_actually_throw():
    """UNSUPPORTED_METHODS_THROW for DocumentStorage."""
    client, _, _ = make_client()
    ds = FilevineDocumentStorage(client)
    cs = ds.describe_capabilities()
    for name in cs.unsupported_methods:
        fn = getattr(ds, name, None)
        if fn is None:
            continue
        if inspect.iscoroutinefunction(fn):
            with pytest.raises(AdapterError) as exc:
                asyncio.run(fn())
            assert exc.value.code == "capability_not_supported"


@pytest.mark.parametrize(
    "ctor",
    [FilevinePracticeManagement, FilevineDocumentStorage],
)
def test_health_check_bounded(ctor):
    """HEALTH_CHECK_BOUNDED -- health_check resolves within 5 seconds.

    The Filevine ping is a 0-limit list call; with the fake HTTP it
    resolves immediately. The bound is asserted as a wall-clock
    measurement to catch accidental blocking.
    """
    responses = {
        ("GET", "/core/projects"): FakeResponse(
            status_code=200, json_body={"items": []}
        ),
    }
    client, _, _ = make_client(responses=responses)
    adapter = ctor(client)

    start = time.monotonic()
    health = asyncio.run(adapter.health_check())
    elapsed = time.monotonic() - start
    assert elapsed < 5.0, f"health_check took {elapsed}s"
    assert health.status in ("healthy", "degraded", "unhealthy")


def test_null_for_absent_pm():
    """NULL_FOR_ABSENT -- get_matter on 404 returns None, not raises."""
    responses = {("GET", "/core/projects/missing"): FakeResponse(status_code=404)}
    client, _, _ = make_client(responses=responses)
    pm = FilevinePracticeManagement(client)
    assert asyncio.run(pm.get_matter("missing")) is None


def test_null_for_absent_ds():
    """NULL_FOR_ABSENT -- get_document on 404 returns None, not raises."""
    responses = {("GET", "/core/documents/missing"): FakeResponse(status_code=404)}
    client, _, _ = make_client(responses=responses)
    ds = FilevineDocumentStorage(client)
    assert asyncio.run(ds.get_document("missing")) is None


def test_typed_errors_only_use_closed_code_union():
    """TYPED_ERRORS -- every error raised is an AdapterError with a known code."""
    responses = {
        ("GET", "/core/projects"): FakeResponse(status_code=401),
    }
    client, _, _ = make_client(responses=responses)
    pm = FilevinePracticeManagement(client)

    with pytest.raises(AdapterError) as exc:
        asyncio.run(pm.search_matters())
    assert exc.value.code == "unauthorized"


def test_no_field_fabrication_pm():
    """NO_FIELD_FABRICATION -- sparse vendor row leaves optional fields None."""
    responses = {
        ("GET", "/core/projects/sparse"): FakeResponse(
            status_code=200,
            json_body={"projectId": "sparse"},  # nothing else
        ),
    }
    client, _, _ = make_client(responses=responses)
    pm = FilevinePracticeManagement(client)
    m = asyncio.run(pm.get_matter("sparse"))
    assert m is not None
    assert m.id == "sparse"
    # Vendor did not provide these -- adapter must not synthesize
    assert m.client_name == ""  # explicit "no value" string per contract
    assert m.matter_type == ""
    assert m.opened_at == ""
    assert m.closed_at is None
    # custom_fields is whatever's left (in this case empty)
    assert m.custom_fields == {}


def test_no_field_fabrication_ds():
    """NO_FIELD_FABRICATION -- sparse document row honored verbatim."""
    responses = {
        ("GET", "/core/documents/sparse"): FakeResponse(
            status_code=200,
            json_body={"documentId": "sparse"},
        ),
    }
    client, _, _ = make_client(responses=responses)
    ds = FilevineDocumentStorage(client)
    d = asyncio.run(ds.get_document("sparse"))
    assert d is not None
    assert d.id == "sparse"
    # mime_type and current_version have defaults declared in field_coverage
    # -- see capabilities.py `_stored_from_document` and `field_coverage.derived`.
    assert d.modified_by is None
