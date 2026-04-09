-- Verification queries for migration 0011 (booking tables).
-- Run these after applying 0011 and BEFORE applying 0012.
-- Every query should return at least one row; an empty result indicates a problem.

-- ============================================================================
-- 1. Confirm entity_id column exists on all 5 tables
-- ============================================================================

SELECT 'assessments.entity_id' AS check_name, name
  FROM pragma_table_info('assessments') WHERE name = 'entity_id';

SELECT 'quotes.entity_id' AS check_name, name
  FROM pragma_table_info('quotes') WHERE name = 'entity_id';

SELECT 'engagements.entity_id' AS check_name, name
  FROM pragma_table_info('engagements') WHERE name = 'entity_id';

SELECT 'invoices.entity_id' AS check_name, name
  FROM pragma_table_info('invoices') WHERE name = 'entity_id';

SELECT 'follow_ups.entity_id' AS check_name, name
  FROM pragma_table_info('follow_ups') WHERE name = 'entity_id';

-- ============================================================================
-- 2. Row counts — should match pre-migration counts (compare manually)
-- ============================================================================

SELECT 'assessments' AS table_name, COUNT(*) AS row_count FROM assessments;
SELECT 'quotes' AS table_name, COUNT(*) AS row_count FROM quotes;
SELECT 'engagements' AS table_name, COUNT(*) AS row_count FROM engagements;
SELECT 'invoices' AS table_name, COUNT(*) AS row_count FROM invoices;
SELECT 'follow_ups' AS table_name, COUNT(*) AS row_count FROM follow_ups;
SELECT 'milestones' AS table_name, COUNT(*) AS row_count FROM milestones;
SELECT 'time_entries' AS table_name, COUNT(*) AS row_count FROM time_entries;

-- ============================================================================
-- 3. Spot-check entity_id is not universally NULL (if data existed pre-migration)
-- ============================================================================

SELECT 'assessments entity_id populated' AS check_name,
  COUNT(*) AS total, COUNT(entity_id) AS with_entity_id
  FROM assessments;

SELECT 'quotes entity_id populated' AS check_name,
  COUNT(*) AS total, COUNT(entity_id) AS with_entity_id
  FROM quotes;

SELECT 'engagements entity_id populated' AS check_name,
  COUNT(*) AS total, COUNT(entity_id) AS with_entity_id
  FROM engagements;

SELECT 'invoices entity_id populated' AS check_name,
  COUNT(*) AS total, COUNT(entity_id) AS with_entity_id
  FROM invoices;

SELECT 'follow_ups entity_id populated' AS check_name,
  COUNT(*) AS total, COUNT(entity_id) AS with_entity_id
  FROM follow_ups;

-- ============================================================================
-- 4. Confirm new booking tables exist
-- ============================================================================

SELECT 'integrations' AS check_name, COUNT(*) AS col_count
  FROM pragma_table_info('integrations');

SELECT 'oauth_states' AS check_name, COUNT(*) AS col_count
  FROM pragma_table_info('oauth_states');

SELECT 'assessment_schedule' AS check_name, COUNT(*) AS col_count
  FROM pragma_table_info('assessment_schedule');

SELECT 'booking_holds' AS check_name, COUNT(*) AS col_count
  FROM pragma_table_info('booking_holds');

SELECT 'availability_blocks' AS check_name, COUNT(*) AS col_count
  FROM pragma_table_info('availability_blocks');

-- ============================================================================
-- 5. Confirm assessments.status CHECK includes 'cancelled'
-- ============================================================================

SELECT 'assessments status CHECK' AS check_name, sql
  FROM sqlite_master
  WHERE type = 'table' AND name = 'assessments'
  AND sql LIKE '%cancelled%';

-- ============================================================================
-- 6. Confirm follow_ups.type CHECK includes all 13 types
-- ============================================================================

SELECT 'follow_ups type CHECK' AS check_name, sql
  FROM sqlite_master
  WHERE type = 'table' AND name = 'follow_ups'
  AND sql LIKE '%initial_outreach%'
  AND sql LIKE '%re_engage_90d%'
  AND sql LIKE '%custom%';

-- ============================================================================
-- 7. Confirm follow_ups.status CHECK includes 'sent' and 'surfaced'
-- ============================================================================

SELECT 'follow_ups status CHECK' AS check_name, sql
  FROM sqlite_master
  WHERE type = 'table' AND name = 'follow_ups'
  AND sql LIKE '%sent%'
  AND sql LIKE '%surfaced%';

-- ============================================================================
-- 8. Confirm unique partial index for double-booking prevention
-- ============================================================================

SELECT 'uniq_assessments_scheduled_at_active' AS check_name, name
  FROM sqlite_master
  WHERE type = 'index' AND name = 'uniq_assessments_scheduled_at_active';

-- ============================================================================
-- 9. Confirm backup tables still exist (safety net before 0012)
-- ============================================================================

SELECT 'assessments_bak exists' AS check_name, name
  FROM sqlite_master WHERE type = 'table' AND name = 'assessments_bak';

SELECT 'quotes_bak exists' AS check_name, name
  FROM sqlite_master WHERE type = 'table' AND name = 'quotes_bak';
