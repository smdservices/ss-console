-- ============================================================================
-- Migration 0007: persona_observations table (ADR 0016)
-- ============================================================================
--
-- Per-customer table that holds Honcho's persona-influencing observations.
-- Honcho runs in proposer-only mode in the SMD overlay: it never mutates
-- customer.yaml or runtime persona state; every inference lands here and
-- is surfaced for partner-and-Captain review in the calibration session.
--
-- Schema is the authoritative copy from ADR 0016 §1.
--
-- Read discipline (ADR 0016 §2):
--   This table is read ONLY by the calibration-session surface and the
--   decommission-export pipeline. No skill, capability adapter, or
--   signature renderer reads from it. Grep-level CI assertion enforces.
--
-- Write discipline (ADR 0016 §1):
--   The overlay's HonchoInterceptor is the only write path. Honcho's
--   native write paths are blocked at overlay boot.
--
-- Fabrication discipline (ADR 0016 §5):
--   Every observation MUST carry source-evidence pointers. The CHECK
--   constraint below rejects empty or NULL source_evidence_json at the
--   database layer, in addition to the runtime assertion in the
--   interceptor. Belt-and-suspenders by design: an observation without
--   evidence is not a valid observation.
--
-- Privacy posture (ADR 0009):
--   Lives in the per-customer D1 database. No cross-customer table. No
--   row-level customer_id column. Isolation is the binding boundary.
--
-- Compatibility:
--   New objects only. No drops, no column changes, no constraint changes
--   on existing tables.
--
-- Source spec: docs/adr/0016-honcho-disposition.md §1
-- Refers to:   docs/specs/ai-employee/calibration-session.md (#867)
--              docs/specs/ai-employee/audit-log-immutability.md (#892)
--              docs/specs/ai-employee/decommission-customer.md (#820)
-- ============================================================================

-- ---------- Persona observations ----------
-- One row per Honcho observation. Promotion (calibration-session UI) stamps
-- promoted_at/promoted_by/promoted_pr_url and creates a customer.yaml PR;
-- the row itself is the audit-trail anchor. Dismissals are also recorded
-- (never deleted) so the dismissal corpus is available for tuning Honcho's
-- extraction signal over time.
CREATE TABLE persona_observations (
  observation_id        TEXT PRIMARY KEY,
  persona_slug          TEXT,                  -- nullable: customer-scope observations possible
  observation_type      TEXT NOT NULL,         -- voice_drift | recurring_correction | preference_signal | other
  observation_body      TEXT NOT NULL,         -- Honcho's inference, structured JSON
  source_evidence_json  TEXT NOT NULL,         -- transcript span IDs, message IDs, or audit_log row IDs
  confidence            REAL,                  -- Honcho's own confidence value, surfaced for review
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  promoted_at           TEXT,                  -- timestamp of calibration-session promotion
  promoted_by           TEXT,                  -- principal user ID who promoted
  promoted_pr_url       TEXT,                  -- URL of the customer.yaml PR the promotion generated
  dismissed_at          TEXT,                  -- timestamp of dismissal (also a recorded action)
  dismissed_by          TEXT,
  dismissed_reason      TEXT,
  CHECK (source_evidence_json IS NOT NULL AND length(source_evidence_json) > 0)
);

-- Pending observations: the calibration-session surface walks this index.
CREATE INDEX persona_observations_pending
  ON persona_observations (created_at)
  WHERE promoted_at IS NULL AND dismissed_at IS NULL;

-- Per-persona time-ordered scan: powers the calibration UI's per-persona
-- pane and the decommission export.
CREATE INDEX persona_observations_by_persona
  ON persona_observations (persona_slug, created_at);

-- ---------- Schema version ----------
-- 0001 set 1, 0002 set 2, 0003 set 3, 0004 set 4, 0005 set 5, 0006 set 6; this is 7.
PRAGMA user_version = 7;
