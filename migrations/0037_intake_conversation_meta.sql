-- Migration 0037: intake_conversation_meta
--
-- V3 /book chat redesign needs a tiny per-conversation state row to track:
--   - closed_at         : prospect clicked "Done" (idempotent close)
--   - in_flight_until   : an assistant turn is mid-generation; subsequent
--                         close attempts return 409 until this clears
--   - last_idempotency_*: last-turn snapshot. Populated on successful turn
--                         write so a client Retry POST with the same
--                         idempotency key replays the result rather than
--                         duplicating the user turn server-side. Sticky
--                         to the most recent turn only; that is all the
--                         UI needs.
--
-- Keyed by conversation_id (the same UUID stamped into context.metadata
-- for V2 turns). entity_id is denormalized for query convenience and
-- follows the conversation's cookie-bound entity. No FK on
-- conversation_id since conversations are not their own table — they are
-- a logical grouping of context rows.

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

CREATE INDEX IF NOT EXISTS idx_intake_conv_meta_entity
  ON intake_conversation_meta(entity_id);
