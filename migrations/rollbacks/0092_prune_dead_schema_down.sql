-- Down migration for 0092. Recreates intake_conversation_meta EMPTY -- the
-- pruned data (dead by audit) is not recoverable. Schema-shape restoration
-- only. Manual-only, matching the rollbacks/ convention (not auto-applied).

CREATE TABLE IF NOT EXISTS intake_conversation_meta (
  conversation_id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  closed_at TEXT,
  in_flight_until TEXT,
  last_idempotency_key TEXT,
  last_turn INTEGER,
  last_ai_reply TEXT,
  last_slot_picker_next INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
