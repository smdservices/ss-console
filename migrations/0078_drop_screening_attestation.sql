-- Drop the screening-attestation projection column (reverses 0077).
-- ============================================================================
-- The screening-attestation gate (ADR 0057 §4 enforcement) is removed: a
-- use-at-your-own-risk frontier product does not block a client's access on a
-- signed no-active-screens attestation. The connector still fails closed on
-- AUTHORIZATION (the grant table), which is the real gate. Documentation,
-- disclosure, and service-agreement work is deferred to when there is a product
-- to sell, and is a business decision — not a built enforcement gate.
--
-- No data is lost that matters: the column held only the projected attestation
-- blocks (smd / pilot-smokeball / _template), all removed alongside this.
-- ============================================================================

ALTER TABLE customer_configs DROP COLUMN screening_attestation_json;
