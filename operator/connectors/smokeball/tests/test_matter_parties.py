"""Unit coverage for ``parties`` / ``parties_complete`` (ss#2167).

The outbound matter-identity gate answers one question — "is this recipient a
party to the matter this letter is about?" — and it needs the parties' ADDRESSES
to do it. This module locks the contract the gate depends on.

The load-bearing rule under test is the one the design review flagged as the way
this control could produce confident wrong output: **an unresolved party must
never be indistinguishable from a genuine non-party.** A budget-truncated or
failed lookup that read as "not a party" would withhold a CORRECT send and tell a
reviewer the recipient was an outsider. So every partial resolution sets
``parties_complete: False``, and the gate treats anything short of an explicit
True as *membership unresolved*.

No live Smokeball calls: an ``httpx.MockTransport`` is injected so the real
resolution logic runs against scripted responses.
"""

from __future__ import annotations

import httpx

from smokeball_connector import server as srv
from smokeball_connector.client import SmokeballClient


def _mock_client(handler) -> SmokeballClient:
    client = SmokeballClient(
        region="us", environment="staging", client_id="cid", client_secret="sec", api_key="apikey"
    )
    client._http = httpx.Client(transport=httpx.MockTransport(handler))
    return client


def _contacts_handler(contacts: dict[str, dict], captured: list[httpx.Request] | None = None):
    def handler(request: httpx.Request) -> httpx.Response:
        if captured is not None:
            captured.append(request)
        path = request.url.path
        if path.endswith("/oauth2/token"):
            return httpx.Response(
                200, json={"access_token": "tok", "expires_in": 3600, "token_type": "Bearer"}
            )
        if "/contacts/" in path:
            cid = path.rsplit("/", 1)[-1]
            if cid in contacts:
                return httpx.Response(200, json=contacts[cid])
            return httpx.Response(404, json={"error": "not found"})
        return httpx.Response(200, json={"ok": True})

    return handler


def _person(last: str, email: str | None = None, roles: list[str] | None = None) -> dict:
    person: dict = {"firstName": "Given", "lastName": last}
    if email is not None:
        person["email"] = email
    out: dict = {"person": person}
    if roles is not None:
        out["tags"] = [{"name": r, "type": "Role"} for r in roles]
    return out


def _matter() -> dict:
    return {
        "clientIds": ["c1"],
        "otherSideIds": ["d1"],
        "matterType": {"name": "Personal Injury - Plaintiff"},
    }


# ---- the happy path -------------------------------------------------------


def test_parties_carry_address_side_and_roles() -> None:
    client = _mock_client(
        _contacts_handler(
            {
                "c1": _person("Bell", "t.bell@example.com", ["Plaintiff", "Client"]),
                "d1": _person("Draper", "d.draper@example.com", ["Defendant"]),
            }
        )
    )
    matter = _matter()
    srv._attach_parties(client, matter)

    assert matter["parties_complete"] is True
    by_id = {p["contact_id"]: p for p in matter["parties"]}
    assert by_id["c1"]["email"] == "t.bell@example.com"
    assert by_id["c1"]["side"] == "client"
    assert by_id["c1"]["roles"] == ["Plaintiff", "Client"]
    assert by_id["d1"]["side"] == "other_side"


def test_addresses_are_lowercased_for_recipient_comparison() -> None:
    # Recipients arrive normalized/lower-cased; membership must compare equal.
    client = _mock_client(
        _contacts_handler({"c1": _person("Bell", "T.Bell@Example.COM"), "d1": _person("D", "d@x.io")})
    )
    matter = _matter()
    srv._attach_parties(client, matter)
    assert {p["email"] for p in matter["parties"]} == {"t.bell@example.com", "d@x.io"}


# ---- unresolved must never read as non-membership -------------------------


def test_failed_lookup_marks_incomplete_rather_than_dropping_silently() -> None:
    # d1 404s. The gate must not conclude "d1's address is not a party".
    client = _mock_client(_contacts_handler({"c1": _person("Bell", "b@x.io")}))
    matter = _matter()
    srv._attach_parties(client, matter)
    assert matter["parties_complete"] is False


def test_party_without_an_address_marks_incomplete() -> None:
    # A party we cannot address cannot be matched against a recipient, so the set
    # is not a sound basis for a non-membership verdict.
    client = _mock_client(
        _contacts_handler({"c1": _person("Bell", "b@x.io"), "d1": _person("Draper")})
    )
    matter = _matter()
    srv._attach_parties(client, matter)
    assert matter["parties_complete"] is False


def test_party_less_matter_attaches_nothing_at_all() -> None:
    # Absent reads as unresolved. An empty parties list with complete=True would
    # mean "nobody is a party", which would withhold every send on this matter
    # while claiming the recipient is an outsider.
    client = _mock_client(_contacts_handler({}))
    matter = {"matterType": {"name": "Personal Injury - Plaintiff"}}
    srv._attach_parties(client, matter)
    assert "parties" not in matter
    assert "parties_complete" not in matter


def test_enrichment_never_breaks_the_read() -> None:
    class Boom:
        def get(self, *a, **k):
            raise RuntimeError("vendor down")

    matter = _matter()
    srv._attach_parties(Boom(), matter)  # must not raise
    assert "parties" not in matter  # absent, never partial


# ---- the list path must not produce membership ----------------------------


def test_list_path_attaches_no_parties() -> None:
    # _CAPTION_MAX_LOOKUPS bounds the list path, and a truncated party set is
    # byte-identical to a complete one. Only the unbounded single-matter read
    # may produce membership.
    client = _mock_client(
        _contacts_handler({"c1": _person("Bell", "b@x.io"), "d1": _person("Draper", "d@x.io")})
    )
    resp = {"value": [_matter()]}
    srv._attach_captions_to_list(client, resp)
    assert "parties" not in resp["value"][0]
    assert "parties_complete" not in resp["value"][0]


def test_budget_exhaustion_is_not_cached_as_a_resolved_fact() -> None:
    # A budget miss must stay unresolved so a later unbounded read can resolve it;
    # caching None would freeze "unknown" into the session as though it were known.
    client = _mock_client(_contacts_handler({"c1": _person("Bell", "b@x.io")}))
    cache: dict[str, dict | None] = {}
    assert srv._resolve_party(client, "c1", cache, [0]) is None
    assert "c1" not in cache
    assert srv._resolve_party(client, "c1", cache, None) is not None


# ---- the caption path is unchanged ----------------------------------------


def test_caption_still_composes_from_the_shared_fetch() -> None:
    captured: list[httpx.Request] = []
    client = _mock_client(
        _contacts_handler(
            {"c1": _person("Alvarez", "a@x.io"), "d1": _person("Draper", "d@x.io")}, captured
        )
    )
    matter = _matter()
    srv._attach_caption(client, matter)
    assert matter["caption"] == "Alvarez v. Draper"
    # One fetch per party — membership rides the caption's existing calls.
    assert len([r for r in captured if "/contacts/" in r.url.path]) == 2
