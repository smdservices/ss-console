-- Rollback for 0105: drop the cron_containment column.
ALTER TABLE fleet_status DROP COLUMN cron_containment;
