-- 0086: fleet_alert_state — edge-trigger state for the heartbeat-red /
-- HARD_STOP alerter (#1709, ADR 0064 honesty-banner closure).
--
-- The ss-fleet-alerts Worker evaluates fleet_status on a schedule and emails
-- team@smd.services on condition TRANSITIONS, not on every cycle. This table
-- is the one-open-alert-per-(customer, condition) memory that makes the
-- alerting edge-triggered: a row flips open on the first red evaluation and
-- resolved on the first green one, and each flip sends exactly one email.

CREATE TABLE fleet_alert_state (
  customer_slug   TEXT NOT NULL,
  condition       TEXT NOT NULL CHECK (condition IN ('heartbeat_red', 'hard_stop')),
  status          TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  opened_at       TEXT NOT NULL,
  resolved_at     TEXT,
  last_alert_id   TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (customer_slug, condition)
);
