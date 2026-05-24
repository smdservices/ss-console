-- ============================================================================
-- Migration 0008: skill_drafts table (ADR 0017)
-- ============================================================================
--
-- Per-customer table that holds the Hermes autonomous Skill Curator's
-- observation output. The Curator runs in observer-only mode in the SMD
-- overlay: it never creates, modifies, consolidates, or prunes skills
-- inside a customer Machine. Every catalog change is a PR against
-- crane-console/.agents/skills/, reviewed and merged per established
-- skill governance, reaching customer Machines only through the next
-- content-hash-pinned Hermes deploy.
--
-- Schema is the authoritative copy from ADR 0017 §1.
--
-- Read discipline:
--   This table is read ONLY by the calibration-session surface and the
--   decommission-export pipeline. Runtime skill dispatch reads the
--   content-hash-pinned skill set per ADR 0007 — never this table.
--
-- Write discipline (ADR 0017 §1):
--   The overlay's CuratorInterceptor is the only write path. The Curator's
--   native write paths (skill file mutation, in-memory skill-set mutation)
--   are blocked at overlay boot. The interceptor is mandatory; Machine
--   boot fails if the interception surface check fails.
--
-- No self-promotion (ADR 0017 §10):
--   This is structural, not behavioral: no promotion path in code other
--   than the calibration-session UI calling CuratorInterceptor.promote().
--   The promotion handler opens a crane-console PR; the row is stamped
--   only after the PR URL is supplied. Auto-promotion code paths fail
--   review.
--
-- Fabrication discipline (ADR 0017 §6):
--   Every draft MUST carry source-evidence pointers. The CHECK constraint
--   below rejects empty or NULL source_evidence_json at the database
--   layer, in addition to the runtime assertion in the interceptor.
--   Belt-and-suspenders by design: a draft without evidence is not a
--   valid draft.
--
-- Cross-customer prohibition (ADR 0009 + ADR 0017 §11):
--   The Curator running in customer A's Machine cannot observe customer B's
--   execution traces. This table is per-customer; isolation is the binding
--   boundary, not a row-level customer_id column.
--
-- Compatibility:
--   New objects only. No drops, no column changes, no constraint changes
--   on existing tables.
--
-- Source spec: docs/adr/0017-skill-curator-disposition.md §1
-- Refers to:   docs/specs/ai-employee/calibration-session.md (#867)
--              docs/specs/ai-employee/audit-log-immutability.md (#892)
--              docs/specs/ai-employee/decommission-customer.md (#820)
--              reference_agents_skills_source_of_truth.md (#573)
-- ============================================================================

-- ---------- Skill drafts ----------
-- One row per Curator observation. Four draft types:
--   new_skill            — proposed skill markdown for a fresh SKILL.md
--   consolidation        — merge two or more skills (target_skill_slug
--                          is the primary; draft_body names the others)
--   prune_recommendation — flag a skill as underperforming; target_skill_slug
--                          is the candidate; draft_body is the rationale
--   scope_adjustment     — narrow or widen a skill's scope; target_skill_slug
--                          is the skill; draft_body is the proposed diff
--
-- Promotion (calibration-session UI) stamps promoted_at/promoted_by/
-- promoted_pr_url and opens a crane-console PR; the row itself is the
-- audit-trail anchor. Dismissals are recorded (never deleted) so the
-- dismissal corpus is available for tuning Curator's extraction signal
-- over time.
CREATE TABLE skill_drafts (
  draft_id              TEXT PRIMARY KEY,
  draft_type            TEXT NOT NULL,         -- new_skill | consolidation | prune_recommendation | scope_adjustment
  target_skill_slug     TEXT,                  -- existing skill slug; null for new_skill
  draft_body            TEXT NOT NULL,         -- proposed markdown (new_skill, consolidation, scope) or rationale (prune)
  source_evidence_json  TEXT NOT NULL,         -- execution-trace row IDs, audit_log row IDs, outcome scores
  curator_score         REAL,                  -- Curator's own grading value; never an auto-promotion gate
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  promoted_at           TEXT,                  -- timestamp of Captain promotion
  promoted_by           TEXT,                  -- Captain identifier who promoted
  promoted_pr_url       TEXT,                  -- URL of the crane-console PR the promotion generated
  dismissed_at          TEXT,
  dismissed_by          TEXT,
  dismissed_reason      TEXT,
  CHECK (source_evidence_json IS NOT NULL AND length(source_evidence_json) > 0)
);

-- Pending drafts: the calibration-session surface walks this index.
CREATE INDEX skill_drafts_pending
  ON skill_drafts (created_at)
  WHERE promoted_at IS NULL AND dismissed_at IS NULL;

-- Per-type time-ordered scan: powers the calibration UI's per-type pane
-- and the decommission export.
CREATE INDEX skill_drafts_by_type
  ON skill_drafts (draft_type, created_at);

-- ---------- Schema version ----------
-- 0001-0006 set 1-6, 0007 set 7; this is 8.
PRAGMA user_version = 8;
