-- 0101: portal_action_events admits the output-class spec write (ADR 0083, #2089).
--
-- Two CHECK constraints have to move, and SQLite cannot ALTER a CHECK, so this
-- is the standard rebuild (same shape as 0090 / 0093 / 0094).
--
--   action_type gains 'output_class_spec_authored' — a Named Administrator
--   authoring a voice or format spec for one of their output classes. It is
--   the first client-initiated console action that actually WRITES to the
--   customer's Operator: the spec lands in vaults/<slug>/output-classes.json
--   and the seat's applier installs it.
--
--   status gains 'applied' — and 0099's status note is amended, not repealed.
--   That note said 'submitted' or 'rejected', never 'applied', because the
--   only writer-shaped endpoint at the time wrote nothing. That reasoning
--   still governs customer_yaml_update_submitted, which still writes nothing
--   and still records 'submitted'. It does not govern this new action, which
--   writes the object and reads it back byte-identical before claiming
--   anything. 'applied' is now available and is earned, per row, by a proven
--   write — never by a validator passing.
--
-- portal_action_events is a PURE leaf: nothing FK-references it, and it holds
-- no outgoing FKs. The rebuild is a straight copy.
--
-- Manual-only rollback at
-- migrations/rollbacks/0101_action_events_output_class_spec_down.sql.

CREATE TABLE portal_action_events_new (
  id             TEXT PRIMARY KEY,
  entity_id      TEXT NOT NULL,
  customer_slug  TEXT,
  action_type    TEXT NOT NULL CHECK (action_type IN (
    'role_granted',
    'role_revoked',
    'invite_sent',
    'customer_yaml_update_submitted',
    'connector_reconsent_requested',
    'output_class_spec_authored'
  )),
  actor_user_id  TEXT NOT NULL,
  actor_email    TEXT NOT NULL,
  actor_role     TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'portal' CHECK (source IN ('portal', 'admin')),
  target         TEXT,
  status         TEXT CHECK (status IS NULL OR status IN ('submitted', 'rejected', 'applied')),
  metadata_json  TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL
);

INSERT INTO portal_action_events_new (
  id, entity_id, customer_slug, action_type, actor_user_id, actor_email,
  actor_role, source, target, status, metadata_json, created_at)
SELECT
  id, entity_id, customer_slug, action_type, actor_user_id, actor_email,
  actor_role, source, target, status, metadata_json, created_at
FROM portal_action_events;

DROP TABLE portal_action_events;

ALTER TABLE portal_action_events_new RENAME TO portal_action_events;

CREATE INDEX IF NOT EXISTS idx_action_events_entity
  ON portal_action_events (entity_id, created_at DESC);
