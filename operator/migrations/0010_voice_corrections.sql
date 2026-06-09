-- ============================================================================
-- Migration 0010: voice_corrections table (A2 — preference capture)
-- ============================================================================
--
-- Per-customer table holding DETERMINISTIC voice preferences an attorney taught
-- the Operator: greeting / signoff / honorific / lexical phrase substitutions
-- the firm wants applied to drafts. This is "preference capture," NOT semantic
-- "voice learning" — a (before -> after) substitution is a glossary, and the
-- plan is explicit that semantic/stylistic voice is captured as exemplars
-- feeding the structural transform + blind-test harness, not as rows here.
--
-- Why a dedicated table, not persona_observations / Honcho (migration 0007):
--   * Honcho is off the boot path in Phase 1 (ADR 0016 revision) — a correction
--     loop built on it would not run for customer-zero. Disqualifying.
--   * persona_observations mirrors Honcho's INFERRED conclusions and its own
--     read-discipline comment forbids agent-runtime reads ("No skill ... reads
--     from this table at agent runtime"). A correction the transform must APPLY
--     at runtime is exactly a runtime read. Reusing it violates that contract.
--   Corrections are deterministic, attorney-AUTHORED, must-apply facts — the
--   opposite of Honcho's inferred, reviewable conclusions.
--
-- Capture (two seams, both writers land in later PRs):
--   * live edit-then-send — the voice pipeline diffs an agent draft against the
--     attorney's sent version (source='live_edit').
--   * calibration session #2 — attorney edits + stated rules (source=
--     'calibration_session'), gated on #821.
--
-- Runtime application: adapter/voice/corrections.py::select_active resolves the
-- active set for a (reviewer, cohort) by scope-specificity -> priority ->
-- recency, and the transform applies them as a guarded pre-pass (a substitution
-- that would introduce a disallowed entity is neutralized, never forced).
--
-- Reconciliation: a correction overridden by a newer/more-specific one has its
-- `superseded_by` set to the winner's id (an auditable, restorable chain — this
-- is also the substrate for Track-C "wrong-learned-rule governance"). Active =
-- superseded_by IS NULL. Cross-cohort corrections coexist (a client-cohort and
-- an opposing-counsel-cohort rule do not conflict).
--
-- Privacy posture (ADR 0009): per-customer D1; isolation is the binding
-- boundary. `customer_slug` denormalized for query ergonomics (per 0007).
-- Forward-only (migrations README): no rollback path.
-- ============================================================================

CREATE TABLE voice_corrections (
  id               TEXT PRIMARY KEY,                          -- ULID
  customer_slug    TEXT NOT NULL,
  correction_kind  TEXT NOT NULL,                             -- label (closed set)
  pattern_kind     TEXT NOT NULL,                             -- how before_pattern matches
  before_pattern   TEXT NOT NULL,                             -- what to detect
  after_text       TEXT NOT NULL,                             -- the replacement
  reviewer_user_id TEXT,                                      -- voice_profile_id slug; NULL = firm-wide
  recipient_cohort TEXT,                                      -- cohort scope; NULL = all cohorts
  priority         INTEGER NOT NULL DEFAULT 0,                -- tiebreak; higher wins
  source           TEXT NOT NULL,                             -- where the correction came from
  source_ref       TEXT,                                      -- calibration_cycle_id / sent-message digest
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_by    TEXT,                                      -- id of the correction that overrode this one
  active           BOOLEAN GENERATED ALWAYS AS (superseded_by IS NULL) VIRTUAL,
  CHECK (correction_kind IN ('greeting', 'signoff', 'honorific', 'lexical')),
  CHECK (pattern_kind IN ('literal', 'literal_ci', 'regex')),
  CHECK (source IN ('calibration_session', 'live_edit'))
);

-- Runtime selection: the active corrections for a (reviewer, cohort). The
-- transform's pre-pass walks this; the partial predicate bounds it to the
-- live set (generated columns cannot appear in a partial-index predicate, so
-- the physical superseded_by predicate is used, per 0007's convention).
CREATE INDEX voice_corrections_active_scope
  ON voice_corrections (reviewer_user_id, recipient_cohort)
  WHERE superseded_by IS NULL;

-- Audit / export / the supersession chain walk.
CREATE INDEX voice_corrections_by_created
  ON voice_corrections (customer_slug, created_at);

-- ---------- Schema version ----------
PRAGMA user_version = 10;
