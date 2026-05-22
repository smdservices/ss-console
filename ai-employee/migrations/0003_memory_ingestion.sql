-- ============================================================================
-- Migration 0003: memory ingestion state (issue #860)
-- ============================================================================
--
-- Adds the per-source ingestion state table that the memory ingestion pipeline
-- writes to on every run (scheduled or on-demand). The dashboard reads this
-- table to render the "last-ingestion-at" health indicator per source.
--
-- Two tables:
--
--   1. memory_source_state — one row per (source_kind, source_id). source_kind
--      is the capability vendor slug or 'none' for the no-PM-system fallback.
--      The row carries last_ingestion_at, last_success_at, last_error,
--      ingest_status, and a count of items ingested in the most recent run.
--
--   2. memory_ingested_items — per-ingested-item provenance row. Lets the
--      decommission hook enumerate everything the pipeline persisted (D1 IDs,
--      R2 object keys, Vectorize vector IDs) and verify removal. One row per
--      logical item; large documents become one provenance row plus N chunk
--      rows in vectorize_chunk_ids (JSON array).
--
-- ADR 0008 (customer-owned memory artifact): both tables live in the per-
-- customer D1 database, no tenant column.
-- ADR 0009 (cross-machine query prohibition): isolation is the binding, not
-- the schema.
-- ADR 0006 (capability adapter pattern): source_kind is the adapter vendor
-- slug. The pipeline is vendor-neutral; the SQL records which vendor produced
-- the row so dashboards and decommission can drill down.
-- ============================================================================

-- ---------- 1. Memory source state ----------
-- One row per source (e.g. ('practice_management', 'filevine'),
-- ('practice_management', 'clio'), ('practice_management', 'none') for the
-- no-PM-system fallback). The pipeline upserts on every run.
CREATE TABLE memory_source_state (
  source_kind         TEXT NOT NULL,            -- 'practice_management' | future capability
  source_id           TEXT NOT NULL,            -- adapter slug or 'none'
  last_ingestion_at   TEXT NOT NULL,            -- ISO 8601 UTC; updated on every run regardless of outcome
  last_success_at     TEXT,                     -- ISO 8601 UTC; updated only on success
  last_error          TEXT,                     -- nullable; cleared on success
  ingest_status       TEXT NOT NULL,            -- 'ok' | 'stale' | 'error' | 'never_run'
  items_last_run      INTEGER NOT NULL DEFAULT 0,
  schema_version      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (source_kind, source_id)
);

CREATE INDEX idx_memory_source_state_status
  ON memory_source_state(ingest_status, last_ingestion_at DESC);

-- ---------- 2. Memory ingested items ----------
-- Provenance row per ingested logical item (one matter, one document, one
-- recipient relationship). Decommission walks this table to enumerate every
-- artifact the pipeline persisted: D1 rows it wrote, R2 keys it stored, and
-- Vectorize vector IDs it indexed.
--
-- access_scope is propagated from the connector's per-matter ACL. The pipeline
-- does not decide ACLs; the source system does. The skill layer reads
-- access_scope to gate retrieval.
CREATE TABLE memory_ingested_items (
  id                   TEXT PRIMARY KEY,        -- ULID
  source_kind          TEXT NOT NULL,
  source_id            TEXT NOT NULL,
  external_id          TEXT NOT NULL,           -- ID in the upstream system
  item_type            TEXT NOT NULL,           -- 'matter' | 'document' | 'recipient'
  ingested_at          TEXT NOT NULL,           -- ISO 8601 UTC
  access_scope         TEXT NOT NULL DEFAULT 'firm-wide',  -- 'firm-wide' | 'partner-only' | 'attorney-list'
  access_scope_detail  TEXT,                    -- JSON; e.g. attorney IDs for 'attorney-list'
  r2_key               TEXT,                    -- when the item produced an R2 object
  vectorize_chunk_ids  TEXT,                    -- JSON array of vector IDs
  content_digest       TEXT,                    -- SHA-256 of the source content; lets a re-run detect no-change
  metadata             TEXT,                    -- JSON; vendor-specific metadata for the dashboard
  deleted_at           TEXT
);

CREATE INDEX idx_memory_items_source
  ON memory_ingested_items(source_kind, source_id, deleted_at);

CREATE INDEX idx_memory_items_external
  ON memory_ingested_items(source_kind, source_id, external_id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_memory_items_type
  ON memory_ingested_items(item_type, ingested_at DESC)
  WHERE deleted_at IS NULL;

-- ---------- Schema version ----------
-- 0001 set 1, 0002 set 2; this is migration 3.
PRAGMA user_version = 3;
