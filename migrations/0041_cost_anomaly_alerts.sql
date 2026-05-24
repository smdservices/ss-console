-- Per-customer cost anomaly alerts — Captain ops surface (per #886)
-- ============================================================================
--
-- Adds the `cost_anomaly_alerts` table that records each nightly anomaly
-- the cost-anomaly worker detects (per-customer daily cost ≥ threshold% of
-- the 7-day rolling average), plus the snooze/acknowledge state Captain
-- applies to those alerts from the cost dashboard.
--
-- Rows live in the central ss-console-db (not the per-customer DB) because
-- the snooze/ack surface is a Captain operations console — one Captain, all
-- customers, one query. Per ADR 0009 the per-customer DB holds
-- cost_telemetry; this table holds the *interpretation* (which days
-- breached, what action Captain took) and intentionally does not duplicate
-- the raw cost data.
--
-- The (entity_id, alert_date, driver) tuple is the natural identity. The
-- worker upserts: a re-run for the same day collapses to one row rather
-- than appending duplicates. driver may be NULL when the breach is at the
-- whole-customer level rather than driven by a single driver delta — kept
-- non-null in the PK by storing the empty string for the "all-drivers"
-- aggregate row (SQLite treats NULL in PKs as distinct, which is the wrong
-- semantics for our dedupe).
--
-- Snooze semantics: snoozed_until is an ISO 8601 UTC timestamp; the
-- dashboard hides alerts whose snoozed_until is in the future. ack'd
-- alerts are also hidden by default but remain in the table for audit.
-- Re-detecting an anomaly on a new day produces a fresh row — snoozing
-- yesterday's alert does NOT suppress today's, by design.
--
-- Forward-only, additive. No drops.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cost_anomaly_alerts (
  -- The customer the alert is about. Joined to entities for display name.
  entity_id            TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,

  -- The customer slug as stored in customer_configs. Denormalized so the
  -- Captain dashboard does not require a join to render the alert list.
  customer_slug        TEXT NOT NULL,

  -- The day the anomaly was detected for, 'YYYY-MM-DD' UTC. Matches
  -- cost_telemetry.date semantics so cross-referencing the raw rows is
  -- a string equality.
  alert_date           TEXT NOT NULL,

  -- The driver that drove the spike (top-1 by delta vs the 7-day rolling
  -- avg for that driver). Empty string '' represents the all-drivers
  -- aggregate breach. The PRD §11.x asked for "which skill drove the
  -- spike" but the v1 cost_telemetry schema does not record per-skill
  -- attribution (cost-query.ts: "Per-model and per-toolkit decomposition
  -- is phase 2"). The closest signal we *do* record is per-driver, so the
  -- alert names the driver — accurate to the data we have, no fabrication.
  driver               TEXT NOT NULL,

  -- The daily total cents the alert was raised against.
  daily_cents          INTEGER NOT NULL,

  -- The 7-day rolling average cents at the time of detection. Captured
  -- here so the dashboard can show the comparison without re-querying
  -- the per-customer DB.
  rolling_avg_cents    INTEGER NOT NULL,

  -- Ratio in basis points (daily / rolling_avg * 10000). Integer math
  -- mirrors cogsRatio in src/lib/admin/cost-query.ts.
  ratio_bps            INTEGER NOT NULL,

  -- Threshold in basis points at detection time. Default 150% = 15000
  -- bps. Stored per-row so a threshold change does not retroactively
  -- relabel historical alerts.
  threshold_bps        INTEGER NOT NULL,

  -- ISO 8601 UTC timestamp the worker created the row.
  detected_at          TEXT NOT NULL DEFAULT (datetime('now')),

  -- ISO 8601 UTC timestamp of an active snooze; the dashboard hides the
  -- alert until this timestamp passes. NULL = not snoozed.
  snoozed_until        TEXT,

  -- ISO 8601 UTC timestamp when Captain acked the alert. NULL = open.
  acknowledged_at      TEXT,

  -- Who acked it. NULL when acknowledged_at is NULL.
  acknowledged_by      TEXT REFERENCES users(id),

  PRIMARY KEY (entity_id, alert_date, driver)
);

-- Index for "list active alerts" — the dashboard's primary query.
CREATE INDEX IF NOT EXISTS idx_cost_anomaly_alerts_open
  ON cost_anomaly_alerts(detected_at DESC)
  WHERE acknowledged_at IS NULL;

-- Index for the per-customer drill-down ("alerts for this customer").
CREATE INDEX IF NOT EXISTS idx_cost_anomaly_alerts_entity
  ON cost_anomaly_alerts(entity_id, alert_date DESC);
