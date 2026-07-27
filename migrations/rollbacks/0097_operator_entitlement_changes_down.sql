-- Rollback for 0097: drop the entitlement-control governance ledger.
--
-- Dropping the table removes the client-readable record of tier changes. The
-- tier-change route and the audit-viewer union must be reverted in the same
-- breath — without the table a submitted change throws at the record step
-- AFTER its pull request already exists, leaving an unaudited open PR against
-- a client's config.

DROP INDEX IF EXISTS idx_entitlement_changes_customer;
DROP TABLE IF EXISTS operator_entitlement_changes;
