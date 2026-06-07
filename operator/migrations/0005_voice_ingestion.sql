-- ============================================================================
-- Migration 0004: voice sample ingestion state (issue #856)
-- ============================================================================
--
-- Adds the per-source ingestion state table that the voice sample ingestion
-- pipeline writes to on every run (scheduled or on-demand), and a provenance
-- table that lets the decommission hook enumerate every artifact the
-- pipeline persisted. Sibling to the memory ingestion state from migration
-- 0003 — voice samples are the dedicated pipeline for the customer's sent
-- folder, anchored to structural-diff format per PRD §10.4.
--
-- Two tables:
--
--   1. voice_source_state — one row per (source_kind, source_id). For Voice
--      Layer 2 the source_kind is always 'email' and source_id is the email
--      connector adapter slug ('microsoft-graph', 'gmail', 'none' for the
--      no-connector fallback). The row carries last_ingestion_at,
--      last_success_at, last_error, ingest_status, items_last_run, and
--      samples_by_cohort_json so the dashboard can render
--      "Captain can review what was ingested" per AC.
--
--   2. voice_ingestion_items — per-ingested-sample provenance row. Lets the
--      retention enforcer and the decommission hook enumerate every R2
--      object the pipeline stored. One row per sample; large samples are
--      not chunked because the structural-diff is small by construction
--      (counts and signatures, never the body — see voice-ingestion.md).
--
-- Privacy posture (PRD §10.4 + AC #3):
--   The raw email body is NEVER persisted. Only the structural-diff
--   representation lands in R2, and only the SHA-256 digest of the source
--   message ID lands in D1 (so re-runs can detect the same source without
--   storing the upstream identifier). No quoted text, no recipient
--   addresses, no PII.
--
-- ADR 0008 (customer-owned memory artifact): both tables live in the
--   per-customer D1 database; the R2 keys point at
--   {customer-slug}/voice/cohort/{cohort-id}/{sample-id}.md per
--   r2-vectorize-naming.md.
-- ADR 0009 (cross-machine query prohibition): isolation is the binding,
--   not the schema. No tenant column.
-- ADR 0006 (capability adapter pattern): source_kind names the capability
--   (Email), source_id names the adapter slug. The pipeline talks to the
--   Email interface, never to MS Graph or Gmail directly.
-- ============================================================================

-- ---------- 1. Voice source state ----------
-- One row per (source_kind, source_id). The pipeline upserts on every run
-- regardless of outcome so the dashboard can light up red when ingestion
-- has failed. samples_by_cohort_json is a JSON object mapping cohort_id ->
-- count for the most recent run; the dashboard renders this directly so
-- Captain can review "what was ingested" without a second query.
CREATE TABLE voice_source_state (
  source_kind             TEXT NOT NULL,        -- 'email' (extension point for future capabilities)
  source_id               TEXT NOT NULL,        -- email adapter slug or 'none'
  last_ingestion_at       TEXT NOT NULL,        -- ISO 8601 UTC; updated on every run
  last_success_at         TEXT,                 -- ISO 8601 UTC; updated only on success
  last_error              TEXT,                 -- nullable; cleared on success
  ingest_status           TEXT NOT NULL,        -- 'ok' | 'stale' | 'error' | 'never_run'
  items_last_run          INTEGER NOT NULL DEFAULT 0,
  samples_by_cohort_json  TEXT,                 -- JSON {"cohort_id": count, ...}; Captain review surface
  schema_version          INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (source_kind, source_id)
);

CREATE INDEX idx_voice_source_state_status
  ON voice_source_state(ingest_status, last_ingestion_at DESC);

-- ---------- 2. Voice ingestion items ----------
-- Provenance row per ingested voice sample. Decommission walks this table
-- to enumerate every R2 object the pipeline stored; retention enforcer
-- selects rows older than the customer.yaml retention window and removes
-- the corresponding R2 objects.
--
-- recipient_cohort_id is the cohort tag assigned by the pipeline at write
-- time. When the recipient has no cohort assigned in memory rules, the
-- value is 'unassigned' (NOT NULL, per AC documentation).
--
-- source_message_digest is a SHA-256 of the upstream message ID. The
-- upstream message ID itself is NOT stored — the digest lets a re-run
-- detect the same source without retaining the vendor identifier.
--
-- partner_authored is the result of the filter pass: 1 when the heuristic
-- judged the message partner-authored (no Operator provenance), 0 when
-- excluded. Excluded rows are persisted for audit but not surfaced to
-- the voice library; the dashboard can drill into them via the filter
-- explanation field.
--
-- structural_diff_digest is SHA-256 of the structural-diff payload written
-- to R2 — used by the retention enforcer to verify removal.
CREATE TABLE voice_ingestion_items (
  id                       TEXT PRIMARY KEY,    -- ULID, sortable
  source_kind              TEXT NOT NULL,
  source_id                TEXT NOT NULL,
  source_message_digest    TEXT NOT NULL,       -- SHA-256 of upstream message_id (NOT the id itself)
  recipient_cohort_id      TEXT NOT NULL,       -- cohort tag or 'unassigned'
  partner_authored         INTEGER NOT NULL,    -- 0/1 — filter result
  filter_reason            TEXT,                -- short reason when partner_authored=0
  ingested_at              TEXT NOT NULL,       -- ISO 8601 UTC
  sent_at                  TEXT NOT NULL,       -- ISO 8601 UTC; the original sent_at
  r2_key                   TEXT,                -- {slug}/voice/cohort/{cohort}/{ulid}.json; NULL when filtered out
  structural_diff_digest   TEXT,                -- SHA-256 of the structural-diff payload; NULL when filtered out
  word_count               INTEGER,             -- sample size hint for the dashboard
  schema_version           INTEGER NOT NULL DEFAULT 1,
  deleted_at               TEXT                 -- set by retention enforcer or decommission hook
);

CREATE INDEX idx_voice_items_source
  ON voice_ingestion_items(source_kind, source_id, deleted_at);

CREATE INDEX idx_voice_items_cohort
  ON voice_ingestion_items(recipient_cohort_id, ingested_at DESC)
  WHERE deleted_at IS NULL AND partner_authored = 1;

CREATE INDEX idx_voice_items_retention
  ON voice_ingestion_items(ingested_at, deleted_at);

CREATE UNIQUE INDEX idx_voice_items_dedupe
  ON voice_ingestion_items(source_kind, source_id, source_message_digest)
  WHERE deleted_at IS NULL;

-- ---------- Schema version ----------
-- 0001 set 1, 0002 set 2, 0003 set 3; this is migration 4.
PRAGMA user_version = 5;
