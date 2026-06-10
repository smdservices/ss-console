-- Manual rollback for migration 0068 (the `service` spine DDL). NOT auto-applied.
-- See migrations/rollbacks/README.md.
--
-- Reverses 0068 fully: drops the `services` table + its indexes, and removes
-- the bare `service_id` columns from the two child tables (after dropping their
-- indexes — SQLite refuses to drop an indexed column). This fully reverses so a
-- later re-apply of 0068's `ALTER TABLE ... ADD COLUMN service_id` does not
-- collide.
--
-- DESTRUCTIVE: drops the commercial `services` rows (and the child→service
-- links). The delivery records (engagements, subscriptions) are untouched, so
-- re-applying 0068 + 0069 + 0070 fully rebuilds the spine from them. Coordinate
-- with Captain. If a deployed D1 build rejects ALTER TABLE DROP COLUMN, drop the
-- two ALTER lines and leave the columns dormant (then 0068 must be edited to
-- not re-add them on re-apply).

DROP INDEX IF EXISTS idx_engagements_service;
DROP INDEX IF EXISTS idx_subscriptions_service;
ALTER TABLE engagements   DROP COLUMN service_id;
ALTER TABLE subscriptions DROP COLUMN service_id;

DROP INDEX IF EXISTS idx_services_one_operator;
DROP INDEX IF EXISTS idx_services_org_status;
DROP INDEX IF EXISTS idx_services_entity;
DROP INDEX IF EXISTS idx_services_quote;
DROP TABLE IF EXISTS services;
