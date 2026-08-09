-- 0103: connector token-expiry alerting (ss#2148, amends ADR 0080)
--
-- Two changes:
--
-- 1. fleet_status gains connector_token_age_json — the seat-reported map of
--    server → durable-credential file age in seconds (heartbeat field
--    connector_token_age, overlay connector_check.token_ages()). A SEPARATE
--    column from connectors_json by design: token age must never synthesize a
--    health entry (a fabricated consecutive_failures=0 would falsely RESOLVE
--    an open connector_down alert).
--
-- 2. fleet_alert_state's condition CHECK widens to accept
--    connector_token_expiring:<server>. SQLite cannot ALTER a CHECK, so this
--    is the full-table rebuild, copied from migration 0094's template (which
--    itself notes the pattern). Composite PK preserved: one alert row per
--    (seat, condition).

ALTER TABLE fleet_status ADD COLUMN connector_token_age_json TEXT;

CREATE TABLE fleet_alert_state_new (
  customer_slug   TEXT NOT NULL,
  condition       TEXT NOT NULL
    CHECK (
      condition IN ('heartbeat_red','hard_stop','scheduler_error','work_overdue','connector_check_error')
      OR condition LIKE 'connector_down:%'
      OR condition LIKE 'connector_token_expiring:%'
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
FROM fleet_alert_state;

DROP TABLE fleet_alert_state;
ALTER TABLE fleet_alert_state_new RENAME TO fleet_alert_state;
