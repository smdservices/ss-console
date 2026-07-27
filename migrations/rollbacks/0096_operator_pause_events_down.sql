-- Rollback for 0096: drop the portal kill switch's governance ledger.
--
-- Dropping the table removes the client-readable pause/resume record. The
-- pause route (src/pages/api/portal/products/operator/[instance]/pause.ts)
-- and the audit-viewer union must be reverted in the same breath — without
-- the table every pause attempt throws at the record step AFTER the Machine
-- has already been paused, leaving an unaudited stop.

DROP INDEX IF EXISTS idx_pause_events_customer;
DROP TABLE IF EXISTS operator_pause_events;
