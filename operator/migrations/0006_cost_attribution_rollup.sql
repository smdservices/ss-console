-- ============================================================================
-- Migration 0006: cost attribution rollup support (issue #884)
-- ============================================================================
--
-- Per-customer cost attribution rollup. The daily-roll `cost_telemetry` table
-- already exists from migration 0001 with the shape
-- `(date, driver, amount_cents, units, unit_type) PRIMARY KEY (date, driver)`
-- per the cost-telemetry-events.md spec on main. This migration adds the
-- per-event Captain time table referenced by that spec but not yet created,
-- and supporting indexes that accelerate the monthly rollup query in
-- operator/adapter/cost_rollup.py.
--
-- Two changes:
--
--   1. captain_time_events — per-event row written by the
--      `crane operator log-time` CLI. The CLI also UPSERTs a same-day
--      summary into cost_telemetry under driver='captain_time' so the
--      §17.1 COGS/MRR rollup reads from a single source. Per-event detail
--      (activity, note) lives here for Captain-only audit and per-activity
--      cost reporting. Schema is the authoritative copy from
--      d1-schema.md §6 (cost telemetry).
--
--   2. cost_telemetry index on (date) — the rollup query reads a month
--      range across all drivers; the (date, driver) PK already covers
--      single-day point reads but the monthly scan benefits from a
--      stand-alone date index.
--
-- Privacy posture (ADR 0009):
--   Both objects live in the per-customer D1 database. No cross-customer
--   table. Isolation enforced by the binding layer, not a row-level
--   customer_id column.
--
-- Compatibility:
--   New objects only. No drops, no column changes, no constraint changes.
--   Existing cost_telemetry rows are untouched and remain readable by the
--   rollup module without further migration.
--
-- Source spec: docs/specs/operator/cost-attribution-rollup.md (issue #884)
-- Refers to:   docs/specs/operator/cost-telemetry-events.md (issue #804)
--              docs/specs/operator/d1-schema.md (issue #800)
-- ============================================================================

-- ---------- 1. Captain time events (per-event audit) ----------
-- One row per `crane operator log-time` invocation. The CLI computes
-- amount_cents as (minutes * 200 * 100) / 60 using the $200/hr loaded rate
-- defined in platform-prd.md §15.1 and CLAUDE.md.
--
-- The CLI pairs this INSERT with an UPSERT into cost_telemetry for the same
-- (date, 'captain_time') key. Re-running the same command writes a second
-- row here and accumulates in cost_telemetry — by design. See
-- cost-telemetry-events.md "Captain time logging".
CREATE TABLE captain_time_events (
  id            TEXT PRIMARY KEY,           -- ULID, sortable
  ts            TEXT NOT NULL,              -- ISO 8601 UTC of CLI invocation
  date          TEXT NOT NULL,              -- YYYY-MM-DD; --date flag, defaults to today UTC
  activity      TEXT NOT NULL,              -- enum from platform-prd.md §15.2 activity-tag taxonomy
  minutes       INTEGER NOT NULL,           -- > 0 and <= 600
  amount_cents  INTEGER NOT NULL,           -- (minutes * 200 * 100) / 60 at $200/hr Captain rate
  note          TEXT                        -- optional free text, <= 280 chars
);
CREATE INDEX idx_captain_time_date ON captain_time_events(date);
CREATE INDEX idx_captain_time_activity ON captain_time_events(activity, date);

-- ---------- 2. Cost telemetry monthly-scan index ----------
-- The PRIMARY KEY (date, driver) on cost_telemetry already covers exact
-- (date, driver) reads and ordered (date, driver) range scans. The monthly
-- rollup query scans a date range across every driver — the leading-date
-- PK is sufficient, but a stand-alone date index gives the planner the
-- option of an index-only scan when only date and the aggregate cents are
-- needed. Cheap to add, prevents a regression if the PK ordering changes.
CREATE INDEX IF NOT EXISTS idx_cost_telemetry_date
  ON cost_telemetry(date);

-- ---------- Schema version ----------
-- 0001 set 1, 0002 set 2, 0003 set 3, 0004 set 4, 0005 set 5; this is 6.
PRAGMA user_version = 6;
