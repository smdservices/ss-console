-- Rollback for 0079_lead_gen_capture_layer.sql — MANUAL, Captain-coordinated.
-- See migrations/rollbacks/README.md. D1 (modern SQLite) supports DROP COLUMN.
--
-- Safe to run: the promotion step and offer-track/pack readers treat a missing
-- value as unset (fail-closed — an untagged prospect is neither az_consulting
-- nor national_pack, and the send path simply finds no promoted contact),
-- rather than breaking.

DROP INDEX IF EXISTS idx_contacts_entity_email;

ALTER TABLE contacts DROP COLUMN email_confidence;
ALTER TABLE contacts DROP COLUMN email_source;

ALTER TABLE entities DROP COLUMN pack;
ALTER TABLE entities DROP COLUMN offer_track;
