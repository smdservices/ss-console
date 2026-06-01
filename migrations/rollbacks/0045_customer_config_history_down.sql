-- Manual rollback for migration 0045. NOT auto-applied.
-- See migrations/rollbacks/README.md.
--
-- DESTRUCTIVE: dropping this table removes the customer.yaml git-sync history
-- (the SHA/synced-at audit trail). The source of truth (git) is unaffected, so
-- re-running the CI sync after re-applying 0045 repopulates it. Safe to invoke;
-- no runtime enforcement depends on this table.

DROP INDEX IF EXISTS idx_cch_slug_sha;
DROP INDEX IF EXISTS idx_cch_slug_synced;
DROP TABLE IF EXISTS customer_config_history;
