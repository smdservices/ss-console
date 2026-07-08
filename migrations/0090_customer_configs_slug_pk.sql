-- Migration 0090: customer_configs becomes many-per-entity.
--
-- Part of the multi-operator model (2026-07-08): one client (entity) may own
-- several operators, each a distinct customer_configs row. The blocker is
-- `entity_id TEXT PRIMARY KEY` (migration 0039) — it caps an entity at one
-- config. The instance identity is `customer_slug` (already NOT NULL UNIQUE, and
-- already the fleet identity → Fly app). So the fix moves the PK from entity_id
-- to customer_slug; entity_id becomes an indexed, non-unique FK (ON DELETE
-- CASCADE preserved). The UNIQUE(customer_slug) semantics are unchanged — now
-- provided by the PK — so no identity guarantee is lost; only the
-- "one row per entity" cap is lifted.
--
-- Runs AFTER 0089 (whose operator-sub backfill relies on the 1:1 invariant).
--
-- customer_configs is a PURE child — nothing FK-references it (only its own two
-- indexes name it), so no child dance is needed. defer_foreign_keys keeps its
-- OWN outgoing FKs (entity_id->entities, org_id->organizations) satisfied across
-- the INSERT..SELECT + drop/rename. D1 wraps this file in one atomic transaction.
--
-- Column list reconciled against LIVE sqlite_master: 0039 base + compliance_enabled
-- (0042) + vertical (0042) + authority_json/credential_custody_default (0049/0050
-- era) + mcp_connector_json (0071) + anthropic_workspace_id (0083).
-- screening_attestation_json was added (0077) then dropped (0078) => absent.
--
-- Manual-only rollback at migrations/rollbacks/0090_customer_configs_slug_pk_down.sql.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE customer_configs_new (
  customer_slug              TEXT PRIMARY KEY,
  entity_id                  TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  org_id                     TEXT NOT NULL REFERENCES organizations(id),
  schema_version             TEXT NOT NULL,
  personas_json              TEXT NOT NULL,
  voice_library_json         TEXT,
  escalation_json            TEXT,
  business_hours_json        TEXT,
  connectors_json            TEXT,
  scope_json                 TEXT,
  git_sha                    TEXT NOT NULL,
  synced_at                  TEXT NOT NULL,
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  compliance_enabled         INTEGER NOT NULL DEFAULT 0,
  vertical                   TEXT,
  authority_json             TEXT,
  credential_custody_default TEXT,
  mcp_connector_json         TEXT,
  anthropic_workspace_id     TEXT
);

INSERT INTO customer_configs_new (
  customer_slug, entity_id, org_id, schema_version, personas_json, voice_library_json,
  escalation_json, business_hours_json, connectors_json, scope_json, git_sha, synced_at,
  created_at, updated_at, compliance_enabled, vertical, authority_json,
  credential_custody_default, mcp_connector_json, anthropic_workspace_id)
SELECT
  customer_slug, entity_id, org_id, schema_version, personas_json, voice_library_json,
  escalation_json, business_hours_json, connectors_json, scope_json, git_sha, synced_at,
  created_at, updated_at, compliance_enabled, vertical, authority_json,
  credential_custody_default, mcp_connector_json, anthropic_workspace_id
FROM customer_configs;

DROP TABLE customer_configs;
ALTER TABLE customer_configs_new RENAME TO customer_configs;

-- Recreate indexes. customer_slug's UNIQUE index is now the PK (implicit), so the
-- old idx_customer_configs_slug is intentionally NOT recreated. entity_id was the
-- rowid PK before (implicitly indexed); it now needs an explicit index for
-- listCustomerConfigsForEntity.
CREATE INDEX idx_customer_configs_org    ON customer_configs(org_id);
CREATE INDEX idx_customer_configs_entity ON customer_configs(entity_id);
