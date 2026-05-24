-- Per-user audit-log saved queries (issue #896)
-- ============================================================================
--
-- Records named filter sets a compliance / principal reviewer wants to keep
-- around for later runs ("Untagged refusals", "Smith matter activity",
-- "Last quarter trust-promotion events"). Surfaces in the audit page's
-- saved-queries list; click the name to re-apply the filter set as the
-- URL query string.
--
-- Identity tuple: (user_id, entity_id, name) is the natural key. A given
-- user can keep multiple named queries per customer; renaming an existing
-- query upserts the row.
--
-- query_json is the serialized AuditListParams shape from
-- `src/lib/portal/ai-employee/audit.ts`. Stored as JSON TEXT because the
-- shape evolves (filters get added; pageSize defaults change) and
-- normalizing into columns would force a migration per shape change.
-- The audit-saved-queries.ts module owns parse/validate and rejects
-- malformed JSON or unknown fields rather than failing closed on the
-- whole row.
--
-- The audit log itself lives on the per-customer Hermes Machine D1
-- (ADR 0007 + 0009); saved queries live here on the portal D1 because
-- they're per-user reviewer state, not per-customer audit history.
--
-- Forward-only, additive. No drops.
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_saved_queries (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES organizations(id),
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id   TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- Human-readable name. The (user_id, entity_id, name) tuple is unique
  -- so a reviewer cannot accidentally shadow an existing name by saving
  -- the same name twice; the API upserts on conflict.
  name        TEXT NOT NULL,

  -- Serialized AuditListParams. Validated on read; malformed rows
  -- surface as a parse error in the resolver rather than poisoning the
  -- page render.
  query_json  TEXT NOT NULL,

  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE (user_id, entity_id, name)
);

CREATE INDEX IF NOT EXISTS idx_audit_saved_queries_user_entity
  ON audit_saved_queries(user_id, entity_id);
