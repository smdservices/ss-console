-- Post-verification cleanup of backup tables from migration 0011.
--
-- Apply ONLY after running 0011_verify.sql and confirming all checks pass.
-- If 0011 partially applied and needs recovery, the _bak tables are still
-- intact — do NOT apply this migration until recovery is complete.

DROP TABLE IF EXISTS assessments_bak;
DROP TABLE IF EXISTS quotes_bak;
DROP TABLE IF EXISTS engagements_bak;
DROP TABLE IF EXISTS milestones_bak;
DROP TABLE IF EXISTS invoices_bak;
DROP TABLE IF EXISTS follow_ups_bak;
DROP TABLE IF EXISTS time_entries_bak;
