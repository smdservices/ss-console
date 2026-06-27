-- Rollback for 0077_operator_screening_attestation.sql — MANUAL, Captain-coordinated.
-- See migrations/rollbacks/README.md. D1 (modern SQLite) supports DROP COLUMN.
--
-- Safe to run: with the column gone, parseScreeningAttestation reads undefined
-- and fail-closes to { attested: false }, taking enabled connectors dark rather
-- than breaking — consistent with the fail-closed posture.

ALTER TABLE customer_configs DROP COLUMN screening_attestation_json;
