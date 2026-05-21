-- Portal projection of customer.yaml — read replica for hot-path portal lookups
-- ============================================================================
--
-- Adds the `customer_configs` table that holds the portal's projection of each
-- customer's canonical `customer.yaml`. Per ADR 0012, customer.yaml lives in a
-- git repository (source of truth); CI on merge projects it into this table
-- (portal read replica) and uploads the original to per-customer R2 (Hermes
-- read replica). Portal pages read from this table on the hot path; they never
-- write to it. Hand-edits are a defect detected by the daily drift cron.
--
-- The projection holds only fields the portal needs to render. Secrets never
-- enter this table — they live in Infisical, with non-secret references
-- denormalized into `connectors_json` where the portal needs them.
--
-- Personas vocabulary follows ADR 0011 (`personas:` array, length ≥1 at v1).
-- `personas_json` is the parsed array; helper functions in
-- src/lib/portal/customer-config.ts decode it into typed PersonaConfig values.
--
-- Forward-only, additive. No drops.
-- ============================================================================

CREATE TABLE IF NOT EXISTS customer_configs (
  entity_id           TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  org_id              TEXT NOT NULL REFERENCES organizations(id),

  -- Stable slug for the customer (e.g. "smith-pi-firm"). Used to address the
  -- Hermes Machine, the R2 prefix, and the canonical customer-configs path
  -- in git. UNIQUE across customers.
  customer_slug       TEXT NOT NULL UNIQUE,

  -- Schema version the projection was built from. Each schema evolution
  -- bumps this; drift detection flags rows whose schema_version lags the
  -- canonical schema.
  schema_version      TEXT NOT NULL,

  -- Parsed projections of customer.yaml fields the portal reads. All TEXT
  -- columns hold JSON; helpers parse on read and never on write. NULL is
  -- meaningful for fields a customer may legitimately not have configured
  -- yet (no voice library, no escalation rules).
  personas_json       TEXT NOT NULL,
  voice_library_json  TEXT,
  escalation_json     TEXT,
  business_hours_json TEXT,
  connectors_json     TEXT,
  scope_json          TEXT,

  -- Commit SHA the projection was built from. Audit log entries cite this
  -- so any decision can be tied back to the exact config in effect.
  git_sha             TEXT NOT NULL,

  -- When CI last synced this row from git. Drift detection uses this with
  -- `git_sha` to spot stale projections.
  synced_at           TEXT NOT NULL,

  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_configs_org
  ON customer_configs(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_configs_slug
  ON customer_configs(customer_slug);
