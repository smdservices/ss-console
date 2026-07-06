-- 0087: Hosted Agent self-serve SKU substrate (ADR 0067).
--
-- Two tables:
--
-- hosted_agent_intake — one row per Hosted Agent purchase. Doubles as the
-- customer's onboarding questionnaire store AND the Captain's concierge work
-- item (the admin queue reads it). Status lifecycle mirrors the concierge
-- runbook: awaiting_intake → intake_submitted → provisioning → live, with
-- cancelled as the terminal branch. NO secret-bearing column exists — the
-- Anthropic key is write-only relayed (ADR 0042 core) and this table records
-- only its status flag.
--
-- stripe_checkout_orders — idempotency ledger for checkout.session.completed
-- webhook processing. Keyed by the Checkout Session id; a replayed event that
-- finds a 'processed' row is acknowledged without re-running the pipeline.

CREATE TABLE hosted_agent_intake (
  id                   TEXT PRIMARY KEY,
  org_id               TEXT NOT NULL,
  entity_id            TEXT NOT NULL REFERENCES entities(id),
  subscription_id      TEXT NOT NULL REFERENCES subscriptions(id),
  status               TEXT NOT NULL DEFAULT 'awaiting_intake'
                       CHECK (status IN ('awaiting_intake', 'intake_submitted', 'provisioning', 'live', 'cancelled')),
  agent_name           TEXT,
  use_cases            TEXT,
  telegram_handle      TEXT,
  timezone             TEXT,
  allowed_senders_json TEXT,
  spend_limit_confirmed INTEGER NOT NULL DEFAULT 0,
  anthropic_key_status TEXT NOT NULL DEFAULT 'pending'
                       CHECK (anthropic_key_status IN ('pending', 'received')),
  customer_slug        TEXT,
  submitted_at         TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_hosted_agent_intake_status
  ON hosted_agent_intake (status, created_at DESC);

CREATE UNIQUE INDEX idx_hosted_agent_intake_subscription
  ON hosted_agent_intake (subscription_id);

CREATE TABLE stripe_checkout_orders (
  session_id             TEXT PRIMARY KEY,
  clerk_user_id          TEXT,
  email                  TEXT,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  product_slug           TEXT NOT NULL,
  plan                   TEXT NOT NULL CHECK (plan IN ('founding', 'standard')),
  amount_total           INTEGER,
  status                 TEXT NOT NULL DEFAULT 'received'
                         CHECK (status IN ('received', 'processed', 'failed')),
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_stripe_checkout_orders_subscription
  ON stripe_checkout_orders (stripe_subscription_id);
