-- Rollback for 0103: drop the token-age column and narrow the
-- fleet_alert_state CHECK back to the 0094 vocabulary. Open
-- connector_token_expiring rows are dropped by the copy filter — they cannot
-- satisfy the narrowed CHECK.

ALTER TABLE fleet_status DROP COLUMN connector_token_age_json;

CREATE TABLE fleet_alert_state_new (
  customer_slug   TEXT NOT NULL,
  condition       TEXT NOT NULL
    CHECK (
      condition IN ('heartbeat_red','hard_stop','scheduler_error','work_overdue','connector_check_error')
      OR condition LIKE 'connector_down:%'
    ),
  status          TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  opened_at       TEXT NOT NULL,
  resolved_at     TEXT,
  last_alert_id   TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (customer_slug, condition)
);

INSERT INTO fleet_alert_state_new (
  customer_slug, condition, status, opened_at, resolved_at, last_alert_id, updated_at)
SELECT
  customer_slug, condition, status, opened_at, resolved_at, last_alert_id, updated_at
FROM fleet_alert_state
WHERE condition NOT LIKE 'connector_token_expiring:%';

DROP TABLE fleet_alert_state;
ALTER TABLE fleet_alert_state_new RENAME TO fleet_alert_state;
