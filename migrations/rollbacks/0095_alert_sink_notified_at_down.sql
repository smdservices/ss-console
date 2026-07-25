-- Rollback for 0095: drop the alert-sink delivery marker.
--
-- Dropping `notified_at` returns the sink to banner-only display. The
-- fleet-alerts sink notifier must be reverted in the same breath — without the
-- column its query fails and every run throws, which would take the whole
-- pager down with it.
-- ============================================================================

DROP INDEX IF EXISTS idx_cost_anomaly_alerts_undelivered;

ALTER TABLE cost_anomaly_alerts DROP COLUMN notified_at;
