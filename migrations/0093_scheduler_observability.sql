-- Migration 0093: scheduler observability — re-key fleet_status on customer_slug
-- and widen the fleet_alert_state condition CHECK for two new conditions.
--
-- Two independent rebuilds in one file (D1 wraps the whole file in one atomic
-- transaction), following the 0090 rebuild template exactly.
--
-- ---------------------------------------------------------------------------
-- Rebuild A — fleet_status re-key (WP-0 finding 1).
--
-- fleet_status was `entity_id TEXT PRIMARY KEY` (migration 0044). The
-- multi-operator model (live 2026-07-08) puts several seats on ONE entity, so
-- two seats upserting one entity_id collapsed into a single row: the first
-- slug stuck and one seat's green masked the other's death. That wedged fleet
-- alerting for 16 days (pilot-smokeball's 07-08 heartbeat_red became a
-- permanently-orphaned open row, since no pilot-smokeball fleet_status row
-- could exist). The fix moves the PK from entity_id to customer_slug (already
-- NOT NULL UNIQUE, and already the fleet identity → Fly app). entity_id
-- becomes a plain, indexed, non-unique FK (ON DELETE CASCADE preserved).
--
-- Same rebuild adds three nullable scheduler-liveness columns the heartbeat
-- ingest now stores (scheduler_ok 1/0/NULL, job_count, max_overdue_seconds).
--
-- fleet_status is a PURE child — nothing FK-references it (only its own slug
-- index named it), so no child dance is needed. defer_foreign_keys keeps its
-- OWN outgoing FK (entity_id->entities) satisfied across INSERT..SELECT +
-- drop/rename. Column list reconciled against LIVE sqlite_master: 0044 base +
-- sticky_stop_level (0082).
--
-- ---------------------------------------------------------------------------
-- Rebuild B — fleet_alert_state CHECK widening.
--
-- SQLite cannot ALTER a CHECK constraint → full table rebuild per the same
-- template. The condition CHECK widens to add 'scheduler_error' and
-- 'work_overdue'. Nothing FK-references this table; the 2 live rows
-- (heartbeat_red / hard_stop history) are copied verbatim and stay valid
-- under the widened CHECK. Deploy ordering is safe: migrations apply before
-- the worker deploy, and old conditions remain valid throughout.
--
-- Manual-only rollback at
-- migrations/rollbacks/0093_scheduler_observability_down.sql.

PRAGMA defer_foreign_keys = ON;

-- ===========================================================================
-- Rebuild A — fleet_status
-- ===========================================================================

CREATE TABLE fleet_status_new (
  customer_slug                 TEXT PRIMARY KEY,
  entity_id                     TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  last_heartbeat_ts             TEXT,
  last_audit_ts                 TEXT,
  last_skill_ts                 TEXT,
  process_uptime_seconds        INTEGER,
  version                       TEXT,
  heartbeat_status              TEXT NOT NULL DEFAULT 'unknown'
    CHECK (heartbeat_status IN ('green','yellow','red','unknown')),
  sentry_errors_last_24h        INTEGER,
  sentry_errors_synced_at       TEXT,
  updated_at                    TEXT NOT NULL DEFAULT (datetime('now')),
  sticky_stop_level             TEXT,
  -- Scheduler-liveness signals from the gate's per-beat self-check (WP-2).
  -- All nullable: NULL = not reported this beat (never coerced to a verdict).
  scheduler_ok                  INTEGER,  -- 1 healthy / 0 broken / NULL unreported
  scheduler_job_count           INTEGER,
  scheduler_max_overdue_seconds INTEGER
);

INSERT INTO fleet_status_new (
  customer_slug, entity_id, last_heartbeat_ts, last_audit_ts, last_skill_ts,
  process_uptime_seconds, version, heartbeat_status, sentry_errors_last_24h,
  sentry_errors_synced_at, updated_at, sticky_stop_level)
SELECT
  customer_slug, entity_id, last_heartbeat_ts, last_audit_ts, last_skill_ts,
  process_uptime_seconds, version, heartbeat_status, sentry_errors_last_24h,
  sentry_errors_synced_at, updated_at, sticky_stop_level
FROM fleet_status;

DROP TABLE fleet_status;
ALTER TABLE fleet_status_new RENAME TO fleet_status;

-- customer_slug's UNIQUE index is now the PK (implicit), so the old
-- idx_fleet_status_slug is intentionally NOT recreated. entity_id was the PK
-- before (implicitly indexed); it now needs an explicit index for the roster's
-- entity fallback join.
CREATE INDEX idx_fleet_status_entity ON fleet_status(entity_id);

-- ===========================================================================
-- Rebuild B — fleet_alert_state
-- ===========================================================================

CREATE TABLE fleet_alert_state_new (
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

INSERT INTO fleet_alert_state_new (
  customer_slug, condition, status, opened_at, resolved_at, last_alert_id, updated_at)
SELECT
  customer_slug, condition, status, opened_at, resolved_at, last_alert_id, updated_at
FROM fleet_alert_state;

DROP TABLE fleet_alert_state;
ALTER TABLE fleet_alert_state_new RENAME TO fleet_alert_state;
