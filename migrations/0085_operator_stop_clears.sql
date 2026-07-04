-- 0085: governance audit of Captain cost-breaker clears (ADR 0062 §6, #1701).
--
-- The breaker's HARD_STOP (AGENT_STOPPED) is a runtime self-protection event
-- on the Machine's own audit ledger. The RESUME (a Captain clearing the stop)
-- is a control-plane governance action: the audit-ledger broker PID-gates
-- appends to the gateway process (OP-P1-4), so the clear — driven from the
-- webhook-gate / console — cannot and should not write the Machine ledger.
-- It is audited HERE, where the Captain is authenticated (admin session).

CREATE TABLE operator_stop_clears (
  id             TEXT PRIMARY KEY,
  entity_id      TEXT NOT NULL,
  customer_slug  TEXT NOT NULL,
  actor_user_id  TEXT NOT NULL,
  actor_email    TEXT NOT NULL,
  actor_role     TEXT NOT NULL,
  reason         TEXT NOT NULL,
  -- JSON array of {customer, persona, prior_level} the gate reported cleared.
  cleared_json   TEXT NOT NULL DEFAULT '[]',
  gate_level     TEXT,               -- resulting level the gate returned (expect OK)
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_operator_stop_clears_slug ON operator_stop_clears(customer_slug, created_at);
