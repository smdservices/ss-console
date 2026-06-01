-- Manual rollback for migration 0046. NOT auto-applied.
-- See migrations/rollbacks/README.md.
--
-- DESTRUCTIVE — COMPLIANCE LEDGER: config_change_audit is the append-only
-- governance action ledger (ADR 0026 / ADR 0030 §4) — who changed which trust
-- ceiling / skill toggle, accepted or floor-rejected. Dropping it ERASES that
-- audit trail. Only invoke to fully reset the governance model, and only after
-- confirming the rows are not required for a compliance/audit obligation
-- (archive them first if in any doubt — an auditor cannot reconstruct intent
-- from a dropped ledger).

DROP INDEX IF EXISTS idx_cca_entity_created;
DROP INDEX IF EXISTS idx_cca_slug_created;
DROP TABLE IF EXISTS config_change_audit;
