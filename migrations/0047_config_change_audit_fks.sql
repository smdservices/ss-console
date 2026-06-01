-- ============================================================================
-- Migration 0047: add real FOREIGN KEY constraints to config_change_audit
-- ============================================================================
--
-- 0046 created config_change_audit (the control-plane governance ledger, ADR
-- 0026 / ADR 0030) with entity_id and actor_user_id as bare TEXT NOT NULL —
-- no REFERENCES. Every sibling table (cost_anomaly_alerts, matter_assignments,
-- product_roles, ...) FK-constrains those. This migration brings the ledger
-- in line so an auditor reading the DDL sees declared referential integrity:
--   entity_id     -> entities(id)
--   actor_user_id -> users(id)
--
-- SQLite has no ALTER TABLE ADD CONSTRAINT, so a constraint add is a table
-- rebuild (create new -> copy -> drop old -> rename -> recreate indexes), the
-- pattern proven in migration 0035. config_change_audit has NO child tables
-- (nothing REFERENCES it), so this is the SIMPLE single-table case — no FK-chain
-- dance, unlike 0035's users rebuild.
--
-- EMPTINESS + EVIDENCE ENVELOPE:
--   A Captain-authorized read-only count at authoring time showed
--   config_change_audit has 0 rows in prod (no governance action recorded yet),
--   so the copy step moves zero rows and there is no historical chain-of-custody
--   to preserve.
--
--   MANDATORY PRE-FLIGHT (run immediately before applying, mirrors 0035):
--     npx wrangler d1 execute ss-console-db --remote \
--       --command "SELECT COUNT(*) AS n FROM config_change_audit"
--   The count MUST be 0. If rows exist (someone used the trust-ceiling /
--   skill-toggle portal flow between authoring and deploy), DO NOT APPLY this
--   migration — re-author it with the populated-ledger evidence envelope
--   (pre/post per-row hash + retain config_change_audit_legacy + no backfill).
--   A SQL-level RAISE guard is not used here: RAISE() is only legal inside a
--   trigger, and adding a trigger to a ledger mid-rebuild is more surface than
--   the human pre-flight check warrants for a one-time, verified-empty table.
--
-- Append-only semantics, FK enforcement note:
--   D1/Workers does not set PRAGMA foreign_keys=ON per connection, so these FKs
--   are NOT runtime-enforced today — they document referential integrity in the
--   DDL for audit-readiness (the stated goal). App-side, recordConfigChangeAudit
--   already supplies entity_id/actor_user_id from authenticated principal
--   context. If runtime enforcement is later turned on, these constraints are
--   already in place.
--
-- D1 wraps this file in a single atomic transaction; a partial-apply half-state
-- is not a risk. Manual rollback: migrations/rollbacks/0047_config_change_audit_fks_down.sql
-- ============================================================================

PRAGMA defer_foreign_keys = ON;

-- (Emptiness is enforced by the MANDATORY PRE-FLIGHT count documented in the
-- header, not by an in-SQL RAISE — RAISE() is trigger-only in SQLite.)

-- Step 1: new table, identical columns + CHECKs, with FKs added.
CREATE TABLE config_change_audit_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_slug   TEXT NOT NULL,
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  source          TEXT NOT NULL DEFAULT 'portal_intent'
                    CHECK (source IN ('portal_intent', 'runtime_confirmed')),
  actor_user_id   TEXT NOT NULL REFERENCES users(id),
  actor_email     TEXT NOT NULL,
  actor_role      TEXT NOT NULL,
  change_type     TEXT NOT NULL
                    CHECK (change_type IN ('trust_ceiling', 'action_ceiling', 'skill_toggle')),
  persona_slug    TEXT,
  skill_name      TEXT,
  action_class    TEXT,
  old_value       TEXT,
  new_value       TEXT,
  outcome         TEXT NOT NULL
                    CHECK (outcome IN ('accepted', 'rejected_floor', 'rejected_invalid')),
  outcome_reason  TEXT,
  direction       TEXT NOT NULL DEFAULT 'n/a'
                    CHECK (direction IN ('raise', 'lower', 'lateral', 'n/a')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Step 2: copy rows (zero today; the guard above proved emptiness). Explicit
-- column list so a future column drift surfaces as an error, not a silent skip.
INSERT INTO config_change_audit_new
  (id, customer_slug, entity_id, source, actor_user_id, actor_email, actor_role,
   change_type, persona_slug, skill_name, action_class, old_value, new_value,
   outcome, outcome_reason, direction, created_at)
SELECT
   id, customer_slug, entity_id, source, actor_user_id, actor_email, actor_role,
   change_type, persona_slug, skill_name, action_class, old_value, new_value,
   outcome, outcome_reason, direction, created_at
FROM config_change_audit;

-- Step 3: drop old, rename new into place.
DROP TABLE config_change_audit;
ALTER TABLE config_change_audit_new RENAME TO config_change_audit;

-- Step 4: recreate the indexes (the rebuild dropped them with the old table).
CREATE INDEX IF NOT EXISTS idx_cca_slug_created
  ON config_change_audit (customer_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cca_entity_created
  ON config_change_audit (entity_id, created_at DESC);
