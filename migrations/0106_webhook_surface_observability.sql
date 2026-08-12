-- 0106: webhook expected-tool surface alerting (ss#2287, closes the ss#2222 warn tier)
--
-- The defect (ss#2287, found by the #2280 identity-key join audit): the seat has
-- emitted `webhook_surface_ok` + `webhook_surface` on EVERY heartbeat since
-- ss#2222 — the agent process writes a pid-stamped sentinel at
-- $HERMES_HOME/.smd/webhook_surface.json, the gate's
-- shared/webhook_surface_check.check() reads it behind a pid-liveness staleness
-- guard, and shared/heartbeat.py puts both fields on the wire. ss-console had no
-- column, no parser, and no condition for either. The overlay docstring says the
-- empty map "is what RESOLVES an open alert"; there was no alert to resolve. The
-- entire warn tier was written and dropped at ingest.
--
-- Two changes, mirroring 0104 (spec_control) because the fault shape is the same:
--
-- 1. fleet_status gains webhook_surface_json + webhook_surface_ok — the seat's
--    comparison of shared.webhook_read_surface.WEBHOOK_EXPECTED_TOOLS (today:
--    operator_seat_facts) against the tools the resolved webhook toolset
--    actually offers. Map shape: tool name -> {expected, offered}.
--
--    webhook_surface_ok is a SEPARATE column from the map for 0104's reason,
--    which is the whole point of the split: ok=0 means the seat could not
--    resolve its own surface — "we cannot look" — which is OUR blindness and
--    must never be reported as a missing tool. An unresolvable surface and a
--    complete one both produce an absent map and want opposite responses.
--    NULL is a THIRD state and never a verdict: no sentinel, an unparseable
--    one, or one written by a dead pid all mean "hold what you last knew".
--
-- 2. fleet_alert_state's condition CHECK widens to accept
--    webhook_surface_missing:<tool> and webhook_surface_unprovable. Keyed per
--    TOOL, not per seat: the expected-tool tuple can grow, and one tool
--    returning must not clear the alert on another still absent.
--    SQLite cannot ALTER a CHECK, so this is the full-table rebuild copied from
--    0104 (itself copied from 0103, itself from 0094). Composite PK preserved:
--    one alert row per (seat, condition).
--
-- Ordering is safe by construction: migrations apply before the worker deploy,
-- and every pre-existing condition value stays valid throughout.

ALTER TABLE fleet_status ADD COLUMN webhook_surface_json TEXT;
ALTER TABLE fleet_status ADD COLUMN webhook_surface_ok INTEGER;

CREATE TABLE fleet_alert_state_new (
  customer_slug   TEXT NOT NULL,
  condition       TEXT NOT NULL
    CHECK (
      condition IN ('heartbeat_red','hard_stop','scheduler_error','work_overdue','connector_check_error','spec_control_unprovable','webhook_surface_unprovable')
      OR condition LIKE 'connector_down:%'
      OR condition LIKE 'connector_token_expiring:%'
      OR condition LIKE 'spec_control_broken:%'
      OR condition LIKE 'webhook_surface_missing:%'
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
