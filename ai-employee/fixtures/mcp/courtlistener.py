"""Stub for mcp:courtlistener (Free Law Project's hosted MCP).

Documented tools (subset):

  - courtlistener.search_dockets(query, court=None, date_filed_after=None,
      max_results=10) -> {dockets: [...]}
  - courtlistener.get_docket(docket_id) -> {docket: {...}}
  - courtlistener.search_opinions(query, court=None, max_results=10) ->
      {opinions: [...]}
  - courtlistener.get_opinion(opinion_id) -> {opinion: {...}}

CourtListener is read-only by API design — there are no write tools to
refuse. The trust plugin still applies content-class ceilings on what
the agent does with the returned data (e.g., citation refusal substrate
on case names in opinions).

Canonical response shape derived from CourtListener REST API v3
(``/rest/v3/dockets/`` and ``/rest/v3/opinions/``).
"""

from __future__ import annotations

from typing import Any

from . import StubAuthError, StubError, StubNotFoundError


_HAPPY_DOCKET = {
    "id": 9876543,
    "court": "azd",
    "court_id": "azd",
    "case_name": "Holloway v. Kerr",
    "case_name_short": "Holloway",
    "case_name_full": "Janet Holloway v. David Kerr et al.",
    "docket_number": "2:26-cv-01234-PHX",
    "date_filed": "2026-05-10",
    "date_terminated": None,
    "nature_of_suit": "Motor Vehicle Personal Injury",
    "absolute_url": "/docket/9876543/holloway-v-kerr/",
}

_HAPPY_OPINION = {
    "id": 1234567,
    "absolute_url": "/opinion/1234567/example-v-example/",
    "cluster": {"case_name": "Example v. Example"},
    "type": "010combined",
    "html": "<p>This is the stubbed opinion body.</p>",
    "plain_text": "This is the stubbed opinion body.",
    "date_created": "2024-03-15T10:00:00Z",
}


def call_courtlistener(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    if tool_name == "courtlistener.search_dockets":
        query = args.get("query", "")
        court = args.get("court")
        max_results = int(args.get("max_results", 10))
        if not query:
            raise StubError("courtlistener.search_dockets requires a query")
        dockets = [_HAPPY_DOCKET][:max_results]
        if court and court != _HAPPY_DOCKET["court"]:
            dockets = []
        return {
            "count": len(dockets),
            "dockets": dockets,
            "_stub_metadata": {"query": query, "court": court},
        }
    if tool_name == "courtlistener.get_docket":
        docket_id = args.get("docket_id")
        if docket_id is None:
            raise StubError("courtlistener.get_docket requires docket_id")
        if int(docket_id) != _HAPPY_DOCKET["id"]:
            raise StubNotFoundError(f"docket {docket_id!r} not found")
        return {"docket": _HAPPY_DOCKET}
    if tool_name == "courtlistener.search_opinions":
        query = args.get("query", "")
        max_results = int(args.get("max_results", 10))
        if not query:
            raise StubError("courtlistener.search_opinions requires a query")
        return {
            "count": 1,
            "opinions": [_HAPPY_OPINION][:max_results],
            "_stub_metadata": {"query": query},
        }
    if tool_name == "courtlistener.get_opinion":
        opinion_id = args.get("opinion_id")
        if opinion_id is None:
            raise StubError("courtlistener.get_opinion requires opinion_id")
        if int(opinion_id) != _HAPPY_OPINION["id"]:
            raise StubNotFoundError(f"opinion {opinion_id!r} not found")
        return {"opinion": _HAPPY_OPINION}
    raise StubError(f"unknown courtlistener tool {tool_name!r}")


def force_auth_error(tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
    raise StubAuthError(
        f"401 Unauthorized: CourtListener API key invalid (tool={tool_name!r})"
    )
