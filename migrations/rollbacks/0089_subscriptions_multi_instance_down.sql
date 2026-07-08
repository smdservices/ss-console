-- Rollback for 0089: restore the table-level UNIQUE(entity_id, product_slug) and
-- drop instance_slug.
--
-- SAFETY: restoring UNIQUE(entity_id, product_slug) will FAIL if any entity owns
-- more than one subscription for the same product (i.e. a second operator was
-- seeded). Intentional — remove the extra subscription rows first.
--
-- Same FK-chain dance as 0089 (hosted_agent_intake.subscription_id REFERENCES
-- subscriptions(id)). Run AFTER 0090's rollback. Manual-only; coordinate with
-- Captain. D1 wraps this file in one atomic transaction.

PRAGMA defer_foreign_keys = ON;

-- Step 1: Drop the child FK.
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

-- Step 2: Rebuild subscriptions WITH the table-level UNIQUE and WITHOUT instance_slug.
CREATE TABLE subscriptions_old (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  product_slug    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN (
    'provisioning', 'active', 'paused', 'cancelled'
  )),
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at        TEXT,
  settings_json   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  service_id      TEXT,
  stripe_subscription_id TEXT,
  UNIQUE(entity_id, product_slug)
);
INSERT INTO subscriptions_old (
  id, org_id, entity_id, product_slug, status, started_at, ended_at,
  settings_json, created_at, updated_at, service_id, stripe_subscription_id)
SELECT
  id, org_id, entity_id, product_slug, status, started_at, ended_at,
  settings_json, created_at, updated_at, service_id, stripe_subscription_id
FROM subscriptions;
DROP TABLE subscriptions;
ALTER TABLE subscriptions_old RENAME TO subscriptions;

CREATE INDEX idx_subscriptions_entity         ON subscriptions(entity_id);
CREATE INDEX idx_subscriptions_product_status ON subscriptions(product_slug, status);
CREATE INDEX idx_subscriptions_org_product    ON subscriptions(org_id, product_slug);
CREATE INDEX idx_subscriptions_service        ON subscriptions(service_id);
CREATE UNIQUE INDEX idx_subscriptions_stripe_subscription_id
  ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Step 3: Restore the child FK.
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
