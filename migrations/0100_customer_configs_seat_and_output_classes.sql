-- 0100 — project the ADR 0083 seam blocks into customer_configs.
--
-- `customer_configs` is the console's read replica of customer.yaml (ADR 0012
-- §4: git is authoritative, this table is a merge-time projection). Two blocks
-- land in the seam PR and both must appear here, for a reason that is easy to
-- miss:
--
-- The portal's settings editor does NOT read customer.yaml. It calls
-- `reconstructFromProjection`, which rebuilds a synthetic customer.yaml root out
-- of THESE columns and hands it to the shared validator. A block that exists in
-- git and not here is invisible to the editor — and worse, a future required
-- field absent from the projection makes the reconstructed root fail validation
-- for every customer, which is exactly the #1965 defect that took the Advanced
-- editor offline. Both new blocks validate as optional precisely so that cannot
-- recur, but they still need columns or the editor would silently drop them on
-- save.
--
-- Nullable, opaque JSON, matching the established shape of voice_library_json /
-- escalation_json / scope_json. NULL means the block is unauthored, which for
-- `output_classes` is a MEANINGFUL state and not merely an absent one: it says
-- the customer declared nothing, never that no spec is expected.

ALTER TABLE customer_configs ADD COLUMN seat_json TEXT;
ALTER TABLE customer_configs ADD COLUMN output_classes_json TEXT;
