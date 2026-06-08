-- Console-side runtime-read audit — ADR 0043 §Invariants (reads are audited)
-- ============================================================================
--
-- Records every console→Machine live runtime read (path A): who looked at what
-- customer's runtime detail, which kind, and the outcome (including failures).
-- This is the CONSOLE's audit of cross-boundary reads — distinct from the
-- operator's own runtime audit log on the Machine (ADR 0009). It answers "which
-- SMD/staff user drilled into which operator's runtime state, and when".
--
-- Every row names exactly one customer (single-customer-per-read invariant).
-- Append-only by convention. Forward-only, additive. No drops.
-- ============================================================================

CREATE TABLE IF NOT EXISTS operator_runtime_read_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_slug   TEXT NOT NULL,
  actor_user_id   TEXT NOT NULL,
  actor_email     TEXT NOT NULL,
  actor_role      TEXT NOT NULL,
  -- The runtime detail class read (audit_log | draft | matter | activity).
  kind            TEXT NOT NULL,
  -- Outcome, including failures (ok | unreachable | unauthorized | not_configured).
  outcome         TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_runtime_read_audit_slug_created
  ON operator_runtime_read_audit (customer_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runtime_read_audit_actor_created
  ON operator_runtime_read_audit (actor_user_id, created_at DESC);
