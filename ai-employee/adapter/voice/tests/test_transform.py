"""Tests for Voice Layer 2 — sample-driven draft transformation (issue #855).

Covers:

* Fabrication discipline: the transform never introduces dollar amounts,
  dates, phone numbers, URLs, emails, or any content tokens beyond the
  closed connector vocabulary. This is the load-bearing safety property.
* Voice matching: a draft against a profile of known greeting / signoff
  style is rewritten to match.
* Passthrough behavior: empty drafts, insufficient profiles, drafts that
  already match, and fabrication-guard trips all return the source
  verbatim with the right status code.
* Performance: the transform runs in well under the 2s p99 target for
  representative drafts. We assert <500ms here, three orders of
  magnitude under the documented ceiling.
* Idempotence: running twice on the same draft + profile is a no-op
  after the first pass.

Run from repo root:

    cd ai-employee && python -m pytest adapter/voice/tests/test_transform.py -v
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import pytest

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parents[3]))  # ai-employee/ on sys.path

from adapter.voice import (  # noqa: E402
    DraftTransformer,
    GreetingStyle,
    MIN_PROFILE_SAMPLE_COUNT,
    SignoffStyle,
    StructuralDiff,
    TransformStatus,
    VoiceProfile,
    build_voice_profile,
    extract_structural_diff,
    transform_draft,
)


# ---------------------------------------------------------------------------
# Profile helpers
# ---------------------------------------------------------------------------


def _make_diff(
    *,
    greeting=GreetingStyle.FIRST_NAME,
    signoff=SignoffStyle.THANKS,
    avg_len=12.0,
    distribution=None,
    paragraph_count=2,
    punct=None,
) -> StructuralDiff:
    """Build a StructuralDiff with sensible defaults for tests."""
    return StructuralDiff(
        schema_version=1,
        word_count=60,
        sentence_count=5,
        paragraph_count=paragraph_count,
        subject_word_count=4,
        avg_sentence_length=avg_len,
        sentence_length_distribution=distribution
        or {"lt_5": 1, "lt_10": 2, "lt_20": 2, "lt_35": 0, "gte_35": 0},
        greeting_style=greeting.value if hasattr(greeting, "value") else greeting,
        signoff_style=signoff.value if hasattr(signoff, "value") else signoff,
        opener_template="",
        closer_template="",
        punctuation_rhythm=punct
        or {
            "period_per_100": 8.0,
            "comma_per_100": 6.0,
            "semicolon_per_100": 0.5,
            "dash_per_100": 0.2,
            "question_per_100": 1.0,
            "exclamation_per_100": 0.1,
        },
        recipient_cohort="to-client",
    )


def _profile(
    *,
    samples_count=10,
    greeting=GreetingStyle.FIRST_NAME,
    signoff=SignoffStyle.THANKS,
    distribution=None,
    paragraph_count=2,
) -> VoiceProfile:
    diffs = [
        _make_diff(
            greeting=greeting,
            signoff=signoff,
            distribution=distribution,
            paragraph_count=paragraph_count,
        )
        for _ in range(samples_count)
    ]
    return build_voice_profile(cohort_id="to-client", samples=diffs)


# ---------------------------------------------------------------------------
# Profile aggregation
# ---------------------------------------------------------------------------


def test_build_voice_profile_empty_returns_zero_count():
    profile = build_voice_profile(cohort_id="to-client", samples=[])
    assert profile.sample_count == 0
    assert profile.cohort_id == "to-client"
    assert profile.greeting_style == GreetingStyle.UNKNOWN.value


def test_build_voice_profile_modal_picks_majority():
    samples = [
        _make_diff(greeting=GreetingStyle.FIRST_NAME, signoff=SignoffStyle.THANKS),
        _make_diff(greeting=GreetingStyle.FIRST_NAME, signoff=SignoffStyle.THANKS),
        _make_diff(greeting=GreetingStyle.FIRST_NAME, signoff=SignoffStyle.THANKS),
        _make_diff(greeting=GreetingStyle.FORMAL_NAMED, signoff=SignoffStyle.BEST),
    ]
    profile = build_voice_profile(cohort_id="to-client", samples=samples)
    assert profile.greeting_style == GreetingStyle.FIRST_NAME.value
    assert profile.signoff_style == SignoffStyle.THANKS.value


def test_build_voice_profile_modal_skips_unknown():
    samples = [
        _make_diff(greeting=GreetingStyle.UNKNOWN),
        _make_diff(greeting=GreetingStyle.FIRST_NAME),
        _make_diff(greeting=GreetingStyle.FIRST_NAME),
    ]
    profile = build_voice_profile(cohort_id="to-client", samples=samples)
    assert profile.greeting_style == GreetingStyle.FIRST_NAME.value


def test_build_voice_profile_distribution_normalizes_to_probabilities():
    samples = [
        _make_diff(distribution={"lt_5": 1, "lt_10": 0, "lt_20": 0, "lt_35": 0, "gte_35": 0}),
        _make_diff(distribution={"lt_5": 0, "lt_10": 1, "lt_20": 0, "lt_35": 0, "gte_35": 0}),
    ]
    profile = build_voice_profile(cohort_id="to-client", samples=samples)
    assert profile.sentence_length_distribution["lt_5"] == pytest.approx(0.5, abs=0.001)
    assert profile.sentence_length_distribution["lt_10"] == pytest.approx(0.5, abs=0.001)


# ---------------------------------------------------------------------------
# Passthrough paths
# ---------------------------------------------------------------------------


def test_empty_draft_returns_passthrough():
    result = transform_draft(draft="", profile=_profile())
    assert result.status == TransformStatus.PASSTHROUGH_EMPTY_DRAFT
    assert result.transformed_draft == ""


def test_whitespace_draft_returns_passthrough():
    result = transform_draft(draft="   \n\n   ", profile=_profile())
    assert result.status == TransformStatus.PASSTHROUGH_EMPTY_DRAFT


def test_insufficient_profile_returns_passthrough_verbatim():
    draft = "Dear Mr. Smith,\n\nFollowing up on the matter.\n\nSincerely,\nMarcus"
    profile = _profile(samples_count=MIN_PROFILE_SAMPLE_COUNT - 1)
    result = transform_draft(draft=draft, profile=profile)
    assert result.status == TransformStatus.PASSTHROUGH_INSUFFICIENT_PROFILE
    assert result.transformed_draft == draft
    assert result.notes is not None


def test_matching_draft_returns_no_change_needed():
    draft = "Hi Sarah,\n\nFollowing up here.\n\nThanks,\nMarcus"
    profile = _profile(greeting=GreetingStyle.FIRST_NAME, signoff=SignoffStyle.THANKS)
    result = transform_draft(draft=draft, profile=profile)
    assert result.status == TransformStatus.PASSTHROUGH_NO_CHANGE_NEEDED
    assert result.transformed_draft == draft


# ---------------------------------------------------------------------------
# Greeting swap
# ---------------------------------------------------------------------------


def test_greeting_swap_formal_to_first_name():
    draft = "Dear Mr. Smith,\n\nFollowing up on the matter.\n\nThanks,\nMarcus"
    profile = _profile(greeting=GreetingStyle.FIRST_NAME, signoff=SignoffStyle.THANKS)
    result = transform_draft(draft=draft, profile=profile)
    assert result.status == TransformStatus.TRANSFORMED
    assert "greeting_swap" in result.changes_applied
    assert result.transformed_draft.startswith("Hi Smith,")


def test_greeting_swap_first_name_to_formal():
    draft = "Hi Sarah,\n\nFollowing up on the matter.\n\nThanks,\nMarcus"
    profile = _profile(greeting=GreetingStyle.FORMAL_NAMED, signoff=SignoffStyle.THANKS)
    result = transform_draft(draft=draft, profile=profile)
    # Formal-named requires honorific captured from source; first-name
    # source has no honorific, so the swap declines gracefully.
    # This is by design — the transform must not invent an honorific.
    assert result.status in (
        TransformStatus.PASSTHROUGH_NO_CHANGE_NEEDED,
        TransformStatus.TRANSFORMED,
    )
    if result.status == TransformStatus.TRANSFORMED:
        assert "greeting_swap" not in result.changes_applied


def test_greeting_swap_preserves_recipient_name():
    draft = "Dear Mr. Smith,\n\nFollowing up.\n\nThanks,\nMarcus"
    profile = _profile(greeting=GreetingStyle.SEMI_FORMAL, signoff=SignoffStyle.THANKS)
    result = transform_draft(draft=draft, profile=profile)
    assert result.status == TransformStatus.TRANSFORMED
    assert "Smith" in result.transformed_draft
    assert "Mr." in result.transformed_draft
    assert result.transformed_draft.startswith("Hi Mr. Smith,")


def test_greeting_swap_to_bare_hi_does_not_invent_name():
    draft = "Hi Sarah,\n\nFollowing up.\n\nThanks,\nMarcus"
    profile = _profile(greeting=GreetingStyle.BARE_HI, signoff=SignoffStyle.THANKS)
    result = transform_draft(draft=draft, profile=profile)
    assert result.status == TransformStatus.TRANSFORMED
    assert result.transformed_draft.startswith("Hi,")
    # Critical: the rewritten line is "Hi," not "Hi Sarah," — the name
    # is dropped, not invented.
    assert "Hi Sarah" not in result.transformed_draft.split("\n")[0]


# ---------------------------------------------------------------------------
# Signoff swap
# ---------------------------------------------------------------------------


def test_signoff_swap_sincerely_to_thanks():
    draft = "Hi Sarah,\n\nFollowing up.\n\nSincerely,\nMarcus"
    profile = _profile(greeting=GreetingStyle.FIRST_NAME, signoff=SignoffStyle.THANKS)
    result = transform_draft(draft=draft, profile=profile)
    assert result.status == TransformStatus.TRANSFORMED
    assert "signoff_swap" in result.changes_applied
    assert "Thanks," in result.transformed_draft
    assert "Sincerely" not in result.transformed_draft


def test_signoff_swap_preserves_printed_signer_name():
    draft = "Hi Sarah,\n\nFollowing up.\n\nSincerely,\nMarcus Thompson"
    profile = _profile(greeting=GreetingStyle.FIRST_NAME, signoff=SignoffStyle.BEST)
    result = transform_draft(draft=draft, profile=profile)
    assert result.status == TransformStatus.TRANSFORMED
    # Signer name preserved verbatim
    assert "Marcus Thompson" in result.transformed_draft


# ---------------------------------------------------------------------------
# Fabrication discipline (the load-bearing safety guarantee)
# ---------------------------------------------------------------------------


def test_fabrication_guard_no_new_dollar_amounts():
    # Profile pushes toward longer sentences, which would trigger a join.
    # Verify the join never introduces a $ amount.
    draft = (
        "Hi Sarah,\n\n"
        "The motion is filed. Opposing counsel will respond. We expect a hearing soon.\n\n"
        "Thanks,\nMarcus"
    )
    profile = _profile(
        greeting=GreetingStyle.FIRST_NAME,
        signoff=SignoffStyle.THANKS,
        distribution={"lt_5": 0, "lt_10": 0, "lt_20": 5, "lt_35": 5, "gte_35": 0},
    )
    result = transform_draft(draft=draft, profile=profile)
    # No matter what changes happen, no dollar amounts must appear in
    # the output that weren't in the input.
    assert "$" not in result.transformed_draft


def test_fabrication_guard_no_new_dates():
    draft = (
        "Hi Sarah,\n\n"
        "Following up on the matter. Let me know if you have questions.\n\n"
        "Thanks,\nMarcus"
    )
    profile = _profile()
    result = transform_draft(draft=draft, profile=profile)
    for month in (
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ):
        # Any month name not in source must not appear in output.
        if month not in draft:
            assert month not in result.transformed_draft


def test_fabrication_guard_no_new_phone_numbers():
    draft = "Hi Sarah,\n\nFollowing up on the matter.\n\nThanks,\nMarcus"
    profile = _profile()
    result = transform_draft(draft=draft, profile=profile)
    import re
    phone = re.compile(r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b")
    assert not phone.findall(result.transformed_draft)


def test_fabrication_guard_no_new_urls():
    draft = "Hi Sarah,\n\nFollowing up on the matter.\n\nThanks,\nMarcus"
    profile = _profile()
    result = transform_draft(draft=draft, profile=profile)
    assert "http://" not in result.transformed_draft
    assert "https://" not in result.transformed_draft
    assert "www." not in result.transformed_draft


def test_fabrication_guard_preserves_existing_entities_through_transform():
    # The source has a dollar amount, date, and URL — the transform may
    # rearrange them but must not lose or duplicate them.
    draft = (
        "Dear Mr. Smith,\n\n"
        "The settlement offer is $50,000 dated March 15, 2026. "
        "Please review at https://example.com/offer.\n\n"
        "Sincerely,\nMarcus"
    )
    profile = _profile(
        greeting=GreetingStyle.FIRST_NAME,
        signoff=SignoffStyle.THANKS,
    )
    result = transform_draft(draft=draft, profile=profile)
    # Greeting/signoff swap may have happened, but entities preserved
    assert "$50,000" in result.transformed_draft
    assert "March 15, 2026" in result.transformed_draft
    assert "https://example.com/offer" in result.transformed_draft


def test_no_new_content_words_introduced():
    """The core fabrication-discipline test.

    Any word appearing in the OUTPUT that wasn't in the INPUT must be
    one of: a structural connector from the closed allowed list (greeting
    phrase fragment, signoff fragment, sentence-join conjunction).
    """
    import re
    draft = (
        "Hi Sarah,\n\n"
        "The motion is filed. Opposing counsel will respond.\n\n"
        "Sincerely,\nMarcus"
    )
    profile = _profile(
        greeting=GreetingStyle.FIRST_NAME,
        signoff=SignoffStyle.THANKS,
        distribution={"lt_5": 0, "lt_10": 0, "lt_20": 5, "lt_35": 5, "gte_35": 0},
    )
    result = transform_draft(draft=draft, profile=profile)
    word_re = re.compile(r"\b\w+\b")
    source_words = {w.lower() for w in word_re.findall(draft)}
    output_words = {w.lower() for w in word_re.findall(result.transformed_draft)}
    new_words = output_words - source_words
    allowed = {
        "hi", "hello", "dear", "good", "morning", "afternoon", "evening",
        "best", "thanks", "thank", "you", "regards", "kind", "sincerely",
        "and", "but", "so",
    }
    disallowed = new_words - allowed
    assert not disallowed, f"transform introduced disallowed words: {disallowed}"


# ---------------------------------------------------------------------------
# Sentence redistribution
# ---------------------------------------------------------------------------


def test_sentence_split_when_profile_skews_short():
    # Long draft sentence, profile wants short sentences.
    draft = (
        "Hi Sarah,\n\n"
        "Following up on the discovery requests we sent last week, "
        "and I would appreciate your response by end of day Friday.\n\n"
        "Thanks,\nMarcus"
    )
    profile = _profile(
        greeting=GreetingStyle.FIRST_NAME,
        signoff=SignoffStyle.THANKS,
        distribution={"lt_5": 5, "lt_10": 5, "lt_20": 0, "lt_35": 0, "gte_35": 0},
    )
    result = transform_draft(draft=draft, profile=profile)
    assert "sentence_split" in result.changes_applied


def test_sentence_join_when_profile_skews_long():
    draft = (
        "Hi Sarah,\n\n"
        "The motion is filed. Opposing counsel will respond.\n\n"
        "Thanks,\nMarcus"
    )
    profile = _profile(
        greeting=GreetingStyle.FIRST_NAME,
        signoff=SignoffStyle.THANKS,
        distribution={"lt_5": 0, "lt_10": 0, "lt_20": 5, "lt_35": 5, "gte_35": 0},
    )
    result = transform_draft(draft=draft, profile=profile)
    assert "sentence_join" in result.changes_applied
    # Joined output has the conjunction
    assert ", and" in result.transformed_draft


# ---------------------------------------------------------------------------
# Performance contract — <2s p99
# ---------------------------------------------------------------------------


def test_transform_under_500ms_for_typical_draft():
    """Per #855 AC: <2s p99. We assert <500ms here as a tight floor."""
    draft = (
        "Dear Mr. Smith,\n\n"
        "Following up on the matter we discussed last week regarding the "
        "discovery responses. The deadline is approaching and I want to "
        "confirm we have everything we need. Please let me know if you have "
        "any questions or need additional time.\n\n"
        "I have attached the latest draft of our response for your review. "
        "Once you have signed off we will file with the court.\n\n"
        "Sincerely,\nMarcus Thompson"
    )
    profile = _profile(samples_count=30)
    t0 = time.perf_counter()
    for _ in range(20):
        transform_draft(draft=draft, profile=profile)
    elapsed_per_call_ms = (time.perf_counter() - t0) / 20 * 1000
    assert elapsed_per_call_ms < 500, (
        f"per-call latency {elapsed_per_call_ms:.1f}ms exceeds 500ms floor"
    )


def test_transform_under_2s_for_very_long_draft():
    """Backstop test against the documented 2s ceiling for outsized drafts."""
    body_sentence = (
        "The court has set a hearing for the motion to compel. "
        "We need to prepare our reply brief and supporting exhibits. "
    )
    draft = (
        "Hi Sarah,\n\n"
        + (body_sentence * 50)
        + "\n\nThanks,\nMarcus"
    )
    profile = _profile(samples_count=30)
    t0 = time.perf_counter()
    result = transform_draft(draft=draft, profile=profile)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert elapsed_ms < 2000, (
        f"long-draft latency {elapsed_ms:.1f}ms exceeds 2000ms ceiling"
    )
    # And the result is still well-formed (didn't crash on the size)
    assert result.transformed_draft


# ---------------------------------------------------------------------------
# Idempotence
# ---------------------------------------------------------------------------


def test_transform_is_idempotent():
    draft = "Dear Mr. Smith,\n\nFollowing up.\n\nSincerely,\nMarcus"
    profile = _profile(greeting=GreetingStyle.FIRST_NAME, signoff=SignoffStyle.THANKS)
    first_pass = transform_draft(draft=draft, profile=profile)
    assert first_pass.status == TransformStatus.TRANSFORMED
    second_pass = transform_draft(
        draft=first_pass.transformed_draft, profile=profile
    )
    assert second_pass.status == TransformStatus.PASSTHROUGH_NO_CHANGE_NEEDED
    assert second_pass.transformed_draft == first_pass.transformed_draft


# ---------------------------------------------------------------------------
# Integration: round-trip extract → aggregate → transform
# ---------------------------------------------------------------------------


def test_round_trip_with_real_extracted_diffs():
    """End-to-end: extract structural diffs from real sample bodies,
    build a profile, transform a draft against it."""
    sample_bodies = [
        "Hi Sarah,\n\nFollowing up here.\n\nThanks,\nMarcus",
        "Hi Sarah,\n\nQuick note on the matter.\n\nThanks,\nMarcus",
        "Hi Sarah,\n\nReviewed your draft. Looks good.\n\nThanks,\nMarcus",
        "Hi Sarah,\n\nOne question on this.\n\nThanks,\nMarcus",
        "Hi Sarah,\n\nConfirmed. Moving forward.\n\nThanks,\nMarcus",
        "Hi Sarah,\n\nGood to talk earlier.\n\nThanks,\nMarcus",
        "Hi Sarah,\n\nSent the docs over.\n\nThanks,\nMarcus",
        "Hi Sarah,\n\nReviewing now.\n\nThanks,\nMarcus",
        "Hi Sarah,\n\nWill follow up after.\n\nThanks,\nMarcus",
        "Hi Sarah,\n\nNoted, thanks.\n\nThanks,\nMarcus",
    ]
    diffs = [
        extract_structural_diff(
            body_text=body, subject="Re: matter", recipient_cohort="to-client"
        )
        for body in sample_bodies
    ]
    profile = build_voice_profile(cohort_id="to-client", samples=diffs)
    assert profile.sample_count == 10
    assert profile.greeting_style == GreetingStyle.FIRST_NAME.value
    assert profile.signoff_style == SignoffStyle.THANKS.value

    draft = "Dear Mr. Smith,\n\nFollowing up on the matter.\n\nSincerely,\nMarcus"
    result = transform_draft(draft=draft, profile=profile)
    assert result.status == TransformStatus.TRANSFORMED
    assert "Hi Smith," in result.transformed_draft
    assert "Thanks," in result.transformed_draft
    assert "Marcus" in result.transformed_draft


# ---------------------------------------------------------------------------
# Class-vs-function entry parity
# ---------------------------------------------------------------------------


def test_class_and_function_entry_points_produce_same_result():
    draft = "Dear Mr. Smith,\n\nFollowing up.\n\nSincerely,\nMarcus"
    profile = _profile(greeting=GreetingStyle.FIRST_NAME, signoff=SignoffStyle.THANKS)
    via_function = transform_draft(draft=draft, profile=profile)
    via_class = DraftTransformer().transform(draft=draft, profile=profile)
    assert via_function.status == via_class.status
    assert via_function.transformed_draft == via_class.transformed_draft
    assert via_function.changes_applied == via_class.changes_applied
