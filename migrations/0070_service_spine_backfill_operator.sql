-- The `service` spine — operator backfill (ADR 0046, Stage 1)
-- ============================================================================
--
-- One `services` row per existing operator subscription. Same deterministic-id
-- + idempotency-guard discipline as 0069. quote_id is NULL (operator quotes
-- don't exist until Stage 2) and recurring_price is NULL (authored per-quote in
-- Stage 2 — never fabricated).
--
-- Status projection (must match src/lib/db/services.ts projectOperatorStatus):
--   cancelled → churned ; provisioning/active/paused → active.
-- A provisioning operator is a COMMITTED revenue line being stood up, so it
-- maps to `active` (not `proposed`). `proposed` means "quoted, not yet
-- accepted" — which has no representation among existing subscriptions.
-- ============================================================================

INSERT INTO services (
  id, org_id, entity_id, quote_id, type, cadence, status,
  recurring_price, started_at, ended_at, created_at, updated_at
)
SELECT
  'svc_' || s.id,
  s.org_id,
  s.entity_id,
  NULL,
  'operator',
  'recurring',
  CASE s.status
    WHEN 'cancelled' THEN 'churned'
    ELSE 'active'
  END,
  NULL,
  s.started_at,
  s.ended_at,
  s.created_at,
  s.updated_at
FROM subscriptions s
WHERE s.service_id IS NULL;

UPDATE subscriptions
SET service_id = 'svc_' || id, updated_at = datetime('now')
WHERE service_id IS NULL;
