-- Drop the multi-user matter substrate (per ADR 0050)
-- ============================================================================
--
-- ADR 0050 makes the Operator portal a management console, not a data surface.
-- The three tables added by 0043 backed law-vertical-shaped portal features that
-- are removed: matter assignment, per-user PTO/coverage routing, and matter-keyed
-- notification preferences. All three are dropped here.
--
-- Safe to drop: nothing references these tables (they only reference
-- organizations/entities/users, never the reverse), and the routing consumer
-- (#821) that 0043 anticipated was never wired — verified before authoring this
-- migration. No production rows exist (no operator has done real work).
--
-- Forward-only, additive to the migration chain (never edits 0043). The matching
-- reversal lives at migrations/rollbacks/0074_drop_matter_substrate_down.sql and
-- is NOT applied automatically (see migrations/rollbacks/README.md).
-- ============================================================================

DROP INDEX IF EXISTS idx_user_notification_prefs_user_entity;
DROP TABLE IF EXISTS user_notification_prefs;

DROP INDEX IF EXISTS idx_user_pto_unique_active;
DROP INDEX IF EXISTS idx_user_pto_active;
DROP TABLE IF EXISTS user_pto;

DROP INDEX IF EXISTS idx_matter_assignments_unique_active;
DROP INDEX IF EXISTS idx_matter_assignments_assignee;
DROP INDEX IF EXISTS idx_matter_assignments_entity_matter;
DROP TABLE IF EXISTS matter_assignments;
