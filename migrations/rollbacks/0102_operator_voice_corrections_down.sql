-- Rollback for 0102_operator_voice_corrections.sql (#2091).
--
-- NOT auto-applied — see migrations/rollbacks/README.md.
--
-- DESTRUCTIVE. `operator_voice_corrections` is the console-side record of which
-- corrections a Named Administrator promoted, by whom and when, and the
-- supersession chain that makes a correction restorable. Dropping it destroys
-- that record. The promoted SPEC CONTENT survives — it lives in
-- `vaults/<slug>/output-classes.json` in R2 and on the seat — so the Operator's
-- behavior is unaffected by this rollback; what is lost is the account of how
-- that content came to be, which is the part a client was told is auditable.
--
-- The seat-side capture is likewise untouched: `CORRECTION_PROPOSED` rows live
-- in the per-customer append-only audit ledger, not here.
--
-- Preserve the record before invoking:
--
--   npx wrangler d1 execute ss-console-db --remote --json \
--     --command "SELECT * FROM operator_voice_corrections" \
--     > operator_voice_corrections-backup.json
--
-- The table is a pure leaf apart from its self-reference (`superseded_by`), so
-- the drop needs no ordering against other tables.

DROP INDEX IF EXISTS idx_voice_corrections_status;
DROP INDEX IF EXISTS idx_voice_corrections_scope;
DROP TABLE IF EXISTS operator_voice_corrections;
