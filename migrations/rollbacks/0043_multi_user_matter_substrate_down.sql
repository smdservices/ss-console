-- Manual rollback for migration 0043. NOT auto-applied.
-- See migrations/rollbacks/README.md.
--
-- DESTRUCTIVE: dropping these tables removes every matter assignment,
-- PTO record, and per-user notification preference. Only invoke after
-- confirming no production routing depends on them.

DROP INDEX IF EXISTS idx_user_notification_prefs_user_entity;
DROP TABLE IF EXISTS user_notification_prefs;

DROP INDEX IF EXISTS idx_user_pto_unique_active;
DROP INDEX IF EXISTS idx_user_pto_active;
DROP TABLE IF EXISTS user_pto;

DROP INDEX IF EXISTS idx_matter_assignments_unique_active;
DROP INDEX IF EXISTS idx_matter_assignments_assignee;
DROP INDEX IF EXISTS idx_matter_assignments_entity_matter;
DROP TABLE IF EXISTS matter_assignments;
