"""Recipient-classifier tests — the outbound internal/external gate.

Deterministic, pure. The load-bearing assertions are the SPOOF vectors: a loose
match here is a path to an autonomous send to an attacker-controlled address, so
each canonicalization rule has an adversarial test. UNKNOWN must never silently
mean "internal" and must never be swallowed into a draft — it is the caller's
hard-error signal (that silent default was the "nothing ever sends" bug, in
reverse).
"""

from __future__ import annotations

import sys
from pathlib import Path

# operator/ root, so `adapter.*` imports resolve.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest  # noqa: E402

from adapter.recipient_classifier import (  # noqa: E402
    ACTION_CLASS_EXTERNAL_SEND,
    ACTION_CLASS_EXTERNAL_SEND_INTERNAL,
    RecipientClass,
    UnclassifiedRecipientError,
    classify_recipient,
    classify_recipients,
    send_action_class,
)

ROSTER = ["@ashtonandprice.com", "scott@smd.services"]


# ---- core behaviour -------------------------------------------------------

def test_exact_address_match_is_internal():
    assert classify_recipient("scott@smd.services", ROSTER) is RecipientClass.INTERNAL


def test_domain_entry_matches_any_local_part():
    assert classify_recipient("chris@ashtonandprice.com", ROSTER) is RecipientClass.INTERNAL
    assert classify_recipient("christa@ashtonandprice.com", ROSTER) is RecipientClass.INTERNAL


def test_non_roster_recipient_is_outside():
    assert classify_recipient("client@example.com", ROSTER) is RecipientClass.OUTSIDE


def test_case_insensitive_match():
    assert classify_recipient("Scott@SMD.Services", ROSTER) is RecipientClass.INTERNAL
    assert classify_recipient("CHRIS@AshtonAndPrice.com", ROSTER) is RecipientClass.INTERNAL


# ---- SPOOF vectors (load-bearing) -----------------------------------------

def test_plus_tag_is_not_widened_for_full_address_entry():
    # scott+anything@ must NOT match the full-address roster entry scott@.
    assert classify_recipient("scott+evil@smd.services", ROSTER) is RecipientClass.OUTSIDE


def test_plus_tag_still_matches_a_whole_domain_grant():
    # But it IS genuinely on the ashtonandprice.com domain, which is granted.
    assert classify_recipient("chris+tag@ashtonandprice.com", ROSTER) is RecipientClass.INTERNAL


def test_parent_domain_lookalike_is_outside():
    # attacker registers ashtonandprice.com.evil.com — exact domain equality blocks it.
    assert classify_recipient("x@ashtonandprice.com.evil.com", ROSTER) is RecipientClass.OUTSIDE


def test_subdomain_is_not_widened_to_parent_grant():
    # @ashtonandprice.com grants the apex only, not mail.ashtonandprice.com.
    assert classify_recipient("x@mail.ashtonandprice.com", ROSTER) is RecipientClass.OUTSIDE


def test_display_name_form_is_unknown_not_parsed():
    # "Scott <scott@smd.services>" must not match on the address inside — reject it.
    assert classify_recipient("Scott <scott@smd.services>", ROSTER) is RecipientClass.UNKNOWN


def test_address_list_in_one_string_is_unknown():
    assert (
        classify_recipient("scott@smd.services, evil@x.com", ROSTER)
        is RecipientClass.UNKNOWN
    )


def test_garbage_and_empty_are_unknown():
    for bad in ["", "   ", "not-an-email", "@nodomain", "no-at-sign.com", "a@b"]:
        assert classify_recipient(bad, ROSTER) is RecipientClass.UNKNOWN, bad


def test_homoglyph_domain_does_not_match_ascii_roster():
    # Cyrillic 'а' (U+0430) in the domain is a different string — never internal.
    homoglyph = "scott@smd.serviсеs"  # с and е are Cyrillic
    assert classify_recipient(homoglyph, ROSTER) is not RecipientClass.INTERNAL


# ---- tainted provenance ---------------------------------------------------

def test_tainted_recipient_matching_roster_is_outside_never_internal():
    # An injected "send to scott@smd.services" must not ride the roster to autonomous.
    assert (
        classify_recipient("scott@smd.services", ROSTER, from_tainted=True)
        is RecipientClass.OUTSIDE
    )


def test_tainted_unresolvable_is_still_unknown():
    assert (
        classify_recipient("garbage", ROSTER, from_tainted=True)
        is RecipientClass.UNKNOWN
    )


# ---- multi-recipient aggregation (most-restrictive wins) -------------------

def test_all_internal_recipients_aggregate_internal():
    rs = ["scott@smd.services", "chris@ashtonandprice.com"]
    assert classify_recipients(rs, ROSTER) is RecipientClass.INTERNAL


def test_any_outside_recipient_makes_the_send_outside():
    rs = ["scott@smd.services", "client@example.com"]
    assert classify_recipients(rs, ROSTER) is RecipientClass.OUTSIDE


def test_any_unknown_recipient_makes_the_send_unknown_hard_error():
    rs = ["scott@smd.services", "Scott <scott@smd.services>"]
    assert classify_recipients(rs, ROSTER) is RecipientClass.UNKNOWN


def test_empty_recipient_list_is_unknown():
    assert classify_recipients([], ROSTER) is RecipientClass.UNKNOWN


def test_roster_iterable_not_exhausted_across_recipients():
    # A one-shot generator roster must be materialised, not consumed on recipient #1.
    roster_gen = (e for e in ROSTER)
    rs = ["client@example.com", "scott@smd.services"]
    assert classify_recipients(rs, roster_gen) is RecipientClass.OUTSIDE


def test_malformed_roster_entry_never_widens_a_match():
    bad_roster = ["not-a-roster-line", "@", "@evil", "scott@smd.services"]
    assert classify_recipient("scott@smd.services", bad_roster) is RecipientClass.INTERNAL
    # "@evil" is a malformed single-label roster entry; it must not grant the
    # evil.com domain (or any domain). A valid outside address stays OUTSIDE.
    assert classify_recipient("anyone@evil.com", bad_roster) is RecipientClass.OUTSIDE


# ---- the fail-closed router (UNKNOWN → hard error, never a draft) ----------

def test_router_internal_maps_to_external_send_internal():
    assert send_action_class(RecipientClass.INTERNAL) == ACTION_CLASS_EXTERNAL_SEND_INTERNAL


def test_router_outside_maps_to_external_send():
    assert send_action_class(RecipientClass.OUTSIDE) == ACTION_CLASS_EXTERNAL_SEND


def test_router_unknown_is_a_hard_error_not_a_draft():
    # The keystone anti-regression guarantee: an unresolved recipient stops loudly.
    with pytest.raises(UnclassifiedRecipientError):
        send_action_class(RecipientClass.UNKNOWN)
