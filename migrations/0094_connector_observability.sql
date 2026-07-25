-- Migration 0094: connector observability (ss#1990 / ADR 0080).
--
-- Part 1 — fleet_status gains two nullable connector-health columns the
-- heartbeat ingest now stores. Plain ALTERs (no PK/CHECK change needed):
--   connectors_json     TEXT: per-MCP-server map from the seat's beat
--                       (writer-side ages; parsed defensively by the worker
--                       and the admin roster — one corrupt row degrades,
--                       never aborts a fleet loop). NULL = not reported
--                       this beat; the alerter HOLDS on NULL.
--   connector_check_ok  INTEGER 1/0/NULL, scheduler_ok semantics: 0 means
--                       the seat's connector self-check itself is broken
--                       (ledger unreadable / tool→server mapping gone) —
--                       nothing is being counted, which must PAGE, not
--                       silently disable the whole connector alert class.
--
-- Part 2 — fleet_alert_state CHECK widening. SQLite cannot ALTER a CHECK →
-- full table rebuild per the 0090/0093 template. The condition CHECK adds the
-- 'connector_check_error' literal and opens the per-connector dimension via a
-- 'connector_down:%' prefix (one alert row per failing MCP server, e.g.
-- 'connector_down:smokeball' — the composite PK (customer_slug, condition)
-- already supports it). Nothing FK-references this table; live rows are
-- copied verbatim and remain valid under the widened CHECK. Deploy ordering
-- is safe: migrations apply before the worker deploy, and old conditions
-- stay valid throughout. The integration test asserts open-alert rows
-- survive the rebuild unchanged — a mangled copy would manufacture a false
-- RECOVERED on deploy.
--
-- Manual-only rollback at
-- migrations/rollbacks/0094_connector_observability_down.sql.

PRAGMA defer_foreign_keys = ON;

-- ===========================================================================
-- Part 1 — fleet_status connector columns
-- ===========================================================================

ALTER TABLE fleet_status ADD COLUMN connectors_json TEXT;
ALTER TABLE fleet_status ADD COLUMN connector_check_ok INTEGER;

-- ===========================================================================
-- Part 2 — fleet_alert_state CHECK widening
-- ===========================================================================

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
FROM fleet_alert_state;

DROP TABLE fleet_alert_state;
ALTER TABLE fleet_alert_state_new RENAME TO fleet_alert_state;
