-- 0097: operator_entitlement_changes — the entitlement control's governance
-- ledger (#2003, A&P diligence reply Q7).
--
-- Every routine-tier change a client admin (or SMD on their behalf) submits,
-- with who/when/why, the compiled delta, and the pull request that carries it
-- to the source of truth. Companion to operator_pause_events (0096): same
-- control plane, same "every change, yours or ours, lands in the same audit
-- record" commitment.
--
-- STATUS SEMANTICS, deliberately honest: a submitted change is NOT applied.
-- The PR must merge (re-projecting config) and the Machine must reprovision
-- before the runtime changes. `submitted` is the only status this console
-- writes; `applied` exists for a future merge-webhook to set, and nothing
-- fabricates it in the meantime.

CREATE TABLE IF NOT EXISTS operator_entitlement_changes (
  id             TEXT PRIMARY KEY,
  entity_id      TEXT NOT NULL,
  customer_slug  TEXT NOT NULL,
  routine        TEXT NOT NULL,
  from_tier      TEXT NOT NULL,
  to_tier        TEXT NOT NULL,
  -- Compiled delta as JSON (exposure action class, from, to, direction).
  delta_json     TEXT NOT NULL,
  actor_user_id  TEXT NOT NULL,
  actor_email    TEXT NOT NULL,
  actor_role     TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('portal', 'admin')),
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('submitted', 'applied', 'abandoned')),
  pr_url         TEXT,
  pr_number      INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entitlement_changes_customer
  ON operator_entitlement_changes (customer_slug, created_at DESC);
