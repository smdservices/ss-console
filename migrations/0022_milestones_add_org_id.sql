-- Migration 0022: Add org_id to milestones for tenant scoping
--
-- Fixes the cross-tenant mutation exposure reported in #399 and found
-- in the code review 2026-04-16. The milestones table previously had no
-- org_id column and relied on the parent engagement for tenant identity.
-- That indirection is insufficient: getMilestone(), updateMilestone(), and
-- deleteMilestone() all fetched by primary key alone, with no org predicate.
-- A cross-org milestone access was only blocked by a post-fetch
-- engagement_id comparison — defense-in-depth that failed once already (#172).
--
-- Fix: add org_id directly to milestones, backfill from the parent
-- engagement, and scope every query and mutation on org_id.
--
-- The column is NOT NULL. Backfill runs before the constraint is enforced
-- by application-layer checks (SQLite does not enforce NOT NULL on ALTER
-- TABLE ADD COLUMN when a DEFAULT is provided; we supply '' as a sentinel
-- that the backfill immediately overwrites for all rows with a valid
-- engagement parent).

ALTER TABLE milestones ADD COLUMN org_id TEXT NOT NULL DEFAULT '';

-- Backfill: set org_id from the parent engagement for all existing rows.
UPDATE milestones
  SET org_id = (
    SELECT org_id
    FROM engagements
    WHERE engagements.id = milestones.engagement_id
  )
  WHERE org_id = '';
