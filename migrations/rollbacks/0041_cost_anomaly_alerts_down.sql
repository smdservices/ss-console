-- Rollback for 0041_cost_anomaly_alerts.sql
DROP INDEX IF EXISTS idx_cost_anomaly_alerts_entity;
DROP INDEX IF EXISTS idx_cost_anomaly_alerts_open;
DROP TABLE IF EXISTS cost_anomaly_alerts;
