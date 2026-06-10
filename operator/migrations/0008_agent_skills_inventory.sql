-- ============================================================================
-- Migration 0008: agent_skills_inventory table (ADR 0017 rewrite, 2026-05-24)
-- ============================================================================
--
-- Per-customer table that mirrors the agent-authored skills the Hermes
-- `skill_manage` tool creates during normal operation. The Curator and the
-- `skill_manage` tool both run natively in customer Machines (no
-- interception); this table is the visibility surface for Captain.
--
-- Captain direction (2026-05-24): trust Hermes' self-improving thesis;
-- visibility-and-reversibility, not upfront gating. The agent gets better at
-- the customer's business over time. The blast radius of agent-authored
-- skills is bounded by the connector surface in customer.yaml; per-draft
-- safety is held by draft-for-review external send (ADR 0005).
--
-- Schema is the authoritative copy from ADR 0017 §"Decision".
--
-- Write discipline (ADR 0017):
--   The `hermes-smd-audit` plugin (and/or `hermes-smd-memory-mirror`) is the
--   writer: on `post_tool_call` firing for `skill_manage` with action
--   `create` or `write_file`, it INSERTs a row here AND emits an
--   `AGENT_SKILL_CREATED` row to the audit_log.
--
-- Read discipline:
--   Admin portal surfaces the inventory at
--   /admin/operator/<customer>/skills for Captain review and removal.
--   Runtime skill dispatch reads from the per-profile skills directory
--   (Hermes-native), not this table.
--
-- Reversibility (ADR 0017):
--   Captain marks a skill removed in the admin portal → handler physically
--   deletes the skill directory from the customer's Fly volume AND stamps
--   `removed_at` + `removed_by` here AND emits `AGENT_SKILL_REMOVED` to
--   audit_log. Re-creation is NOT blocked — the agent may legitimately
--   re-create a removed skill if the workflow demands it; rapid re-creation
--   surfaces as a separate dashboard signal.
--
-- Privacy posture (ADR 0009):
--   Lives in the per-customer D1 database. `customer_slug` denormalized for
--   query ergonomics; deployment-level isolation is the safety mechanism.
--
-- Source spec: docs/adr/0017-skill-curator-disposition.md §"Decision" (rewrite, 2026-05-24)
-- Refers to:   docs/adr/0016-honcho-disposition.md (symmetric posture)
--              docs/specs/operator/decommission-customer.md (#820)
-- ============================================================================

-- ---------- Agent-authored skills inventory ----------
-- One row per skill the agent creates via `skill_manage`. Captain removal
-- stamps `removed_at`/`removed_by`; archival (TTL or policy) stamps
-- `archived_at`/`archived_reason`. Both are recorded — the row is never
-- deleted from this table.
CREATE TABLE agent_skills_inventory (
  customer_slug       TEXT NOT NULL,
  persona_slug        TEXT NOT NULL,
  skill_name          TEXT NOT NULL,
  skill_content_hash  TEXT NOT NULL,                        -- content-addressed; survives rename
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  source_turn_id      TEXT NOT NULL,                        -- the conversation turn that triggered creation
  archived_at         TEXT,
  archived_reason     TEXT,
  removed_at          TEXT,
  removed_by          TEXT,
  PRIMARY KEY (customer_slug, persona_slug, skill_name, skill_content_hash)
);

-- Active inventory: powers the admin portal's primary view.
CREATE INDEX agent_skills_inventory_active
  ON agent_skills_inventory (persona_slug, created_at)
  WHERE archived_at IS NULL AND removed_at IS NULL;

-- Per-persona time-ordered scan: powers the calibration-session pane plus
-- the decommission export.
CREATE INDEX agent_skills_inventory_by_persona
  ON agent_skills_inventory (persona_slug, created_at);

-- ---------- Schema version ----------
PRAGMA user_version = 8;
