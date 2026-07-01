-- Lead-gen capture layer: offer-track / pack tags + contact-promotion plumbing
-- ============================================================================
-- Phase 0 of the lead-gen realignment (ADR 0058). All additive.
--
-- 1. entities.offer_track (TEXT, nullable) — which offer a prospect was
--    captured for: 'az_consulting' or 'national_pack'. The enum is enforced in
--    the app layer rather than a column CHECK, matching the 0042 house style
--    (SQLite ALTER ADD COLUMN + CHECK is brittle across existing rows).
--    Legacy signal-stage rows are backfilled by classifying entities.area.
--
-- 2. entities.pack (TEXT, nullable) — pack slug for national_pack prospects
--    (e.g. 'law_firm', 'mortgage'); null for az_consulting.
--
-- 3. contacts.email_source / contacts.email_confidence (TEXT, nullable) —
--    provenance for a promoted contact email. email_source records which
--    enrichment module the address came from (deep_website / website_analysis
--    / outscraper); email_confidence records 'individual' vs 'generic' (role
--    address like info@ / contact@). The send path and the hand-test use these
--    to avoid mailing a generic inbox.
--
-- 4. UNIQUE INDEX on contacts(entity_id, email) — makes the DB the arbiter of
--    contact dedup so the enrichment promotion step can INSERT ... ON CONFLICT
--    DO NOTHING without a check-then-insert race. NULL emails stay distinct
--    (SQLite treats NULLs as unique), so contacts without an email are
--    unaffected. Verified zero existing duplicate (entity_id, email) pairs
--    before adding the constraint.
--
-- Forward-only, additive. No drops.
-- ============================================================================

ALTER TABLE entities ADD COLUMN offer_track TEXT;
ALTER TABLE entities ADD COLUMN pack TEXT;

ALTER TABLE contacts ADD COLUMN email_source TEXT;
ALTER TABLE contacts ADD COLUMN email_confidence TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_entity_email
  ON contacts (entity_id, email);
