-- Migration 0021: Authored client-facing content for quotes
--
-- Tracks #377 Pattern B remediation. The proposal page and SOW PDF previously
-- synthesized client-facing content (a 3-week schedule, deliverables parsed
-- from line items, a hardcoded "Operations cleanup engagement" overview,
-- a generic "mid-engagement milestone" label) when no authored data existed.
--
-- Per #377 and the audit at docs/audits/client-facing-content-2026-04-15.md,
-- client-facing content must come from human-authored fields, never from
-- agent-invented defaults. These columns let the admin author per-engagement
-- content; render code falls back to rendering nothing when they are null.
--
-- D1 / SQLite stores JSON as TEXT.
--
-- - schedule:           JSON array of { label, body } rows for the
--                       "How we'll work" section on the proposal page.
-- - deliverables:       JSON array of { title, body } rows that replace the
--                       line-items-derived deliverables list on the proposal
--                       page and items list on the SOW PDF.
-- - engagement_overview: Free-text overview rendered on the SOW PDF
--                       "ENGAGEMENT OVERVIEW" page (was hardcoded).
-- - milestone_label:    Per-engagement label for the mid-engagement milestone
--                       on three-milestone SOWs (was hardcoded "mid-engagement
--                       milestone").
--
-- All four columns are NULL by default. Existing rows remain null until the
-- admin authors them. The send-gating in the admin UI requires schedule and
-- deliverables (the two explicitly called out in #377) to be populated before
-- a draft quote can be sent.

ALTER TABLE quotes ADD COLUMN schedule TEXT;
ALTER TABLE quotes ADD COLUMN deliverables TEXT;
ALTER TABLE quotes ADD COLUMN engagement_overview TEXT;
ALTER TABLE quotes ADD COLUMN milestone_label TEXT;
