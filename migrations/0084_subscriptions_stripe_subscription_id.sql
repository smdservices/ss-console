-- 0084: subscriptions gains the Stripe billing linkage (#1679).
--
-- The Operator retainer is sold as a flat monthly subscription (ADR 0004
-- shape, ADR 0063 price) but until now the codebase could only issue
-- one-time Stripe invoices; every retainer month was a manual invoice and
-- MRR was a display number. The billing engine (src/lib/stripe/
-- subscriptions.ts) creates a Stripe subscription with
-- collection_method=send_invoice; this column links the local product-access
-- row to it so:
--
--   * the webhook mirror (invoice.finalized / invoice.paid /
--     customer.subscription.*) can resolve WHICH customer a Stripe
--     subscription event belongs to, and
--   * pause / resume / cancel drive Stripe from the same row that gates
--     portal access.
--
-- NULL = no billing attached (pilot/dogfood seats invoice $0 during pilot
-- per ADR 0063 while carrying list price on services.recurring_price for
-- the COGS/MRR gate). The partial unique index enforces one local row per
-- Stripe subscription without constraining the NULL majority.

ALTER TABLE subscriptions ADD COLUMN stripe_subscription_id TEXT;

CREATE UNIQUE INDEX idx_subscriptions_stripe_subscription_id
  ON subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
