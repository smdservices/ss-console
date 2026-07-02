-- Rollback for migration 0080 (drop standalone lead-gen machine tables).
--
-- MANUAL-ONLY. Lives in /rollbacks/ so wrangler does NOT auto-apply it.
-- Apply with:
--   npx wrangler d1 execute ss-console-db --remote \
--     --file migrations/rollbacks/0080_drop_standalone_lead_gen_tables_down.sql
--
-- SCHEMA-ONLY. This recreates the empty table shells for structural parity.
-- The rows are NOT recoverable from this file — the machine data was
-- deliberately retired. If real recovery is ever needed, restore from the
-- pre-rip D1 export (backup-pre-rip.sql) taken in the teardown runbook.
--
-- Restoring functionality (not just schema) requires reverting the teardown
-- PR and redeploying the workers + enrichment pipeline; these tables are
-- inert without that code. DDL below is reproduced verbatim from the
-- original create migrations (0007, 0023, 0027, 0029, 0036).

CREATE TABLE IF NOT EXISTS lead_signals (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  client_id       TEXT REFERENCES clients(id),
  business_name   TEXT NOT NULL,
  phone           TEXT,
  website         TEXT,
  category        TEXT,
  area            TEXT,
  source_pipeline TEXT NOT NULL CHECK (source_pipeline IN (
    'review_mining', 'job_monitor', 'new_business', 'social_listening'
  )),
  pain_score      INTEGER CHECK (pain_score BETWEEN 1 AND 10),
  top_problems    TEXT,
  evidence_summary TEXT,
  outreach_angle  TEXT,
  source_metadata TEXT,
  triage_status   TEXT NOT NULL DEFAULT 'new' CHECK (triage_status IN (
    'new', 'reviewed', 'promoted', 'dismissed'
  )),
  triage_notes    TEXT,
  triaged_at      TEXT,
  dedup_key       TEXT NOT NULL,
  date_found      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, dedup_key, source_pipeline)
);
CREATE INDEX IF NOT EXISTS idx_lead_signals_org_triage ON lead_signals(org_id, triage_status);
CREATE INDEX IF NOT EXISTS idx_lead_signals_org_pipeline ON lead_signals(org_id, source_pipeline);
CREATE INDEX IF NOT EXISTS idx_lead_signals_client ON lead_signals(client_id);

CREATE TABLE IF NOT EXISTS generator_config (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pipeline TEXT NOT NULL CHECK (pipeline IN (
    'new_business', 'job_monitor', 'review_mining', 'social_listening'
  )),
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL,
  last_run_at TEXT,
  last_run_signals_count INTEGER,
  last_run_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, pipeline)
);
CREATE INDEX IF NOT EXISTS idx_generator_config_org_pipeline
  ON generator_config(org_id, pipeline);

CREATE TABLE IF NOT EXISTS enrichment_runs (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id),
  entity_id         TEXT NOT NULL,
  module            TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN (
    'running', 'succeeded', 'no_data', 'skipped', 'failed'
  )),
  reason            TEXT,
  error_message     TEXT,
  input_fingerprint TEXT,
  started_at        TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at      TEXT,
  duration_ms       INTEGER,
  triggered_by      TEXT NOT NULL,
  mode              TEXT NOT NULL CHECK (mode IN ('full', 'reviews-and-news', 'single')),
  context_entry_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_enrichment_runs_entity_module
  ON enrichment_runs(entity_id, module, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrichment_runs_module_status
  ON enrichment_runs(module, status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrichment_runs_org
  ON enrichment_runs(org_id, started_at DESC);

CREATE TABLE IF NOT EXISTS pipeline_settings (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pipeline TEXT NOT NULL CHECK (pipeline IN (
    'new_business', 'job_monitor', 'review_mining', 'social_listening'
  )),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT,
  UNIQUE(org_id, pipeline, key)
);
CREATE INDEX IF NOT EXISTS idx_pipeline_settings_org_pipeline
  ON pipeline_settings(org_id, pipeline);

CREATE TABLE IF NOT EXISTS pipeline_settings_audit (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pipeline TEXT NOT NULL,
  key TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT NOT NULL,
  actor_user_id TEXT,
  actor_email TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pipeline_settings_audit_org_pipeline_changed
  ON pipeline_settings_audit(org_id, pipeline, changed_at DESC);

CREATE TABLE IF NOT EXISTS places_lookup_cache (
  id TEXT PRIMARY KEY,
  normalized_address TEXT NOT NULL UNIQUE,
  business_name TEXT,
  place_id TEXT,
  formatted_address TEXT,
  area TEXT,
  phone TEXT,
  website TEXT,
  business_status TEXT,
  types_json TEXT,
  response_json TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_places_lookup_cache_expires
  ON places_lookup_cache(expires_at);

CREATE TABLE IF NOT EXISTS candidate_merge_log (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  existing_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  candidate_name TEXT NOT NULL,
  candidate_slug TEXT,
  candidate_area TEXT,
  candidate_address TEXT,
  matched_name TEXT,
  matched_area TEXT,
  matched_address TEXT,
  source_pipeline TEXT,
  source_ref TEXT,
  reason TEXT NOT NULL,
  score REAL,
  metadata TEXT,
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN (
    'pending',
    'reviewed',
    'dismissed'
  )),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_candidate_merge_log_org_created
  ON candidate_merge_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidate_merge_log_entity
  ON candidate_merge_log(existing_entity_id, created_at DESC);
