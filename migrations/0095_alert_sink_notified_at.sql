-- Migration 0095: alert-sink delivery marker (Sentry quota incident 2026-07-18).
--
-- The gap this closes. `cost_anomaly_alerts` is the shared alert sink: 0044
-- source-tagged it so `sentry`, `healthchecks`, and `audit_integrity` rows land
-- alongside cost rows. Both non-cost writers were built (src/pages/api/webhooks/
-- {sentry,healthchecks}.ts) — but a row written by either surfaces ONLY as an
-- admin dashboard banner. The fleet-alerts Worker, which owns the pager, reads
-- `fleet_status` and never looks at this table. So a Sentry alert could arrive
-- and reach nobody unless a human happened to open the console.
--
-- That is the same built-not-wired shape ADR 0079 catalogued four layers deep,
-- and it is why the 2026-07-16 cron outage burned the entire monthly Sentry
-- budget before anyone noticed: the signal had no push path.
--
-- `notified_at` is the per-row delivery marker. It is deliberately NOT
-- `acknowledged_at`, which already exists and means something different — a
-- HUMAN acknowledged this alert. Delivery and acknowledgement are independent:
-- an alert can be delivered and unacknowledged (the normal case), and
-- conflating them would let a human ack suppress delivery of a later alert.
--
-- Cost rows are stamped notified at insert time by this migration's backfill:
-- the cost-anomaly Worker already emails its own alerts inside its nightly run,
-- so leaving them NULL would make the new notifier re-send every historical
-- cost anomaly on its first pass.
--
-- Forward-only, additive. No drops.
-- ============================================================================

ALTER TABLE cost_anomaly_alerts ADD COLUMN notified_at TEXT;

-- Backfill: everything that exists at migration time is considered delivered.
-- Cost rows genuinely were (the cost Worker emailed them). Non-cost rows do not
-- exist yet — both webhook receivers have written zero rows, confirmed against
-- prod D1 on 2026-07-25 — so this cannot suppress a real undelivered alert.
UPDATE cost_anomaly_alerts SET notified_at = detected_at WHERE notified_at IS NULL;

-- The notifier's hot query: undelivered non-cost rows, oldest first.
CREATE INDEX IF NOT EXISTS idx_cost_anomaly_alerts_undelivered
  ON cost_anomaly_alerts(source, detected_at)
  WHERE notified_at IS NULL;
