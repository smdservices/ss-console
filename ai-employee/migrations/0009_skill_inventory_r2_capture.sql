-- ============================================================================
-- Migration 0009: agent_skills_inventory R2 capture columns (ADR 0022 Stream 2)
-- ============================================================================
--
-- Adds the substrate gap closure from ADR 0022 §"Time-machine substrate
-- commitment": every agent-authored skill the `skill_manage` tool creates
-- gets its body bytes persisted to R2 so the historical content is
-- recoverable, not just the AGENT_SKILL_CREATED audit event.
--
-- Write contract (write-ahead pattern):
--   1. Overlay plugin INSERTs the row inline with r2_status='pending' and
--      r2_key=<predictable hash-addressed key>, r2_write_error=NULL.
--   2. Same plugin (or a sidecar reconciler) attempts the R2 PUT; on success
--      UPDATEs r2_status='persisted'; on failure UPDATEs r2_status='failed'
--      with the error reason in r2_write_error.
--   3. On Machine boot, the reconciler re-attempts any row with
--      r2_status IN ('pending','failed').
--
-- The write happens inside the customer Machine (mirror-don't-gate per
-- ADR 0016) — no HTTP bridge from Machine to ss-console Worker.
--
-- Captain isolation decision (2026-05-26, reconfirmed 2026-05-27):
--   One R2 bucket per customer (`ss-ai-employee-<slug>-skills`). Per-Machine
--   credentials scoped to that bucket. The bucket itself is the trust
--   boundary, not the IAM policy. See approved plan §"R2 bucket model"
--   for the constraint analysis behind the choice.
--
-- R2 key shape (per-customer bucket model):
--   skills/<persona_slug>/<skill_name>/<skill_content_hash>.md
--
-- Content-addressed: identical bodies dedupe at the R2 layer; rename of
-- skill_name leaves the prior hash intact (skills can be re-discovered by
-- joining inventory rows on skill_content_hash).
--
-- Read path: admin portal looks up r2_key from D1 by hash, generates a
-- short-lived presigned GET via the per-customer bucket credentials.
-- Returns 404 when r2_status != 'persisted' (surfaces the gap rather than
-- serving stale or absent content).
--
-- Backfill posture: legacy rows (created before this migration) leave the
-- new columns NULL. The reconciler does not back-populate historical
-- bodies — those were never persisted and are not recoverable. The
-- substrate gap closes for new agent-authored skills from this point
-- forward.
--
-- Source spec: docs/specs/ai-employee/skill-body-persistence.md
-- Refers to:   docs/adr/0022-vertical-pack-architecture.md §"Time-machine substrate commitment"
--              docs/adr/0007-per-customer-machine-isolation.md (bucket-per-customer rationale)
--              docs/adr/0016-honcho-disposition.md (mirror-don't-gate posture)
--              docs/adr/0017-skill-curator-disposition.md (the inventory table this extends)
-- ============================================================================

-- ---------- New columns: R2 capture metadata ----------
ALTER TABLE agent_skills_inventory ADD COLUMN r2_key TEXT;
ALTER TABLE agent_skills_inventory ADD COLUMN r2_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (r2_status IN ('unknown', 'pending', 'persisted', 'failed'));
ALTER TABLE agent_skills_inventory ADD COLUMN r2_write_error TEXT;

-- ---------- New index: content-hash lookup ----------
-- Powers the admin portal's "view body by hash" endpoint and the
-- decommission export's hash-to-row mapping.
CREATE INDEX agent_skills_inventory_by_hash
  ON agent_skills_inventory (skill_content_hash);

-- ---------- New partial index: pending/failed surface ----------
-- Powers the reconciler's boot-time retry pass and the admin sidebar's
-- "skills missing R2 body" indicator. Partial index keeps it cheap.
CREATE INDEX agent_skills_inventory_r2_pending
  ON agent_skills_inventory (r2_status, created_at)
  WHERE r2_status IN ('pending', 'failed');

-- ---------- Schema version ----------
PRAGMA user_version = 9;
