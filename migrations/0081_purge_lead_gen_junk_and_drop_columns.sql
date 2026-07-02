-- Migration 0081: purge machine-junk entities + drop inert machine columns.
--
-- Second and final destructive step of the lead-gen machine teardown (ADR 0060).
-- PR1 / migration 0080 dropped the standalone machine tables and removed all
-- code that read these columns. This migration:
--   (a) drops the two indexes that would otherwise block DROP COLUMN,
--   (b) purges machine-generated junk entities that carry no commercial value,
--   (c) drops the now-inert machine columns from the shared entities/contacts
--       tables.
--
-- SHARED-TABLE SAFETY. entities/contacts hold the A&P pilot record and all
-- commercial data (ADR 0046). This migration touches them, so:
--   - the purge is scoped to signal/lost rows from a machine source_pipeline
--     with NO quote/engagement/invoice/meeting/assessment (keeps the pilot and
--     anything with real activity, regardless of source);
--   - it never deletes a context row referenced as an originating signal by a
--     surviving quote/engagement/meeting;
--   - source_pipeline, vertical, area are KEPT (read by the surviving Client
--     Hub / commercial roll-ups).
-- Rehearse on a fresh restore of the pre-rip backup before applying to prod.
-- Rollback (schema-only): migrations/rollbacks/0081_*_down.sql — purged rows are
-- recoverable only from the pre-rip export.

-- (a) Indexes that reference the columns we are about to drop.
DROP INDEX IF EXISTS idx_entities_org_pain;
DROP INDEX IF EXISTS idx_entities_org_tier;

-- (b) Purge. Stage the doomed entity ids, then delete children before parents
-- (no ON DELETE CASCADE exists on entity_id foreign keys).
DROP TABLE IF EXISTS _lg_purge_doomed;
CREATE TABLE _lg_purge_doomed AS
  SELECT e.id AS id
  FROM entities e
  WHERE e.stage IN ('signal', 'lost')
    AND COALESCE(e.source_pipeline, '') IN (
      'job_monitor', 'review_mining', 'new_business',
      'social_listening', 'website_scorecard', 'inbound_scan', 'system'
    )
    AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.entity_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM engagements g WHERE g.entity_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.entity_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM meetings m WHERE m.entity_id = e.id)
    AND NOT EXISTS (SELECT 1 FROM assessments a WHERE a.entity_id = e.id);

-- Guard: never orphan an originating-signal reference held by a surviving
-- quote/engagement/meeting (originating_signal_id -> context(id)). Drop any
-- such entity from the doomed set. (Doomed rows have no deals, so this is a
-- belt-and-suspenders check.)
DELETE FROM _lg_purge_doomed
WHERE id IN (
  SELECT c.entity_id FROM context c
  WHERE c.id IN (SELECT originating_signal_id FROM quotes WHERE originating_signal_id IS NOT NULL)
     OR c.id IN (SELECT originating_signal_id FROM engagements WHERE originating_signal_id IS NOT NULL)
     OR c.id IN (SELECT originating_signal_id FROM meetings WHERE originating_signal_id IS NOT NULL)
);

DELETE FROM context WHERE entity_id IN (SELECT id FROM _lg_purge_doomed);
DELETE FROM contacts WHERE entity_id IN (SELECT id FROM _lg_purge_doomed);
DELETE FROM outreach_events WHERE entity_id IN (SELECT id FROM _lg_purge_doomed);
DELETE FROM meetings WHERE entity_id IN (SELECT id FROM _lg_purge_doomed);
DELETE FROM entities WHERE id IN (SELECT id FROM _lg_purge_doomed);

DROP TABLE _lg_purge_doomed;

-- (c) Drop the inert machine columns. source_pipeline / vertical / area are
-- deliberately retained. contacts email_source/email_confidence are unindexed.
ALTER TABLE entities DROP COLUMN pain_score;
ALTER TABLE entities DROP COLUMN tier;
ALTER TABLE entities DROP COLUMN employee_count;
ALTER TABLE entities DROP COLUMN revenue_range;
ALTER TABLE entities DROP COLUMN offer_track;
ALTER TABLE entities DROP COLUMN pack;
ALTER TABLE contacts DROP COLUMN email_source;
ALTER TABLE contacts DROP COLUMN email_confidence;
