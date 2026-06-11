-- The `service` spine — DDL (ADR 0046, Stage 1)
-- ============================================================================
--
-- A polymorphic commercial record: one row per "thing a client bought."
-- Consulting engagements and operator subscriptions are two TYPES of the same
-- genus — a service the client purchased. This is the thin shared parent; the
-- delivery records (engagements, subscriptions) point UP at it via service_id.
--
-- WHY A NEW PARENT (not generalize `engagements`):
--   `engagements` carries consulting-only columns (scope_summary, handoff_date,
--   safety_net_end, consultant_*, NOT NULL quote_id). None fit an operator.
--   A thin parent + two typed children is cleaner than nulling half a table.
--
-- WHY type AND cadence are orthogonal (not collapsed):
--   Today consulting⇒one_time and operator⇒recurring 1:1, but ADR 0037 Tenet 2
--   (configurable substrate) means a future operator pilot could be one_time.
--   Two columns cost nothing and prevent a later migration.
--
-- recurring_price is REAL to match the existing money convention
-- (invoices.amount, quotes.total_price are REAL). NULL until authored per-quote
-- in Stage 2 (an operator instance is priced per-client at quote time, exactly
-- like a consulting engagement — not a global constant).
--
-- status is a COARSE COMMERCIAL ROLLUP, deliberately separate from the rich
-- delivery lifecycle. engagements.status / subscriptions.status remain the
-- AUTHORITATIVE lifecycle; services.status is a projection (see
-- src/lib/db/services.ts projectConsultingStatus/projectOperatorStatus, used by
-- both backfill + runtime).
--   proposed  — quoted, not yet accepted. Unreachable in Stage 1 (services are
--               created only at acceptance); reachable from Stage 2.
--   active    — committed/live revenue line (signed or being stood up → in delivery).
--   completed — delivered and done.
--   churned   — cancelled/ended.
--
-- D1 NOTE: FK constraints are advisory and ADD COLUMN cannot attach a real FK
-- without a table rebuild, so engagements.service_id / subscriptions.service_id
-- are bare TEXT columns (consistent with how entity_id was added in 0010/0011).
--
-- This file is DDL ONLY. Backfill is split into 0069 (consulting) + 0070
-- (operator) so a backfill failure leaves the schema clean and each is applied
-- + row-count-checked independently against prod (D1 migrations are not
-- transactional across statements).
-- ============================================================================

CREATE TABLE services (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  quote_id        TEXT,                         -- nullable: backfilled operator rows have none
  type            TEXT NOT NULL CHECK (type IN ('consulting', 'operator')),
  cadence         TEXT NOT NULL CHECK (cadence IN ('one_time', 'recurring')),
  status          TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (
                    'proposed', 'active', 'completed', 'churned'
                  )),
  recurring_price REAL,
  started_at      TEXT,
  ended_at        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_services_org_status ON services(org_id, status);
CREATE INDEX idx_services_entity ON services(entity_id);
CREATE INDEX idx_services_quote ON services(quote_id);

-- One operator service per entity — mirrors subscriptions' UNIQUE(entity_id,
-- product_slug) and pre-empts a Stage 3 webhook-retry double-create. Consulting
-- is intentionally UNconstrained: a client can hold multiple engagements.
CREATE UNIQUE INDEX idx_services_one_operator ON services(entity_id) WHERE type = 'operator';

ALTER TABLE engagements   ADD COLUMN service_id TEXT;
ALTER TABLE subscriptions ADD COLUMN service_id TEXT;
CREATE INDEX idx_engagements_service ON engagements(service_id);
CREATE INDEX idx_subscriptions_service ON subscriptions(service_id);
