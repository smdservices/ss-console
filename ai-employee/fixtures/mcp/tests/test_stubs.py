"""Tests for ai-employee/fixtures/mcp/ stubs.

Each stub validates:
  - documented happy-path tools return the expected shape
  - undocumented tools raise StubError
  - write/refused tools raise StubError defensively
  - missing required args raise StubError
  - missing resource raises StubNotFoundError
  - force_auth_error raises StubAuthError

Coverage spans 5 stubs: Gmail, Google Calendar, Clio, CourtListener,
LawPay. The shape is parallel across stubs so the L1 connector contract
tests can swap any vendor in/out cleanly.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[3]))

from fixtures.mcp import (  # noqa: E402
    StubAuthError,
    StubError,
    StubNotFoundError,
    clio,
    courtlistener,
    gmail,
    google_calendar,
    lawpay,
)


class TestGmail:
    def test_search_messages_returns_messages_array(self):
        result = gmail.call_gmail("gmail.search_messages", {"query": "from:foo"})
        assert "messages" in result
        assert isinstance(result["messages"], list)
        assert result["messages"][0]["id"].startswith("msg_")

    def test_get_message_happy_path(self):
        result = gmail.call_gmail(
            "gmail.get_message", {"message_id": "msg_synthetic_001"}
        )
        assert result["message"]["id"] == "msg_synthetic_001"
        assert "headers" in result["message"]["payload"]

    def test_get_message_not_found(self):
        with pytest.raises(StubNotFoundError):
            gmail.call_gmail("gmail.get_message", {"message_id": "msg_nope"})

    def test_create_draft_requires_fields(self):
        with pytest.raises(StubError, match="requires"):
            gmail.call_gmail("gmail.create_draft", {"to": "foo@bar"})

    def test_create_draft_happy_path(self):
        result = gmail.call_gmail(
            "gmail.create_draft",
            {"to": "foo@bar.invalid", "subject": "Hi", "body": "Body"},
        )
        assert result["draft"]["id"].startswith("draft_")

    def test_send_message_refused(self):
        with pytest.raises(StubError, match="refused at stub layer"):
            gmail.call_gmail("gmail.send_message", {"to": "foo@bar.invalid"})

    def test_unknown_tool_raises(self):
        with pytest.raises(StubError, match="unknown gmail tool"):
            gmail.call_gmail("gmail.not_a_real_tool", {})

    def test_force_auth_error(self):
        with pytest.raises(StubAuthError):
            gmail.force_auth_error("gmail.get_message", {})


class TestCalendar:
    def test_list_events_requires_time_range(self):
        with pytest.raises(StubError, match="time_min"):
            google_calendar.call_calendar("calendar.list_events", {})

    def test_list_events_happy_path(self):
        result = google_calendar.call_calendar(
            "calendar.list_events",
            {"time_min": "2026-05-25T00:00:00Z", "time_max": "2026-06-25T00:00:00Z"},
        )
        assert "items" in result
        assert result["items"][0]["id"].startswith("evt_")

    def test_get_event_happy_path(self):
        result = google_calendar.call_calendar(
            "calendar.get_event", {"event_id": "evt_synthetic_001"}
        )
        assert result["event"]["id"] == "evt_synthetic_001"

    def test_get_event_not_found(self):
        with pytest.raises(StubNotFoundError):
            google_calendar.call_calendar(
                "calendar.get_event", {"event_id": "evt_nope"}
            )

    def test_create_event_requires_fields(self):
        with pytest.raises(StubError):
            google_calendar.call_calendar("calendar.create_event", {"summary": "x"})

    def test_create_event_happy_path(self):
        result = google_calendar.call_calendar(
            "calendar.create_event",
            {
                "summary": "Test",
                "start": {"dateTime": "2026-06-01T09:00:00-07:00"},
                "end": {"dateTime": "2026-06-01T10:00:00-07:00"},
            },
        )
        assert result["event"]["summary"] == "Test"

    def test_unknown_tool_raises(self):
        with pytest.raises(StubError, match="unknown calendar tool"):
            google_calendar.call_calendar("calendar.nope", {})

    def test_force_auth_error(self):
        with pytest.raises(StubAuthError):
            google_calendar.force_auth_error("calendar.list_events", {})


class TestClio:
    def test_matters_list_default(self):
        result = clio.call_clio("clio.matters_list", {})
        assert len(result["matters"]) == 1

    def test_matters_list_filtered_practice_area(self):
        result = clio.call_clio(
            "clio.matters_list", {"practice_area": "Estate Planning"}
        )
        assert result["matters"] == []

    def test_matters_get_happy_path(self):
        result = clio.call_clio(
            "clio.matters_get", {"matter_id": "matter_synthetic_clio_01"}
        )
        assert result["matter"]["status"] == "open"

    def test_matters_get_not_found(self):
        with pytest.raises(StubNotFoundError):
            clio.call_clio("clio.matters_get", {"matter_id": "matter_nope"})

    def test_custom_fields_returned(self):
        result = clio.call_clio(
            "clio.matters_custom_fields", {"matter_id": "matter_synthetic_clio_01"}
        )
        assert "date_of_incident" in result["custom_fields"]
        assert "claim_number" in result["custom_fields"]

    def test_documents_list_returns_documents(self):
        result = clio.call_clio(
            "clio.documents_list", {"matter_id": "matter_synthetic_clio_01"}
        )
        assert len(result["documents"]) == 1
        assert result["documents"][0]["id"].startswith("doc_")

    def test_write_tools_refused(self):
        for tool in (
            "clio.matters_update",
            "clio.documents_upload",
            "clio.contacts_create",
        ):
            with pytest.raises(StubError, match="read-only"):
                clio.call_clio(tool, {"matter_id": "x"})

    def test_unknown_tool_raises(self):
        with pytest.raises(StubError, match="unknown clio tool"):
            clio.call_clio("clio.not_a_real_tool", {})


class TestCourtListener:
    def test_search_dockets_requires_query(self):
        with pytest.raises(StubError, match="query"):
            courtlistener.call_courtlistener("courtlistener.search_dockets", {})

    def test_search_dockets_happy_path(self):
        result = courtlistener.call_courtlistener(
            "courtlistener.search_dockets", {"query": "Holloway"}
        )
        assert result["count"] >= 1
        assert "case_name" in result["dockets"][0]

    def test_get_docket_happy_path(self):
        result = courtlistener.call_courtlistener(
            "courtlistener.get_docket", {"docket_id": 9876543}
        )
        assert result["docket"]["case_name"] == "Holloway v. Kerr"

    def test_get_docket_not_found(self):
        with pytest.raises(StubNotFoundError):
            courtlistener.call_courtlistener(
                "courtlistener.get_docket", {"docket_id": 99}
            )

    def test_search_opinions_happy_path(self):
        result = courtlistener.call_courtlistener(
            "courtlistener.search_opinions", {"query": "negligence"}
        )
        assert result["count"] >= 1

    def test_unknown_tool_raises(self):
        with pytest.raises(StubError, match="unknown courtlistener tool"):
            courtlistener.call_courtlistener("courtlistener.nope", {})


class TestLawPay:
    def test_invoices_list_default(self):
        result = lawpay.call_lawpay("lawpay.invoices_list", {})
        assert len(result["invoices"]) == 1
        assert result["invoices"][0]["status"] == "open"

    def test_invoices_get_happy_path(self):
        result = lawpay.call_lawpay(
            "lawpay.invoices_get", {"invoice_id": "inv_synthetic_001"}
        )
        assert result["invoice"]["amount_due"] == 12500.00

    def test_payments_list_filters_by_invoice(self):
        result = lawpay.call_lawpay(
            "lawpay.payments_list", {"invoice_id": "inv_synthetic_001"}
        )
        assert len(result["payments"]) == 1
        result_empty = lawpay.call_lawpay(
            "lawpay.payments_list", {"invoice_id": "inv_nope"}
        )
        assert result_empty["payments"] == []

    def test_trust_account_returned(self):
        result = lawpay.call_lawpay(
            "lawpay.trust_accounts_get", {"account_id": "trust_acct_001"}
        )
        assert result["trust_account"]["balance"] > 0

    def test_write_tools_refused(self):
        for tool in (
            "lawpay.charge_card",
            "lawpay.refund_payment",
            "lawpay.transfer_funds",
            "lawpay.create_invoice",
            "lawpay.write_trust_ledger",
        ):
            with pytest.raises(StubError, match="NEVER autonomous"):
                lawpay.call_lawpay(tool, {})

    def test_unknown_tool_raises(self):
        with pytest.raises(StubError, match="unknown lawpay tool"):
            lawpay.call_lawpay("lawpay.nope", {})


class TestAllStubsHaveAuthError:
    """Every stub exposes a force_auth_error for L3 adversarial probes."""

    @pytest.mark.parametrize(
        "module",
        [gmail, google_calendar, clio, courtlistener, lawpay],
        ids=lambda m: m.__name__.rsplit(".", 1)[-1],
    )
    def test_force_auth_error_exists(self, module):
        assert hasattr(module, "force_auth_error")
        with pytest.raises(StubAuthError):
            module.force_auth_error("any.tool", {})
