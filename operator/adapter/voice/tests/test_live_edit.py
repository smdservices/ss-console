"""Live-edit correction extractor (ADR 0048) — the deterministic capture half.

Covers: a signoff category change yields a content-free correction; no change
yields nothing; a change touching an untemplated (name-bearing) category is
skipped; and the privacy floor holds — body text never leaks into the proposed
before/after.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # operator/ on path

from adapter.voice.live_edit import (  # noqa: E402
    ProposedCorrection,
    extract_live_edit_corrections,
)


def _body(*, greeting: str, sentence: str, signoff: str, name: str) -> str:
    return f"{greeting}\n\n{sentence}\n\n{signoff}\n{name}"


# ---------------------------------------------------------------------------
# Happy path: a signoff change becomes a content-free correction
# ---------------------------------------------------------------------------


def test_signoff_change_yields_correction():
    draft = _body(
        greeting="Dear Mr. Smith,",
        sentence="The deposition is scheduled for Tuesday.",
        signoff="Sincerely,",
        name="Chris",
    )
    sent = _body(
        greeting="Dear Mr. Smith,",
        sentence="The deposition is scheduled for Tuesday.",
        signoff="Best,",
        name="Chris",
    )
    out = extract_live_edit_corrections(
        draft_body=draft, sent_body=sent, recipient_cohort="client"
    )
    assert len(out) == 1
    c = out[0]
    assert isinstance(c, ProposedCorrection)
    assert c.correction_kind == "signoff"
    assert c.pattern_kind == "literal_ci"
    assert c.before_pattern == "Sincerely,"
    assert c.after_text == "Best,"
    assert c.source == "live_edit"
    assert c.recipient_cohort == "client"
    assert c.source_ref  # structural-diff digest of the sent message


def test_no_change_yields_nothing():
    draft = _body(greeting="Hi,", sentence="On track.", signoff="Best,", name="Chris")
    sent = _body(greeting="Hi,", sentence="On track.", signoff="Best,", name="Chris")
    assert extract_live_edit_corrections(
        draft_body=draft, sent_body=sent, recipient_cohort="client"
    ) == []


def test_change_touching_untemplated_category_is_skipped():
    # Sent ends on a bare name line (signoff_style='named') — no clean
    # content-free literal exists, so the change is skipped, not guessed.
    draft = _body(
        greeting="Hi,", sentence="Done.", signoff="Sincerely,", name="Chris"
    )
    sent = "Hi,\n\nDone.\n\nChris Ashton"  # name-only closer → 'named', untemplated
    assert extract_live_edit_corrections(
        draft_body=draft, sent_body=sent, recipient_cohort="client"
    ) == []


# ---------------------------------------------------------------------------
# Privacy floor: no body text ever reaches the proposed correction
# ---------------------------------------------------------------------------


def test_proposal_is_content_free():
    draft = _body(
        greeting="Dear Ms. Vanderberg,",
        sentence="Wire the retainer to account 4471 by Friday.",
        signoff="Regards,",
        name="Christa",
    )
    sent = _body(
        greeting="Dear Ms. Vanderberg,",
        sentence="Wire the retainer to account 4471 by Friday.",
        signoff="Thanks,",
        name="Christa",
    )
    out = extract_live_edit_corrections(
        draft_body=draft, sent_body=sent, recipient_cohort="client"
    )
    assert len(out) == 1
    blob = (out[0].before_pattern + out[0].after_text).lower()
    for leaked in ("vanderberg", "retainer", "4471", "christa", "friday"):
        assert leaked not in blob
    assert out[0].before_pattern == "Regards,"
    assert out[0].after_text == "Thanks,"


def test_scope_fields_propagate():
    draft = _body(greeting="Hi,", sentence="Ok.", signoff="Sincerely,", name="Chris")
    sent = _body(greeting="Hi,", sentence="Ok.", signoff="Best,", name="Chris")
    out = extract_live_edit_corrections(
        draft_body=draft,
        sent_body=sent,
        recipient_cohort="opposing_counsel",
        reviewer_user_id="chris",
    )
    assert len(out) == 1
    assert out[0].reviewer_user_id == "chris"
    assert out[0].recipient_cohort == "opposing_counsel"
