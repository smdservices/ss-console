-- Manual rollback for migration 0042. NOT auto-applied.
-- See migrations/rollbacks/README.md.
--
-- DESTRUCTIVE on the projection only: dropping the column loses the
-- portal-side `compliance_enabled` projection value. The source of truth
-- (customer.yaml in git) is unaffected; re-running the CI sync after
-- restoring the column repopulates it.
--
-- SQLite < 3.35 does not support DROP COLUMN. Modern D1 (libSQL) does;
-- this rollback assumes that capability. If an older runtime rejects
-- the statement, fall back to the standard table-rebuild pattern
-- (CREATE TABLE_new ... INSERT SELECT ... DROP TABLE ... ALTER RENAME).

ALTER TABLE customer_configs DROP COLUMN compliance_enabled;
ALTER TABLE customer_configs DROP COLUMN vertical;
