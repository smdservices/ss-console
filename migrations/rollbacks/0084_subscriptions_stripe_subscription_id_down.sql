-- Rollback for 0084: drop the Stripe billing linkage.
--
-- SQLite (D1) supports DROP COLUMN since 3.35; the index must go first.

DROP INDEX IF EXISTS idx_subscriptions_stripe_subscription_id;

ALTER TABLE subscriptions DROP COLUMN stripe_subscription_id;
