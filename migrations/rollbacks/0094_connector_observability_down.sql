-- Rollback for 0094: drop the two fleet_status connector columns and narrow
-- the fleet_alert_state condition CHECK back to the four 0093 conditions.
--
-- SAFETY — one way this rollback can (intentionally) FAIL: the narrowed CHECK
-- rejects any surviving 'connector_check_error' / 'connector_down:%' rows.
-- Delete those alert rows before running this.
--
-- Manual-only; coordinate with Captain. D1 wraps this file in one atomic
-- transaction.

PRAGMA defer_foreign_keys = ON;

-- ===========================================================================
-- Part 1 — drop the connector columns (SQLite supports DROP COLUMN for
-- plain, unindexed, non-PK columns — both qualify)
-- ===========================================================================

ALTER TABLE fleet_status DROP COLUMN connectors_json;
ALTER TABLE fleet_status DROP COLUMN connector_check_ok;

-- ===========================================================================
-- Part 2 — fleet_alert_state back to the 0093 CHECK
-- ===========================================================================

CREATE TABLE fleet_alert_state_old (
  customer_slug   TEXT NOT NULL,
  condition       TEXT NOT NULL
    CHECK (condition IN ('heartbeat_red','hard_stop','scheduler_error','work_overdue')),
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
