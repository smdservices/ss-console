-- Rollback for migration 0081 (purge junk + drop inert machine columns).
--
-- MANUAL-ONLY. Lives in /rollbacks/ so wrangler does NOT auto-apply it.
-- Apply with:
--   npx wrangler d1 execute ss-console-db --remote \
--     --file migrations/rollbacks/0081_purge_lead_gen_junk_and_drop_columns_down.sql
--
-- SCHEMA-ONLY. This re-adds the dropped columns (all nullable, all previously
-- machine-fed) and re-creates the two indexes. It CANNOT restore the purged
-- entity/context/contact/outreach rows — recover those from the pre-rip D1
-- export (backup-pre-rip.sql) taken in the teardown runbook. Column values are
-- not restored either; the columns come back empty.

ALTER TABLE entities ADD COLUMN pain_score INTEGER CHECK (pain_score BETWEEN 1 AND 10);
ALTER TABLE entities ADD COLUMN tier TEXT CHECK (tier IN ('hot', 'warm', 'cool', 'cold'));
ALTER TABLE entities ADD COLUMN employee_count INTEGER;
ALTER TABLE entities ADD COLUMN revenue_range TEXT DEFAULT 'unknown';
ALTER TABLE entities ADD COLUMN offer_track TEXT;
ALTER TABLE entities ADD COLUMN pack TEXT;
ALTER TABLE contacts ADD COLUMN email_source TEXT;
ALTER TABLE contacts ADD COLUMN email_confidence TEXT;

CREATE INDEX IF NOT EXISTS idx_entities_org_pain ON entities(org_id, pain_score DESC);
CREATE INDEX IF NOT EXISTS idx_entities_org_tier ON entities(org_id, tier);
