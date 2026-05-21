-- Manual rollback for migration 0038. NOT auto-applied.
-- See migrations/rollbacks/README.md.
--
-- DESTRUCTIVE: dropping `subscriptions` and `product_roles` removes all
-- subscription state and product-role assignments. Only invoke after
-- confirming no production data depends on these tables.
--
-- SQLite/D1 does not support DROP COLUMN directly on indexed columns; the
-- `clerk_user_id` / `clerk_org_id` columns are left in place (they are
-- nullable and harmless). The unique indexes are dropped explicitly so a
-- re-apply of 0038 succeeds.

DROP INDEX IF EXISTS idx_product_roles_org_product;
DROP INDEX IF EXISTS idx_product_roles_entity_product;
DROP INDEX IF EXISTS idx_product_roles_user_entity;
DROP TABLE IF EXISTS product_roles;

DROP INDEX IF EXISTS idx_subscriptions_org_product;
DROP INDEX IF EXISTS idx_subscriptions_product_status;
DROP INDEX IF EXISTS idx_subscriptions_entity;
DROP TABLE IF EXISTS subscriptions;

DROP INDEX IF EXISTS idx_entities_clerk_org;
DROP INDEX IF EXISTS idx_users_clerk_user;
-- Note: ALTER TABLE DROP COLUMN is not supported in legacy SQLite; the
-- clerk_user_id and clerk_org_id columns remain. They are nullable with no
-- writers after rollback, so they impose no runtime cost.
