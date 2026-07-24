-- Rollback for 0078_drop_screening_attestation.sql — re-adds the (now unused) column.
ALTER TABLE customer_configs ADD COLUMN screening_attestation_json TEXT;
