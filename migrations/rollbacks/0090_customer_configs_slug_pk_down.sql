-- Rollback for 0090: restore customer_configs with entity_id as PRIMARY KEY.
--
-- SAFETY: this rebuild sets entity_id as the PK again, so it will FAIL if any
-- entity now owns more than one config row (i.e. the multi-operator feature was
-- actually used). That is intentional — you cannot collapse back to one-config-
-- per-entity while a client holds two operators. Resolve the extra rows first.
--
-- Run BEFORE 0089's rollback (reverse order of the up migrations). Manual-only;
-- coordinate with Captain. D1 wraps this file in one atomic transaction.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE customer_configs_old (
  entity_id                  TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  org_id                     TEXT NOT NULL REFERENCES organizations(id),
  customer_slug              TEXT NOT NULL UNIQUE,
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

INSERT INTO customer_configs_old (
  entity_id, org_id, customer_slug, schema_version, personas_json, voice_library_json,
  escalation_json, business_hours_json, connectors_json, scope_json, git_sha, synced_at,
  created_at, updated_at, compliance_enabled, vertical, authority_json,
  credential_custody_default, mcp_connector_json, anthropic_workspace_id)
SELECT
  entity_id, org_id, customer_slug, schema_version, personas_json, voice_library_json,
  escalation_json, business_hours_json, connectors_json, scope_json, git_sha, synced_at,
  created_at, updated_at, compliance_enabled, vertical, authority_json,
  credential_custody_default, mcp_connector_json, anthropic_workspace_id
FROM customer_configs;

DROP TABLE customer_configs;
ALTER TABLE customer_configs_old RENAME TO customer_configs;

CREATE INDEX idx_customer_configs_org  ON customer_configs(org_id);
CREATE INDEX idx_customer_configs_slug ON customer_configs(customer_slug);
