-- 0104: authored-spec control alerting (ss#2234, amends ADR 0083)
--
-- The incident this closes (ss#2228): pilot-smokeball declared
-- output_classes.staff.voice_spec: expected and the staff spec was never
-- installed. Every autonomous staff send refused for six days with a remedy the
-- model could not perform, the firm's escalations fell into matter memos nobody
-- watches, and NOTHING ALERTED. The gate noticed every time and wrote an audit
-- row; an audit row is a record, not an alarm.
--
-- Two changes:
--
-- 1. fleet_status gains spec_control_json + spec_control_ok — the seat-reported
--    comparison of what customer.yaml DECLARES against what the root-owned spec
--    manifest has INSTALLED (heartbeat fields spec_control / spec_control_ok,
--    overlay shared/spec_control_check.py). Reported on the heartbeat rather
--    than at the send site on purpose: a control's health must not depend on
--    the seat happening to send something.
--
--    spec_control_ok is a SEPARATE column from the map, and the distinction is
--    the whole point: ok=0 means the seat could not read its own config or
--    manifest — "we cannot look" — which is OUR fault and must never be
--    reported as the firm's missing spec. An unreadable manifest and an empty
--    one produce identical emptiness and want opposite responses.
--
-- 2. fleet_alert_state's condition CHECK widens to accept
--    spec_control_broken:<class>.<property> and spec_control_unprovable.
--    Keyed per PROPERTY, not per class: a seat can have staff.voice installed
--    and staff.format missing, and resolving one must not clear the other.
--    SQLite cannot ALTER a CHECK, so this is the full-table rebuild copied from
--    0103 (itself copied from 0094). Composite PK preserved: one alert row per
--    (seat, condition).
--
-- Ordering is safe by construction: migrations apply before the worker deploy,
-- and every pre-existing condition value stays valid throughout.

ALTER TABLE fleet_status ADD COLUMN spec_control_json TEXT;
ALTER TABLE fleet_status ADD COLUMN spec_control_ok INTEGER;

CREATE TABLE fleet_alert_state_new (
  customer_slug   TEXT NOT NULL,
  condition       TEXT NOT NULL
    CHECK (
      condition IN ('heartbeat_red','hard_stop','scheduler_error','work_overdue','connector_check_error','spec_control_unprovable')
      OR condition LIKE 'connector_down:%'
      OR condition LIKE 'connector_token_expiring:%'
      OR condition LIKE 'spec_control_broken:%'
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
