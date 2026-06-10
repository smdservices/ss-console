-- The `service` spine — consulting backfill (ADR 0046, Stage 1)
-- ============================================================================
--
-- One `services` row per existing engagement. Deterministic id 'svc_' || e.id
-- (SQLite can't generate a UUID in SQL, and we need a stable id to write into
-- both the parent and the child). The live SOW hook uses 'svc_' ||
-- crypto.randomUUID() too, so the 'svc_' prefix is a TRUE INVARIANT of every
-- service id — nothing may rely on it to mean "backfilled."
--
-- Both statements are guarded by `service_id IS NULL` so a re-run (after a
-- partial apply) is safe and produces identical rows. NOTE: a child with
-- service_id IS NULL but an existing 'svc_'||id services row is a CORRUPTION
-- state requiring manual reconciliation — not auto-re-runnable.
--
-- Status projection (must match src/lib/db/services.ts projectServiceStatus):
--   completed → completed ; cancelled → churned ;
--   scheduled/active/handoff/safety_net → active (committed/live revenue line).
-- ============================================================================

INSERT INTO services (
  id, org_id, entity_id, quote_id, type, cadence, status,
  recurring_price, started_at, ended_at, created_at, updated_at
)
SELECT
  'svc_' || e.id,
  e.org_id,
  e.entity_id,
  e.quote_id,
  'consulting',
  'one_time',
  CASE e.status
    WHEN 'completed' THEN 'completed'
    WHEN 'cancelled' THEN 'churned'
    ELSE 'active'
  END,
  NULL,
  e.start_date,
  e.actual_end,
  e.created_at,
  e.updated_at
FROM engagements e
WHERE e.service_id IS NULL;

UPDATE engagements
SET service_id = 'svc_' || id, updated_at = datetime('now')
WHERE service_id IS NULL;
