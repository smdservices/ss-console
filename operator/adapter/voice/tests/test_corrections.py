"""Voice preference corrections — reconciliation + guarded application (A2).

select_active: scope filtering + conflict reconciliation (scope-specificity →
priority → recency) + cross-cohort coexistence. apply_corrections: literal /
literal_ci / regex substitution, and — using the REAL transform fabrication
guard — neutralization of any rule that would introduce a disallowed entity.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))  # operator/ on path

from adapter.voice.corrections import (  # noqa: E402
    Correction,
    apply_corrections,
    select_active,
)
from adapter.voice.transform import _has_introduced_entity_tokens  # noqa: E402


def _c(**over) -> Correction:
    base = dict(
        id="c0",
        correction_kind="lexical",
        pattern_kind="literal_ci",
        before_pattern="pursuant to",
        after_text="under",
        reviewer_user_id=None,
        recipient_cohort=None,
        priority=0,
        source="calibration_session",
        created_at="2026-06-01T00:00:00Z",
    )
    base.update(over)
    return Correction(**base)


# ---------------------------------------------------------------------------
# select_active — scope filtering
# ---------------------------------------------------------------------------


def test_firm_wide_rule_applies_to_everyone():
    rules = [_c(id="a", reviewer_user_id=None, recipient_cohort=None)]
    assert len(select_active(rules, "avery", "client")) == 1


def test_reviewer_scoped_rule_does_not_apply_to_other_reviewer():
    rules = [_c(id="a", reviewer_user_id="avery")]
    assert select_active(rules, "jordan", "client") == []
    assert len(select_active(rules, "avery", "client")) == 1


def test_cohort_scoped_rule_does_not_apply_to_other_cohort():
    rules = [_c(id="a", recipient_cohort="opposing-counsel")]
    assert select_active(rules, "avery", "client") == []
    assert len(select_active(rules, "avery", "opposing-counsel")) == 1


def test_independent_rules_all_survive():
    rules = [
        _c(id="a", before_pattern="pursuant to", after_text="under"),
        _c(id="b", before_pattern="hereinafter", after_text="from now on"),
    ]
    out = select_active(rules, "avery", "client")
    assert {c.id for c in out} == {"a", "b"}


# ---------------------------------------------------------------------------
# select_active — reconciliation (scope-specificity → priority → recency)
# ---------------------------------------------------------------------------


def test_more_specific_scope_wins_over_firm_wide():
    rules = [
        _c(id="firm", after_text="under", reviewer_user_id=None, recipient_cohort=None),
        _c(id="scoped", after_text="per", reviewer_user_id="avery", recipient_cohort="client"),
    ]
    out = select_active(rules, "avery", "client")
    assert len(out) == 1 and out[0].id == "scoped"


def test_priority_breaks_tie_at_equal_scope():
    rules = [
        _c(id="low", after_text="under", priority=1),
        _c(id="high", after_text="per", priority=5),
    ]
    out = select_active(rules, "avery", "client")
    assert len(out) == 1 and out[0].id == "high"


def test_recency_breaks_tie_at_equal_scope_and_priority():
    rules = [
        _c(id="old", after_text="under", created_at="2026-06-01T00:00:00Z"),
        _c(id="new", after_text="per", created_at="2026-06-08T00:00:00Z"),
    ]
    out = select_active(rules, "avery", "client")
    assert len(out) == 1 and out[0].id == "new"


def test_cross_cohort_opposing_rules_coexist():
    """A client-cohort rule and an opposing-counsel-cohort rule on the same text
    do NOT conflict — each applies in its lane."""
    rules = [
        _c(id="client", before_pattern="Dear", after_text="Hi", recipient_cohort="client"),
        _c(id="oc", before_pattern="Dear", after_text="Counsel,", recipient_cohort="opposing-counsel"),
    ]
    assert [c.id for c in select_active(rules, "avery", "client")] == ["client"]
    assert [c.id for c in select_active(rules, "avery", "opposing-counsel")] == ["oc"]


# ---------------------------------------------------------------------------
# apply_corrections — substitution + the guard
# ---------------------------------------------------------------------------


def test_literal_ci_substitution_applies():
    rules = [_c(before_pattern="pursuant to", after_text="under", pattern_kind="literal_ci")]
    res = apply_corrections("Pursuant to the agreement, we will file.", rules, _has_introduced_entity_tokens)
    assert res.draft == "under the agreement, we will file."
    assert len(res.applied) == 1 and not res.neutralized


def test_literal_substitution_is_case_sensitive():
    rules = [_c(before_pattern="Re:", after_text="Subject:", pattern_kind="literal")]
    res = apply_corrections("Re: your matter", rules, _has_introduced_entity_tokens)
    assert res.draft == "Subject: your matter"


def test_regex_substitution_with_capture_group():
    rules = [_c(before_pattern=r"\bthx\b", after_text="thanks", pattern_kind="regex")]
    res = apply_corrections("ok thx", rules, _has_introduced_entity_tokens)
    assert res.draft == "ok thanks"


def test_no_match_is_a_noop():
    rules = [_c(before_pattern="nonexistent phrase", after_text="x")]
    res = apply_corrections("a clean draft", rules, _has_introduced_entity_tokens)
    assert res.draft == "a clean draft"
    assert not res.applied and not res.neutralized


def test_correction_that_introduces_a_date_is_neutralized():
    """The guard reuse: a rule whose replacement injects an entity-shaped token
    (here a date) is neutralized, not forced — and recorded so a silently-failed
    correction is visible."""
    rules = [_c(before_pattern="soon", after_text="on June 8, 2026", pattern_kind="literal_ci")]
    res = apply_corrections("We will follow up soon.", rules, _has_introduced_entity_tokens)
    assert res.draft == "We will follow up soon."  # unchanged
    assert not res.applied
    assert len(res.neutralized) == 1


def test_malformed_regex_is_a_safe_noop():
    rules = [_c(before_pattern="(unclosed", after_text="x", pattern_kind="regex")]
    res = apply_corrections("text with (unclosed literally", rules, _has_introduced_entity_tokens)
    assert res.draft == "text with (unclosed literally"
    assert not res.applied and not res.neutralized


def test_multiple_corrections_apply_in_order():
    rules = [
        _c(id="a", before_pattern="pursuant to", after_text="under", pattern_kind="literal_ci"),
        _c(id="b", before_pattern="hereinafter", after_text="from now on", pattern_kind="literal_ci"),
    ]
    res = apply_corrections("Pursuant to it, hereinafter the Firm.", rules, _has_introduced_entity_tokens)
    assert res.draft == "under it, from now on the Firm."
    assert len(res.applied) == 2
