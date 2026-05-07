-- Migration 0036: lead-gen pivot foundations
--
-- Captain audit 2026-05-07 surfaced two structural gaps in the lead-gen
-- stack:
--   1. Permit/address recovery needs a bounded cache for Google Places
--      reverse-address lookups so we do not pay for the same address on
--      every cron run.
--   2. Near-miss dedup and address/name ambiguity need an append-only audit
--      trail for human review instead of silent auto-merge behavior.
--
-- Notes:
--   - actor_role lives inside context.metadata JSON. No DDL required.
--   - No standing orphan lane or permit-address index table is introduced.
--     The permit worker resolves or drops at ingest.

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
