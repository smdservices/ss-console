"""Caption provenance allowlist (#1758 item 2).

The tier-2 citation gate's case-name pattern cannot distinguish fabricated
case law from the matter's own caption — 92 false-positive refusals in one
rehearsal day, on the highest-frequency legitimate string in the vertical.
The fix: ``scan``/``contains_citation`` accept ``allowed_case_names``, a
provenance allowlist of captions the caller attests were actually READ this
session. Only bare case-name hits are exempt; fabricated-authority patterns
(reporter cites, statutes, rules) never are.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from citation_filter import canonical_caption, contains_citation, scan  # noqa: E402

CAPTION = "Alvarez v. Draper"


def test_unlisted_caption_still_blocks() -> None:
    assert contains_citation("Deadline proposed on Alvarez v. Draper.")


def test_allowlisted_caption_passes() -> None:
    body = "Discovery capture on Alvarez v. Draper: RFP Set One served by mail."
    assert not contains_citation(body, allowed_case_names=[CAPTION])
    assert scan(body, allowed_case_names=[CAPTION]) == []


def test_allowlist_matches_caption_variants() -> None:
    for variant in (
        "ALVAREZ V. DRAPER",
        "Alvarez v Draper",
        "Alvarez vs. Draper",
        "alvarez  v.  draper",
    ):
        assert not contains_citation(variant, allowed_case_names=[CAPTION]), variant


def test_caption_ending_a_sentence_is_exempt() -> None:
    # The case-name regex swallows the sentence period into the party; the
    # boundary check must not treat punctuation as name continuation.
    body = "Verification chase run on Alvarez v. Draper. No signed document found."
    assert not contains_citation(body, allowed_case_names=[CAPTION])


def test_name_continuation_is_not_exempt() -> None:
    assert contains_citation("Alvarez v. Drapers", allowed_case_names=[CAPTION])
    assert contains_citation("Alvarez v. Draper-Smith", allowed_case_names=[CAPTION])


def test_other_case_names_still_block_alongside_allowlisted() -> None:
    body = "Alvarez v. Draper is our matter; compare Mata v. Avianca."
    assert contains_citation(body, allowed_case_names=[CAPTION])
    hits = scan(body, allowed_case_names=[CAPTION])
    assert any("Mata" in h.match for h in hits)
    assert not any("Alvarez" in h.match and h.pattern == "case-name" for h in hits)


def test_reporter_cite_never_allowlisted() -> None:
    # An allowlisted caption used as fabricated authority still dies on the
    # reporter-cite pattern.
    body = "Alvarez v. Draper, 123 Cal. App. 5th 456 controls here."
    assert contains_citation(body, allowed_case_names=[CAPTION])
    assert any(h.pattern == "reporter-cite" for h in scan(body, allowed_case_names=[CAPTION]))


def test_statutes_and_rules_never_allowlisted() -> None:
    assert contains_citation("See 42 U.S.C. § 1983.", allowed_case_names=[CAPTION])
    assert contains_citation("Per Fed. R. Civ. P. 26(f).", allowed_case_names=[CAPTION])


def test_evasion_normalization_applies_to_allowlist_comparison() -> None:
    # Adversarial spacing in the body still canonicalizes to the allowlisted
    # caption — exempt; and vice versa an evasive NON-listed caption still hits.
    assert not contains_citation("Alvarez v . Draper", allowed_case_names=[CAPTION])
    assert contains_citation("Mata v . Avianca", allowed_case_names=[CAPTION])


def test_empty_or_bad_allowlist_narrows_never_widens() -> None:
    assert contains_citation(CAPTION, allowed_case_names=[])
    assert contains_citation(CAPTION, allowed_case_names=None)
    assert contains_citation(CAPTION, allowed_case_names=["", None])  # type: ignore[list-item]


def test_canonical_caption_folds_separator_and_case() -> None:
    assert canonical_caption("ALVAREZ VS. DRAPER") == canonical_caption("alvarez v draper")
    assert canonical_caption("In re  Ramirez") == "in re ramirez"
