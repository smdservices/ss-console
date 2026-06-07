-- TARGET: ss-console-db (control plane), binding: DB
-- Per-customer observability substrate (ADR 0023 Wave 1)
-- ============================================================================
--
-- Two additive changes wired together so PR 3 (heartbeat endpoint + webhook
-- receivers + fleet view extension) has the schema it needs.
--
-- 1. SOURCE-TAG `cost_anomaly_alerts`
--    All four Wave 1 alert sources (cost, Sentry spike, healthchecks grace
--    expiration, audit-integrity in Wave 2) share one alerts surface. The
--    Captain admin dashboard at /admin/operator/costs/ is the always-on
--    monitoring view across all customers per ADR 0023 §"Cross-cutting
--    calls" #9. Routing each source into a separate table would force a
--    union reader and double the migration surface; instead we tag rows by
--    `source` with the existing `cost_anomaly_alerts` shape carrying cost
--    rows as today and the new sources carrying their per-row display via
--    `summary` / `details_json`.
--
--    Cost rows continue to use `daily_cents`, `rolling_avg_cents`,
--    `ratio_bps`, `threshold_bps` (their historical fields). Non-cost rows
--    pass 0 for those fields — the reader switches on `source` for display
--    and never interprets those columns for non-cost rows. Adding a fifth
--    source is one CHECK constraint change + one reader switch.
--
--    The existing PK `(entity_id, alert_date, driver)` continues to enforce
--    one-row-per-day-per-driver. Non-cost rows set `driver = ''` (the
--    documented all-drivers-aggregate sentinel) — they fold by day rather
--    than by driver, which is the right semantics for source-level spikes
--    (a re-flap on the same day collapses, no Captain spam).
--
-- 2. NEW `fleet_status` TABLE
--    One row per Machine. Upserted every ~60s by the heartbeat endpoint
--    (PR 3) from the in-Machine ticker (overlay PR O1). Dedicated table
--    rather than a JSON column on `entities` because the heartbeat write
--    is a hot path orthogonal to other entity updates — a JSON-column
--    upsert every 60s would contend with profile/billing/stage updates on
--    the same row.
--
--    Per ADR 0009 §"Out of scope", the control plane is allowed to maintain
--    cross-customer fleet-health state. `fleet_status` is the canonical
--    place for that state in Wave 1.
--
-- Authentication for writes to this table is documented at ADR 0023
-- §"Cross-cutting calls" #10 — single shared `MACHINE_HEARTBEAT_KEY`
-- Worker secret + `X-Tenant-Slug` header for Wave 1. The per-tenant
-- upgrade path (customer #2) doesn't touch `fleet_status`; it lands in
-- a separate `machine_credentials` table when needed.
--
-- Forward-only, additive. No drops.
-- ============================================================================

-- 1. Source-tag existing cost_anomaly_alerts.
ALTER TABLE cost_anomaly_alerts
  ADD COLUMN source TEXT NOT NULL DEFAULT 'cost'
  CHECK (source IN ('cost','sentry','healthchecks','audit_integrity'));

-- Non-cost rows populate these for display; cost rows leave them NULL.
ALTER TABLE cost_anomaly_alerts ADD COLUMN summary TEXT;
ALTER TABLE cost_anomaly_alerts ADD COLUMN details_json TEXT;

-- Filter index for source-aware open-alerts queries
-- (admin dashboard banner, future per-source filtering).
CREATE INDEX IF NOT EXISTS idx_cost_anomaly_alerts_source_open
  ON cost_anomaly_alerts(source, detected_at DESC)
  WHERE acknowledged_at IS NULL;

-- 2. Per-customer heartbeat snapshot. One row per Machine.
CREATE TABLE IF NOT EXISTS fleet_status (
  -- FK to entities (the customer this Machine serves). Cascade so
  -- deletion is clean during decommission (PR 5).
  entity_id                 TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,

  -- Denormalized customer slug for fast lookup by the heartbeat endpoint
  -- (which receives X-Tenant-Slug, resolves to entity_id, then upserts).
  customer_slug             TEXT NOT NULL UNIQUE,

  -- ISO 8601 UTC timestamps mirroring the /health response shape from
  -- the overlay (heartbeat_ts is what the in-Machine ticker writes;
  -- last_audit_ts / last_skill_ts come from the Hermes runtime).
  last_heartbeat_ts         TEXT,
  last_audit_ts             TEXT,
  last_skill_ts             TEXT,

  -- Process uptime since last Machine restart (seconds).
  process_uptime_seconds    INTEGER,

  -- Hermes version / overlay version string for the running Machine,
  -- carried for the dashboard's drill-down. Free-form by design — the
  -- overlay decides what string is most useful.
  version                   TEXT,

  -- Coarse status used by the fleet-view column. The admin page
  -- recomputes the color server-side from `last_heartbeat_ts` and the
  -- customer's `observability.health.period_seconds` /
  -- `grace_minutes` (default 60 / 5), so this column is effectively a
  -- cache that the healthchecks webhook handler also writes to ('red')
  -- when grace expires. Two writers, one signal — Decision #3 in the
  -- ADR 0023 implementation plan.
  heartbeat_status          TEXT NOT NULL DEFAULT 'unknown'
    CHECK (heartbeat_status IN ('green','yellow','red','unknown')),

  -- Sentry error count for the last 24h window. Synced once per day by
  -- the cost-anomaly cron's new Sentry-sync step (PR 4). NULL until the
  -- first sync runs for this customer.
  sentry_errors_last_24h    INTEGER,
  sentry_errors_synced_at   TEXT,

  -- Row-level updated_at, distinct from any of the heartbeat timestamps.
  -- Used for cache-invalidation reasoning and the admin row's tooltip.
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lookup by slug (heartbeat endpoint path).
CREATE INDEX IF NOT EXISTS idx_fleet_status_slug
  ON fleet_status(customer_slug);
