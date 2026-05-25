"""Stub for mcp:clio-oktopeak (community MCP, vetted per plan §Week 0).

Documented tools (subset matching what the PI skills consume):

  - clio.matters_list(status='open', practice_area=None) -> {matters: [...]}
  - clio.matters_get(matter_id) -> {matter: {...}}
  - clio.matters_custom_fields(matter_id) -> {custom_fields: {...}}
  - clio.documents_list(matter_id, document_category=None) -> {documents: [...]}
  - clio.documents_get(document_id) -> {document: {...}}
  - clio.contacts_get(contact_id) -> {contact: {...}}

Trust-ceiling FORBIDDEN tools (stub refuses defensively; trust plugin
should catch earlier):

  - clio.matters_update — adapter only reads from Clio
  - clio.documents_upload — adapter only reads from Clio
  - clio.contacts_create — adapter only reads from Clio

Canonical happy-path data shape derived from Clio's API v4 resources +
the oktopeak/clio-mcp readme. Per the plan: this community MCP gets a
small code review pass before the first Clio-customer ships, since it's
not a vendor-direct server.
"""

from __future__ import annotations

from typing import Any

from . import StubAuthError, StubError, StubNotFoundError


_HAPPY_MATTER = {
    "id": "matter_synthetic_clio_01",
    "display_number": "2026-PI-0142",
    "description": "Holloway v. Kerr — auto accident PI",
    "status": "open",
    "practice_area": {"id": "pa_001", "name": "Personal Injury"},
    "client": {
        "id": "contact_001",
        "name": "Janet Holloway",
        "primary_email_address": "janet.holloway@example.invalid",
    },
    "responsible_attorney": {
        "id": "user_001",
        "name": "Sarah Holcomb",
        "email": "sarah.holcomb@holcomb-reyes.invalid",
    },
    "opened_date": "2026-05-01",
    "close_date": None,
}

_HAPPY_CUSTOM_FIELDS = {
    "date_of_incident": "2026-04-28",
    "incident_location": "Intersection of Camelback Rd and 24th St, Phoenix AZ",
    "opposing_carrier": "Saguaro Mutual Insurance Company",
    "opposing_adjuster_email": "lori.mendez@saguaro-mutual.invalid",
    "claim_number": "SM-2026-049182",
    "employer_name": "ABC Manufacturing",
}

_HAPPY_DOCUMENT = {
    "id": "doc_clio_001",
    "filename": "2026-04-28_mercy_general_ed.pdf",
    "size": 184320,
    "content_type": "application/pdf",
    "category": {"id": "cat_med", "name": "Medical Records"},
    "matter": {"id": _HAPPY_MATTER["id"]},
    "created_at": "2026-05-02T09:14:00Z",
    "updated_at": "2026-05-02T09:14:00Z",
}

_HAPPY_CONTACT = {
    "id": "contact_001",
    "name": "Janet Holloway",
    "first_name": "Janet",
    "last_name": "Holloway",
    "primary_email_address": "janet.holloway@example.invalid",
    "primary_phone_number": "+16025551234",
    "addresses": [
        {
            "street": "1234 E Indian School Rd",
            "city": "Phoenix",
            "province": "AZ",
            "postal_code": "85014",
            "country": "US",
        }
    ],
}


def call_clio(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    if tool_name == "clio.matters_list":
        status = args.get("status", "open")
        practice_area = args.get("practice_area")
        matters = [_HAPPY_MATTER]
        if practice_area and practice_area != "Personal Injury":
            matters = []
        if status != "open":
            matters = []
        return {
            "matters": matters,
            "_stub_metadata": {"status": status, "practice_area": practice_area},
        }
    if tool_name == "clio.matters_get":
        matter_id = args.get("matter_id")
        if not matter_id:
            raise StubError("clio.matters_get requires matter_id")
        if matter_id != _HAPPY_MATTER["id"]:
            raise StubNotFoundError(f"matter {matter_id!r} not found")
        return {"matter": _HAPPY_MATTER}
    if tool_name == "clio.matters_custom_fields":
        matter_id = args.get("matter_id")
        if not matter_id:
            raise StubError("clio.matters_custom_fields requires matter_id")
        if matter_id != _HAPPY_MATTER["id"]:
            raise StubNotFoundError(f"matter {matter_id!r} not found")
        return {"custom_fields": _HAPPY_CUSTOM_FIELDS}
    if tool_name == "clio.documents_list":
        matter_id = args.get("matter_id")
        category = args.get("document_category")
        if not matter_id:
            raise StubError("clio.documents_list requires matter_id")
        docs = [_HAPPY_DOCUMENT]
        if category and category != "Medical Records":
            docs = []
        return {
            "documents": docs,
            "_stub_metadata": {"matter_id": matter_id, "category": category},
        }
    if tool_name == "clio.documents_get":
        document_id = args.get("document_id")
        if not document_id:
            raise StubError("clio.documents_get requires document_id")
        if document_id != _HAPPY_DOCUMENT["id"]:
            raise StubNotFoundError(f"document {document_id!r} not found")
        return {"document": _HAPPY_DOCUMENT}
    if tool_name == "clio.contacts_get":
        contact_id = args.get("contact_id")
        if not contact_id:
            raise StubError("clio.contacts_get requires contact_id")
        if contact_id != _HAPPY_CONTACT["id"]:
            raise StubNotFoundError(f"contact {contact_id!r} not found")
        return {"contact": _HAPPY_CONTACT}
    if tool_name in (
        "clio.matters_update",
        "clio.documents_upload",
        "clio.contacts_create",
    ):
        raise StubError(
            f"{tool_name} refused at stub layer — Clio adapter is read-only "
            f"per ADR 0006; trust plugin must block write tools earlier"
        )
    raise StubError(f"unknown clio tool {tool_name!r}")


def force_auth_error(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    raise StubAuthError(
        f"401 Unauthorized: Clio OAuth token expired or invalid (tool={tool_name!r})"
    )
