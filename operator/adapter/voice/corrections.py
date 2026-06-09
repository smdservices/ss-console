"""Voice preference corrections — the deterministic half of A2.

A *correction* is an attorney-authored, must-apply substitution preference:
greeting / signoff / honorific / lexical "say X instead of Y" rules captured
from a live edit-then-send diff or a calibration session and stored in the
``voice_corrections`` table (migration 0010). This is **preference capture**,
not semantic "voice learning" — a ``(before -> after)`` rule is a glossary, and
the plan is explicit that semantic/stylistic voice is captured as exemplars
feeding the structural transform, not as rows here.

This module is the read + apply side:

* :class:`Correction` — the in-memory row.
* :func:`select_active` — given the active rows (``superseded_by IS NULL``)
  loaded for a customer, resolve the set that applies to one ``(reviewer,
  cohort)`` draft, with conflict reconciliation by **scope-specificity →
  priority → recency**. Cross-cohort corrections coexist; only rules targeting
  the *same* text conflict.
* :func:`apply_corrections` — apply the selected rules to a draft as guarded
  substitutions. A rule whose substitution would introduce a disallowed
  entity-shaped token (a name/date/amount the source didn't contain) is
  **neutralized** — skipped and recorded — never forced. The guard is injected
  (the transform owns ``_has_introduced_entity_tokens``) so this module
  stays free of a circular import and free of the transform's structural logic.

Pure module: no I/O. The D1 loader and the live runtime call site land in the
overlay (Wave 2); this is the canonical primitive they vendor.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Sequence

# Closed sets mirroring the migration-0010 CHECK constraints.
CORRECTION_KINDS = ("greeting", "signoff", "honorific", "lexical")
PATTERN_KINDS = ("literal", "literal_ci", "regex")
CORRECTION_SOURCES = ("calibration_session", "live_edit")


@dataclass(frozen=True)
class Correction:
    """One attorney-authored substitution preference (a ``voice_corrections`` row).

    ``reviewer_user_id`` / ``recipient_cohort`` of ``None`` mean firm-wide / all
    cohorts respectively. ``priority`` (higher wins) and ``created_at`` (ISO
    string; later wins) break ties between two rules targeting the same text.
    """

    id: str
    correction_kind: str
    pattern_kind: str
    before_pattern: str
    after_text: str
    reviewer_user_id: str | None = None
    recipient_cohort: str | None = None
    priority: int = 0
    source: str = "calibration_session"
    created_at: str = ""


@dataclass(frozen=True)
class CorrectionApplyResult:
    """Outcome of applying a set of corrections to a draft."""

    draft: str
    applied: list = field(default_factory=list)  # list[Correction] that changed the draft
    neutralized: list = field(default_factory=list)  # list[Correction] the guard refused


def _applies_to(c: Correction, reviewer_user_id: str | None, recipient_cohort: str | None) -> bool:
    """A correction applies iff its scope is firm-wide or matches the draft's
    reviewer, AND cohort-agnostic or matches the draft's cohort."""
    reviewer_ok = c.reviewer_user_id is None or c.reviewer_user_id == reviewer_user_id
    cohort_ok = c.recipient_cohort is None or c.recipient_cohort == recipient_cohort
    return reviewer_ok and cohort_ok


def _conflict_key(c: Correction) -> tuple:
    """Two corrections conflict iff they target the same text the same way."""
    target = c.before_pattern.lower() if c.pattern_kind == "literal_ci" else c.before_pattern
    return (c.pattern_kind, target)


def _specificity_rank(c: Correction) -> tuple:
    """Higher tuple wins reconciliation: most-specific scope, then priority, then
    recency. Scope specificity = how many of (reviewer, cohort) are pinned."""
    scope = (c.reviewer_user_id is not None) + (c.recipient_cohort is not None)
    return (scope, c.priority, c.created_at)


def select_active(
    corrections: Sequence[Correction],
    reviewer_user_id: str | None,
    recipient_cohort: str | None,
) -> list:
    """Resolve the corrections that apply to one ``(reviewer, cohort)`` draft.

    ``corrections`` should already be the active set (``superseded_by IS NULL``)
    loaded for the customer. Returns one winner per conflict group (same
    pattern_kind + target text), chosen by scope-specificity → priority →
    recency. Independent rules (different targets) all survive. Result is sorted
    for deterministic application order.
    """
    applicable = [c for c in corrections if _applies_to(c, reviewer_user_id, recipient_cohort)]
    groups: dict[tuple, list] = {}
    for c in applicable:
        groups.setdefault(_conflict_key(c), []).append(c)
    winners = [max(group, key=_specificity_rank) for group in groups.values()]
    return sorted(winners, key=lambda c: (c.before_pattern, c.id))


def _substitute(text: str, c: Correction) -> str:
    """Apply one correction's substitution. ``after_text`` is treated as a
    literal replacement for literal / literal_ci kinds (no backreference
    surprises); a ``regex`` correction's ``after_text`` is used as a real
    re replacement so the firm can author capture-group rewrites. A malformed
    regex is a no-op (the rule is skipped, never crashes the draft path)."""
    if c.pattern_kind == "literal":
        return text.replace(c.before_pattern, c.after_text)
    try:
        if c.pattern_kind == "literal_ci":
            return re.sub(re.escape(c.before_pattern), lambda _m: c.after_text, text, flags=re.IGNORECASE)
        if c.pattern_kind == "regex":
            return re.sub(c.before_pattern, c.after_text, text)
    except re.error:
        return text
    return text


def apply_corrections(
    draft: str,
    corrections: Sequence[Correction],
    guard: Callable[[str, str], bool],
) -> CorrectionApplyResult:
    """Apply ``corrections`` to ``draft`` as guarded substitutions.

    Each correction is applied in turn. A correction that matches nothing is a
    no-op. A correction whose result would introduce a disallowed entity-shaped
    token — per ``guard(before, after) -> bool`` (the transform's
    ``_has_introduced_entity_tokens``) — is **neutralized**: skipped and
    recorded, never forced. This holds a learned preference to the same
    fabrication discipline as the structural transform, and surfaces a
    correction that silently failed to take rather than hiding it.
    """
    current = draft
    applied: list = []
    neutralized: list = []
    for c in corrections:
        candidate = _substitute(current, c)
        if candidate == current:
            continue  # no match → nothing to apply
        if guard(current, candidate):
            neutralized.append(c)
            continue
        current = candidate
        applied.append(c)
    return CorrectionApplyResult(draft=current, applied=applied, neutralized=neutralized)


__all__ = [
    "CORRECTION_KINDS",
    "CORRECTION_SOURCES",
    "PATTERN_KINDS",
    "Correction",
    "CorrectionApplyResult",
    "apply_corrections",
    "select_active",
]
