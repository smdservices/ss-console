-- Manual rollback for migration 0047. NOT auto-applied.
-- See migrations/rollbacks/README.md.
--
-- Reverses the FK add by rebuilding config_change_audit WITHOUT the
-- entity_id -> entities(id) / actor_user_id -> users(id) REFERENCES (back to
-- the 0046 shape: bare TEXT NOT NULL). Single-table rebuild; no child tables.
--
-- Pre-flight (run before applying this rollback), same as the forward migration:
--   npx wrangler d1 execute ss-console-db --remote \
--     --command "SELECT COUNT(*) AS n FROM config_change_audit"
-- Count MUST be 0. If rows exist, handle the populated case explicitly (this
-- rollback copies rows through a table rebuild and is authored for the empty
-- case 0047 applies to). RAISE() is trigger-only in SQLite, so the guard is the
-- human pre-flight, not in-SQL.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE config_change_audit_old (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_slug   TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'portal_intent'
                    CHECK (source IN ('portal_intent', 'runtime_confirmed')),
  actor_user_id   TEXT NOT NULL,
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

INSERT INTO config_change_audit_old
  (id, customer_slug, entity_id, source, actor_user_id, actor_email, actor_role,
   change_type, persona_slug, skill_name, action_class, old_value, new_value,
   outcome, outcome_reason, direction, created_at)
SELECT
   id, customer_slug, entity_id, source, actor_user_id, actor_email, actor_role,
   change_type, persona_slug, skill_name, action_class, old_value, new_value,
   outcome, outcome_reason, direction, created_at
FROM config_change_audit;

DROP TABLE config_change_audit;
ALTER TABLE config_change_audit_old RENAME TO config_change_audit;

CREATE INDEX IF NOT EXISTS idx_cca_slug_created
  ON config_change_audit (customer_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cca_entity_created
  ON config_change_audit (entity_id, created_at DESC);
