-- Strategic repositioning: add revenue_range to entities.
--
-- Earlier drafts of this migration attempted to rewrite the legacy `clients`
-- table. That is not safe for the real migration chain because production has
-- already moved to `entities` and no longer has a `clients` table. The live
-- schema only needs the new `revenue_range` column on `entities`.

ALTER TABLE entities ADD COLUMN revenue_range TEXT DEFAULT 'unknown';
