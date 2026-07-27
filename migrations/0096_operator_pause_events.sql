-- 0096: operator_pause_events — the portal kill switch's governance ledger
-- (#2003, A&P diligence reply Q6/Q7).
--
-- Every pause AND resume of an Operator, whoever initiated it (client admin
-- via the portal, Captain via the admin console), lands here with who/when/
-- why. Control-plane-side by necessity: the Machine audit-ledger broker
-- PID-gates appends to the gateway process (OP-P1-4), so a gate-executed
-- stop cannot write the Machine ledger. The portal audit viewer unions this
-- table into the client-readable record.
--
-- Companion to operator_stop_clears (0085), which records Captain clears of
-- SYSTEM-initiated trips. This table records the OPERATOR-INITIATED pause
-- lifecycle; the two are separate events with separate shapes, deliberately
-- not merged.

CREATE TABLE IF NOT EXISTS operator_pause_events (
  id             TEXT PRIMARY KEY,
  entity_id      TEXT NOT NULL,
  customer_slug  TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('pause', 'resume')),
  actor_user_id  TEXT NOT NULL,
  actor_email    TEXT NOT NULL,
  actor_role     TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('portal', 'admin')),
  reason         TEXT NOT NULL,
  gate_level     TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pause_events_customer
  ON operator_pause_events (customer_slug, created_at DESC);
