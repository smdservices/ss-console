-- Operator runtime-summary store — ADR 0043 path B
-- ============================================================================
--
-- The console-side per-customer summary the admin fleet view reads. Each
-- per-customer Machine pushes a small set of read-relevant summary rows here
-- (generalizing the fleet_status heartbeat pattern, ADR 0023): a health
-- rollup, last-activity timestamp, open-alert count, and draft-queue depth.
--
-- Why a summary mirror and not a live read for the fleet (ADR 0043):
--   - The fleet roster must stay answerable even when a Machine is briefly
--     down — a mirror survives that; a live read would break the whole view.
--   - The highest-traffic view pays no per-request round-trip.
--   - Carries a bounded staleness window (the push cadence) — acceptable for
--     summary/rollup data, surfaced via `pushed_at` so the UI can label
--     "health as of N seconds ago".
--
-- ISOLATION (ADR 0009): every row is keyed to ONE customer. Fleet rollups read
-- many of these per-customer summary rows but NEVER join two Machines' runtime
-- D1. Deep, fresh detail uses the live per-customer read path (ADR 0043 path A,
-- src/lib/operator/runtime-read.ts) — not this mirror.
--
-- Append-via-upsert (one row per customer). Forward-only, additive. No drops.
-- ============================================================================

CREATE TABLE IF NOT EXISTS operator_runtime_summary (
  entity_id          TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  customer_slug      TEXT NOT NULL UNIQUE,

  -- Health rollup pushed by the Machine. Distinct from fleet_status liveness:
  -- this folds in sticky-stop state, escalation pressure, connector health —
  -- "is the operator OK", not just "is the process alive".
  summary_status     TEXT NOT NULL DEFAULT 'unknown'
                       CHECK (summary_status IN ('green', 'yellow', 'red', 'unknown')),

  -- Count of unresolved alert signals (red-flags / failures / invariant
  -- triggers) on the Machine. Drives the fleet alert feed badge.
  open_alerts        INTEGER NOT NULL DEFAULT 0,

  -- Pending review items when a skill is authored to draft. NULL when the
  -- operator has no draft-authored skills (an honest "no queue" vs "0 pending").
  draft_queue_depth  INTEGER,

  -- Most recent agent activity timestamp (ISO 8601 UTC), for the roster's
  -- "last active" column. NULL before first activity.
  last_activity_ts   TEXT,

  -- When the Machine last pushed this summary (ISO 8601 UTC). The staleness
  -- window: the reader marks the row stale if this is too old.
  pushed_at          TEXT NOT NULL,

  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_operator_runtime_summary_slug
  ON operator_runtime_summary (customer_slug);
