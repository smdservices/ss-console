-- Rollback for 0093: restore fleet_status with entity_id as PRIMARY KEY (dropping
-- the three scheduler columns) and narrow the fleet_alert_state condition CHECK
-- back to the original two conditions.
--
-- SAFETY — two ways this rollback can (intentionally) FAIL:
--   1. Rebuild A sets entity_id as the PK again, so it fails if any entity now
--      owns more than one fleet_status row (i.e. the multi-operator masking bug
--      is actually being avoided). That is the whole point of 0093; resolve the
--      extra rows first if you truly must collapse back.
--   2. Rebuild B's narrowed CHECK rejects any surviving 'scheduler_error' /
--      'work_overdue' rows. Delete those alert rows before running this.
--
-- Manual-only; coordinate with Captain. D1 wraps this file in one atomic
-- transaction.

PRAGMA defer_foreign_keys = ON;

-- ===========================================================================
-- Rebuild A — fleet_status back to entity_id PK, drop scheduler columns
-- ===========================================================================

CREATE TABLE fleet_status_old (
  entity_id                 TEXT PRIMARY KEY REFERENCES entities(id) ON DELETE CASCADE,
  customer_slug             TEXT NOT NULL UNIQUE,
  last_heartbeat_ts         TEXT,
  last_audit_ts             TEXT,
  last_skill_ts             TEXT,
  process_uptime_seconds    INTEGER,
  version                   TEXT,
  heartbeat_status          TEXT NOT NULL DEFAULT 'unknown'
    CHECK (heartbeat_status IN ('green','yellow','red','unknown')),
  sentry_errors_last_24h    INTEGER,
  sentry_errors_synced_at   TEXT,
  updated_at                TEXT NOT NULL DEFAULT (datetime('now')),
  sticky_stop_level         TEXT
);

INSERT INTO fleet_status_old (
  entity_id, customer_slug, last_heartbeat_ts, last_audit_ts, last_skill_ts,
  process_uptime_seconds, version, heartbeat_status, sentry_errors_last_24h,
  sentry_errors_synced_at, updated_at, sticky_stop_level)
SELECT
  entity_id, customer_slug, last_heartbeat_ts, last_audit_ts, last_skill_ts,
  process_uptime_seconds, version, heartbeat_status, sentry_errors_last_24h,
  sentry_errors_synced_at, updated_at, sticky_stop_level
FROM fleet_status;

DROP TABLE fleet_status;
ALTER TABLE fleet_status_old RENAME TO fleet_status;

CREATE INDEX idx_fleet_status_slug ON fleet_status(customer_slug);

-- ===========================================================================
-- Rebuild B — fleet_alert_state back to the original two conditions
-- ===========================================================================

CREATE TABLE fleet_alert_state_old (
  customer_slug   TEXT NOT NULL,
  condition       TEXT NOT NULL CHECK (condition IN ('heartbeat_red', 'hard_stop')),
  status          TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  opened_at       TEXT NOT NULL,
  resolved_at     TEXT,
  last_alert_id   TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (customer_slug, condition)
);

INSERT INTO fleet_alert_state_old (
  customer_slug, condition, status, opened_at, resolved_at, last_alert_id, updated_at)
SELECT
  customer_slug, condition, status, opened_at, resolved_at, last_alert_id, updated_at
FROM fleet_alert_state;

DROP TABLE fleet_alert_state;
ALTER TABLE fleet_alert_state_old RENAME TO fleet_alert_state;
