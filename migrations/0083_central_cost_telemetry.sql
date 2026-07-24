-- 0083: central cost telemetry (ADR 0062, #1660).
--
-- ADR 0062 supersedes the per-customer-D1 placement of the Operator cost
-- tables. The per-customer databases specced in operator/migrations/0001
-- and 0006 were never provisioned (ADR 0009's wiring note: that storage
-- model "was never built"), so the cost pipeline has been dark since it
-- shipped. Cost rows are SMD's own spend metadata, not customer content,
-- and ADR 0009 explicitly carves out control-plane billing reconciliation.
-- These tables therefore live in the central ss-console-db with a
-- customer_slug tenant column, following the fleet_status pattern
-- (ADR 0023).
--
-- Reserved customer_slug values (not real customers, never rendered as
-- customer rows by the dashboard, excluded from anomaly detection):
--
--   '_org'      — org-level reconciliation rows written by the
--                 ss-cost-telemetry worker under the drivers
--                 'anthropic.org_total.input_tokens' /
--                 'anthropic.org_total.output_tokens'. The org total is a
--                 cross-check against the sum of per-workspace rows, not
--                 an attribution source.
--   '_unmapped' — usage attributed by Anthropic to a workspace_id that no
--                 customer_configs.anthropic_workspace_id claims. Nothing
--                 is silently dropped; the worker logs the workspace id.
--
-- Write semantics: the nightly worker writes idempotent day totals
-- (ON CONFLICT ... SET amount_cents = excluded.amount_cents), because the
-- Anthropic usage-report API returns the authoritative total for the day.
-- The additive accumulate-on-conflict contract in cost-telemetry-events.md
-- applies to per-event emitters (the captain-time CLI rollup), not to this
-- vendor-report ingest.

CREATE TABLE IF NOT EXISTS cost_telemetry (
  customer_slug TEXT NOT NULL,              -- customer_configs.customer_slug, or '_org' / '_unmapped'
  date          TEXT NOT NULL,              -- YYYY-MM-DD (UTC)
  driver        TEXT NOT NULL,              -- enum per cost-telemetry-events.md, plus the '_org' reconciliation drivers
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  units         REAL,                       -- e.g. tokens, minutes
  unit_type     TEXT,
  updated_at    TEXT,                       -- ISO 8601 UTC of the last write
  PRIMARY KEY (customer_slug, date, driver)
);

-- Cross-customer daily scans (anomaly windows, dashboard totals). The PK
-- covers per-customer reads; this index serves date-first queries.
CREATE INDEX IF NOT EXISTS idx_cost_telemetry_date
  ON cost_telemetry(date);

-- Captain time events, event-sourced (mirrors the per-customer shape from
-- operator/migrations/0006 plus the customer_slug tenant column). One row
-- per `crane operator log-time` invocation; the CLI pairs each insert with
-- an additive UPSERT into cost_telemetry under driver='captain_time'.
-- Intentionally not UPSERT-keyed: two distinct 15-minute sessions on the
-- same day both persist.
CREATE TABLE IF NOT EXISTS captain_time_events (
  id            TEXT PRIMARY KEY,           -- ULID
  customer_slug TEXT NOT NULL,
  ts            TEXT NOT NULL,              -- ISO 8601 UTC of CLI invocation
  date          TEXT NOT NULL,              -- YYYY-MM-DD; --date flag, defaults to today UTC
  activity      TEXT NOT NULL,              -- closed activity-tag taxonomy
  minutes       INTEGER NOT NULL,           -- > 0 and <= 600
  amount_cents  INTEGER NOT NULL,           -- (minutes * 200 * 100) / 60 at the $200/hr Captain rate
  note          TEXT                        -- optional free text, <= 280 chars
);
CREATE INDEX IF NOT EXISTS idx_captain_time_customer_date
  ON captain_time_events(customer_slug, date);
CREATE INDEX IF NOT EXISTS idx_captain_time_activity
  ON captain_time_events(activity, date);

-- The authored workspace mapping for per-seat attribution (ADR 0062
-- decision 2). Captain creates one Anthropic workspace per seat in the
-- Anthropic Console and records its id here (wrkspc_...). NULL means the
-- seat is not yet attributed: its usage lands under '_unmapped' and only
-- the '_org' reconciliation row is authoritative until the mapping is
-- authored. See docs/runbooks/operator/cost-telemetry-enable.md.
ALTER TABLE customer_configs ADD COLUMN anthropic_workspace_id TEXT;
