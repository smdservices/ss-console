-- Projection columns for compliance view (issue #895)
-- ============================================================================
--
-- Threads two new fields through the portal's read replica of customer.yaml:
--
-- 1. `compliance_enabled` (boolean, default 0). When 0, the dedicated
--    Compliance dashboard view does NOT render even for users with the
--    `compliance` product_role — the firm has not opted in to the
--    separation-of-duties posture the view represents. RBAC on the
--    existing audit surface is unchanged.
--
-- 2. `vertical` (text, nullable). The customer.yaml `vertical` field
--    (`law-firm`, `marketing-agency`, etc.) drives the per-vertical audit
--    retention default surfaced on the Compliance dashboard. This is
--    distinct from the prospect-side `entities.vertical` field (which uses
--    a different lead-gen taxonomy: `home_services`, etc.); the
--    customer.yaml vertical is the contracted-engagement taxonomy.
--
-- Both columns are added with defaults safe for backfill; once CI sync
-- starts writing them every projected row reflects the source-of-truth
-- value.
--
-- Forward-only, additive. No drops.
-- ============================================================================

ALTER TABLE customer_configs
  ADD COLUMN compliance_enabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE customer_configs
  ADD COLUMN vertical TEXT;
