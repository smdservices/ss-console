"""Live-edit correction extractor — the deterministic capture half of A2.

When a `draft_for_review` draft goes out, the human often edits it before
sending. The difference between what the Operator drafted and what the human
actually sent is a *correction*: a deterministic, must-apply preference the
Operator should learn ("you sign off `Best,` not `Sincerely,`"). This module
turns a (draft, sent) pair into proposed ``voice_corrections`` rows
(``source='live_edit'``) — the write-side complement to
:mod:`adapter.voice.corrections` (the read + apply side).

Two hard constraints shape this module (ADR 0048):

* **Content-free (the Voice Layer 2 privacy floor).** A raw body is never
  persisted, and a correction must not smuggle body text out through
  ``before_pattern`` / ``after_text``. So a correction is derived from a change
  in a **closed-set structural category** (``signoff_style``) and rendered
  through a **fixed, non-PII template map** (category → canonical literal). The
  output literals come from this module's constants, never from the input.
* **Deterministic.** Same (draft, sent) produces the same proposals. No model
  calls, no network I/O. Pure module — the D1 loader, supersession, and the
  runtime call site land in the overlay when sent-capture is wired (ADR 0048
  Open Items); this is the canonical primitive they vendor, exactly as
  :mod:`adapter.voice.corrections` is for the read side.

Scope of this version: **signoff** corrections only. Signoff categories are
name-independent closed phrases (`Best,` / `Thanks,` / `Regards,` / `Sincerely,`),
so a category change maps cleanly to a content-free literal substitution.
Greeting corrections are largely name-bearing (`Dear Mr. Smith,`) and cannot be
rendered content-free, so they stay calibration-session-authored; the
machinery here is general (keyed by ``correction_kind``) so a future name-free
greeting story is a template-map addition, not a rewrite. Lexical and honorific
live-edit corrections are out of the privacy-safe floor by construction.

Conservative ethos (matching :mod:`adapter.voice.diff`): when either side of a
change is not a clean content-free phrase, emit nothing rather than guess.
"""

from __future__ import annotations

from dataclasses import dataclass

from .diff import extract_structural_diff, structural_diff_digest

# ---------------------------------------------------------------------------
# Content-free template maps — closed-set category → canonical literal.
#
# These are the ONLY strings that can appear in a proposed correction's
# before/after; they are fixed constants, never drawn from the message body.
# A category absent from a map (e.g. signoff 'named' / 'initial' / 'none' /
# 'unknown', which carry or imply a person's name) has no clean content-free
# literal, so any change touching it is skipped.
# ---------------------------------------------------------------------------

_SIGNOFF_TEMPLATES: dict[str, str] = {
    "best": "Best,",
    "thanks": "Thanks,",
    "regards": "Regards,",
    "sincerely": "Sincerely,",
}

# correction_kind -> (StructuralDiff field, template map). Adding a content-free
# greeting story later is a single entry here.
_KIND_SPECS: tuple[tuple[str, str, dict[str, str]], ...] = (
    ("signoff", "signoff_style", _SIGNOFF_TEMPLATES),
)

_PATTERN_KIND = "literal_ci"
_SOURCE = "live_edit"


@dataclass(frozen=True)
class ProposedCorrection:
    """A ``voice_corrections`` row proposed from one live edit.

    Maps 1:1 onto the migration-0010 columns. ``before_pattern`` / ``after_text``
    are always fixed template constants (never body text). The caller (the
    overlay runtime writer) assigns the row ``id``, applies supersession against
    existing live-edit rows for the same ``(reviewer, cohort, correction_kind)``,
    and performs the D1 insert.
    """

    correction_kind: str  # 'signoff' (closed set per migration 0010)
    pattern_kind: str  # 'literal_ci'
    before_pattern: str  # canonical literal for the draft category
    after_text: str  # canonical literal for the sent category
    source: str  # 'live_edit'
    reviewer_user_id: str | None
    recipient_cohort: str | None
    source_ref: str | None  # structural-diff digest of the sent message


def extract_live_edit_corrections(
    *,
    draft_body: str | None,
    sent_body: str | None,
    recipient_cohort: str,
    reviewer_user_id: str | None = None,
    draft_subject: str | None = None,
    sent_subject: str | None = None,
) -> list[ProposedCorrection]:
    """Propose ``voice_corrections`` rows from one draft→sent edit.

    Computes the structural diff of each body (the privacy primitive — raw text
    is gone when each call returns), compares the closed-set style categories,
    and emits a proposal only when a category genuinely changed AND both sides
    have a clean content-free template. Returns ``[]`` when nothing changed or
    nothing is safely renderable.

    The returned ``source_ref`` is the structural-diff digest of the *sent*
    message, so a row is traceable to the edit that produced it without
    retaining the message.
    """
    draft_diff = extract_structural_diff(
        body_text=draft_body, subject=draft_subject, recipient_cohort=recipient_cohort
    )
    sent_diff = extract_structural_diff(
        body_text=sent_body, subject=sent_subject, recipient_cohort=recipient_cohort
    )
    sent_ref = structural_diff_digest(sent_diff)

    proposals: list[ProposedCorrection] = []
    for correction_kind, field_name, templates in _KIND_SPECS:
        draft_cat = getattr(draft_diff, field_name)
        sent_cat = getattr(sent_diff, field_name)
        if draft_cat == sent_cat:
            continue
        before = templates.get(draft_cat)
        after = templates.get(sent_cat)
        # One side is not a clean content-free phrase (carries/implies a name,
        # or is 'none'/'unknown'): skip rather than guess.
        if before is None or after is None or before == after:
            continue
        proposals.append(
            ProposedCorrection(
                correction_kind=correction_kind,
                pattern_kind=_PATTERN_KIND,
                before_pattern=before,
                after_text=after,
                source=_SOURCE,
                reviewer_user_id=reviewer_user_id,
                recipient_cohort=recipient_cohort,
                source_ref=sent_ref,
            )
        )
    return proposals


__all__ = [
    "ProposedCorrection",
    "extract_live_edit_corrections",
]
