-- Migration 0089: subscriptions become multi-instance per (entity, product).
--
-- The model correction (2026-07-08): one client = one login = one entity, but a
-- client can own MANY of a product (many operators, many hosted-agents). An
-- operator instance = one subscription row + one customer_configs row, linked by
-- customer_slug. The blocker is the table-level UNIQUE(entity_id, product_slug)
-- from migration 0038 — it physically rejects a second (entity, 'operator') row.
--
-- SQLite cannot drop a table-level UNIQUE without rebuilding the table. Because
-- hosted_agent_intake.subscription_id REFERENCES subscriptions(id) (0087),
-- rebuilding the PARENT requires the FK-chain dance from 0033/0035:
--   1. rebuild the child (hosted_agent_intake) WITHOUT the FK
--   2. rebuild subscriptions (drop the UNIQUE, add instance_slug, recreate indexes)
--   3. rebuild the child WITH the FK to subscriptions(id) restored
--
-- The table-level UNIQUE is replaced by TWO partial unique indexes so the
-- constraint still holds where it should:
--   * single-instance products (instance_slug IS NULL): at most one row per
--     (entity, product) — hosted-agent, engagement, etc. unchanged.
--   * multi-instance rows (instance_slug NOT NULL): unique per
--     (entity, product, instance).
-- SQLite treats NULLs as DISTINCT, so a single composite UNIQUE would NOT stop
-- duplicate single-instance rows — hence the split.
--
-- Instance identity = customer_slug (already the fleet identity + UNIQUE on
-- customer_configs). Operator subs are backfilled to their entity's config slug
-- by CORRELATED SUBQUERY (never a hardcoded value) — safe here because this
-- migration runs BEFORE 0090 while customer_configs is still 1:1 per entity.
-- Prod pre-flight confirmed exactly one operator subscription today.
--
-- Column lists reconciled against LIVE sqlite_master (not the 0038/0087 source):
--   subscriptions adds service_id (0068) + stripe_subscription_id (0084).
--   hosted_agent_intake adds channel_details (0088).
--
-- D1 wraps this file in a single atomic transaction (verified against 0033/0035),
-- so a partial-apply half-state is not a risk. PRAGMA notes: see 0035.
-- Manual-only rollback at migrations/rollbacks/0089_subscriptions_multi_instance_down.sql.

PRAGMA defer_foreign_keys = ON;

-- Step 1: Drop the child FK. Rebuild hosted_agent_intake with subscription_id as
-- a plain column (REFERENCES subscriptions(id) removed for the parent rebuild).
CREATE TABLE hosted_agent_intake_tmp (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL,
  entity_id             TEXT NOT NULL REFERENCES entities(id),
  subscription_id       TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'awaiting_intake'
                        CHECK (status IN ('awaiting_intake', 'intake_submitted', 'provisioning', 'live', 'cancelled')),
  agent_name            TEXT,
  use_cases             TEXT,
  telegram_handle       TEXT,
  timezone              TEXT,
  allowed_senders_json  TEXT,
  spend_limit_confirmed INTEGER NOT NULL DEFAULT 0,
  anthropic_key_status  TEXT NOT NULL DEFAULT 'pending'
                        CHECK (anthropic_key_status IN ('pending', 'received')),
  customer_slug         TEXT,
  submitted_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  channel_details       TEXT
);
INSERT INTO hosted_agent_intake_tmp SELECT * FROM hosted_agent_intake;
DROP TABLE hosted_agent_intake;
ALTER TABLE hosted_agent_intake_tmp RENAME TO hosted_agent_intake;

-- Step 2: Rebuild subscriptions without the table-level UNIQUE; add instance_slug.
CREATE TABLE subscriptions_new (
  id                     TEXT PRIMARY KEY,
  org_id                 TEXT NOT NULL REFERENCES organizations(id),
  entity_id              TEXT NOT NULL REFERENCES entities(id),
  product_slug           TEXT NOT NULL,
  instance_slug          TEXT,
  status                 TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN (
    'provisioning', 'active', 'paused', 'cancelled'
  )),
  started_at             TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at               TEXT,
  settings_json          TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  service_id             TEXT,
  stripe_subscription_id TEXT
);
INSERT INTO subscriptions_new (
  id, org_id, entity_id, product_slug, instance_slug, status, started_at, ended_at,
  settings_json, created_at, updated_at, service_id, stripe_subscription_id)
SELECT
  id, org_id, entity_id, product_slug, NULL, status, started_at, ended_at,
  settings_json, created_at, updated_at, service_id, stripe_subscription_id
FROM subscriptions;
DROP TABLE subscriptions;
ALTER TABLE subscriptions_new RENAME TO subscriptions;

-- Recreate the non-unique indexes from 0038/0068 and the stripe partial-unique (0084).
CREATE INDEX idx_subscriptions_entity         ON subscriptions(entity_id);
CREATE INDEX idx_subscriptions_product_status ON subscriptions(product_slug, status);
CREATE INDEX idx_subscriptions_org_product    ON subscriptions(org_id, product_slug);
CREATE INDEX idx_subscriptions_service        ON subscriptions(service_id);
CREATE UNIQUE INDEX idx_subscriptions_stripe_subscription_id
  ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Replacement uniqueness (two partial indexes; see header for the NULL-distinct rationale).
CREATE UNIQUE INDEX idx_subscriptions_one_per_product_single
  ON subscriptions(entity_id, product_slug) WHERE instance_slug IS NULL;
CREATE UNIQUE INDEX idx_subscriptions_one_per_instance
  ON subscriptions(entity_id, product_slug, instance_slug) WHERE instance_slug IS NOT NULL;

-- Backfill: existing operator subs get instance_slug = their entity's config slug.
-- Correlated subquery (NOT a hardcode) — safe because customer_configs is still
-- 1:1 per entity at this point (0090 has not run).
UPDATE subscriptions
   SET instance_slug = (SELECT cc.customer_slug FROM customer_configs cc
                         WHERE cc.entity_id = subscriptions.entity_id)
 WHERE product_slug = 'operator' AND instance_slug IS NULL;

-- Step 3: Restore the child FK. Rebuild hosted_agent_intake with
-- subscription_id REFERENCES subscriptions(id) again.
CREATE TABLE hosted_agent_intake_new (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL,
  entity_id             TEXT NOT NULL REFERENCES entities(id),
  subscription_id       TEXT NOT NULL REFERENCES subscriptions(id),
  status                TEXT NOT NULL DEFAULT 'awaiting_intake'
                        CHECK (status IN ('awaiting_intake', 'intake_submitted', 'provisioning', 'live', 'cancelled')),
  agent_name            TEXT,
  use_cases             TEXT,
  telegram_handle       TEXT,
  timezone              TEXT,
  allowed_senders_json  TEXT,
  spend_limit_confirmed INTEGER NOT NULL DEFAULT 0,
  anthropic_key_status  TEXT NOT NULL DEFAULT 'pending'
                        CHECK (anthropic_key_status IN ('pending', 'received')),
  customer_slug         TEXT,
  submitted_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  channel_details       TEXT
);
INSERT INTO hosted_agent_intake_new SELECT * FROM hosted_agent_intake;
DROP TABLE hosted_agent_intake;
ALTER TABLE hosted_agent_intake_new RENAME TO hosted_agent_intake;
CREATE INDEX idx_hosted_agent_intake_status ON hosted_agent_intake (status, created_at DESC);
CREATE UNIQUE INDEX idx_hosted_agent_intake_subscription ON hosted_agent_intake (subscription_id);
