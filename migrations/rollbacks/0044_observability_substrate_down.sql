-- Manual rollback for migration 0044. NOT auto-applied.
-- See migrations/rollbacks/README.md.
--
-- DESTRUCTIVE + ASYMMETRIC: 0044 did two things — created fleet_status, and
-- source-tagged cost_anomaly_alerts with three ADDed columns (source, summary,
-- details_json). This reverses both, in reverse creation order.
--
-- WARNING (data loss): if any cost_anomaly_alerts rows were written with
-- source != 'cost' (sentry / healthchecks / audit_integrity), dropping the
-- `source` column collapses them back into undifferentiated cost rows —
-- summary/details_json are dropped with them. Confirm no non-cost alert rows
-- matter before running, or archive them first.
--
-- DROP COLUMN requires SQLite >= 3.35 (Cloudflare D1 satisfies this). If run
-- against an older engine, fall back to the 12-step table rebuild.

-- 2. fleet_status (reverse of creation).
DROP INDEX IF EXISTS idx_fleet_status_slug;
DROP TABLE IF EXISTS fleet_status;

-- 1. cost_anomaly_alerts source-tagging (reverse of creation).
DROP INDEX IF EXISTS idx_cost_anomaly_alerts_source_open;
ALTER TABLE cost_anomaly_alerts DROP COLUMN details_json;
ALTER TABLE cost_anomaly_alerts DROP COLUMN summary;
ALTER TABLE cost_anomaly_alerts DROP COLUMN source;
