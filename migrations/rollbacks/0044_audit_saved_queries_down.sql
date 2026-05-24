-- Manual rollback for migration 0044. NOT auto-applied.
-- See migrations/rollbacks/README.md.
--
-- DESTRUCTIVE: dropping `audit_saved_queries` loses every saved query
-- across every user. Reviewers can re-create them, but the saved-query
-- inventory is gone.
--
-- Drop indexes before the table for re-apply safety.

DROP INDEX IF EXISTS idx_audit_saved_queries_user_entity;
DROP TABLE IF EXISTS audit_saved_queries;
