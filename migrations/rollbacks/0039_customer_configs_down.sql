-- Manual rollback for migration 0039. NOT auto-applied.
-- See migrations/rollbacks/README.md.
--
-- DESTRUCTIVE: dropping `customer_configs` removes the portal's projection
-- of every customer's canonical customer.yaml. The source of truth (git)
-- is unaffected — re-running the CI sync repopulates the table.
--
-- Drop indexes before the table for re-apply safety.

DROP INDEX IF EXISTS idx_customer_configs_slug;
DROP INDEX IF EXISTS idx_customer_configs_org;
DROP TABLE IF EXISTS customer_configs;
