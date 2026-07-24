"""get_contacts search normalization (#1642).

The /contacts endpoint requires field:operator:value search expressions; a bare
term is an HTTP 400 ("Invalid search term 'Johnson'."), and three consecutive
400s trip the whole MCP breaker mid-turn. _contact_search_terms auto-wraps bare
terms as a case-insensitive name contains-search so the natural call succeeds.
Contracts live-verified against the staging tenant 2026-07-03:
  /contacts  search="Johnson"        -> 400
  /contacts  search="name:*johnson*" -> 200, 1 result
  /matters   search="Johnson"        -> 200, 1 result (plain-keyword contract)
"""

from smokeball_connector.server import _contact_search_terms


def test_none_passes_through() -> None:
    assert _contact_search_terms(None) is None


def test_bare_term_wrapped_as_name_contains() -> None:
    assert _contact_search_terms("Johnson") == ["name:*Johnson*"]


def test_structured_term_passes_through() -> None:
    assert _contact_search_terms("name:*johnson*") == ["name:*johnson*"]


def test_operator_terms_pass_through() -> None:
    assert _contact_search_terms("name:!*Hunter*") == ["name:!*Hunter*"]


def test_list_mixes_wrapped_and_structured() -> None:
    assert _contact_search_terms(["Johnson", "type:person"]) == [
        "name:*Johnson*",
        "type:person",
    ]


def test_whitespace_and_empty_terms_dropped() -> None:
    assert _contact_search_terms(["  ", ""]) is None
    assert _contact_search_terms(" Johnson ") == ["name:*Johnson*"]
