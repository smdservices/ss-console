-- Rollback for 0101: narrow portal_action_events back to the 0099 vocabulary.
--
-- DESTRUCTIVE. Rows recorded under the new vocabulary cannot be carried back:
-- an 'output_class_spec_authored' row, or any row with status 'applied', has
-- no representation the 0099 CHECK constraints admit. This script DROPS those
-- rows rather than rewriting them into a neighbouring status, because a spec
-- write recorded as 'submitted' would claim the opposite of what happened.
--
-- Run it only alongside reverting the writer at
-- src/pages/api/portal/operator/settings/output-class-specs.ts. Leaving the
-- route live against the narrowed table makes every spec write throw at the
-- record step AFTER the vault object has already been written — an unaudited
-- change to a client's Operator, which is worse than either end state.

CREATE TABLE portal_action_events_old (
  id             TEXT PRIMARY KEY,
  entity_id      TEXT NOT NULL,
  customer_slug  TEXT,
  action_type    TEXT NOT NULL CHECK (action_type IN (
    'role_granted',
    'role_revoked',
    'invite_sent',
    'customer_yaml_update_submitted',
    'connector_reconsent_requested'
  )),
  actor_user_id  TEXT NOT NULL,
  actor_email    TEXT NOT NULL,
  actor_role     TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'portal' CHECK (source IN ('portal', 'admin')),
  target         TEXT,
  status         TEXT CHECK (status IS NULL OR status IN ('submitted', 'rejected')),
  metadata_json  TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL
);

INSERT INTO portal_action_events_old (
  id, entity_id, customer_slug, action_type, actor_user_id, actor_email,
  actor_role, source, target, status, metadata_json, created_at)
SELECT
  id, entity_id, customer_slug, action_type, actor_user_id, actor_email,
  actor_role, source, target, status, metadata_json, created_at
FROM portal_action_events
WHERE action_type <> 'output_class_spec_authored'
  AND (status IS NULL OR status IN ('submitted', 'rejected'));

DROP TABLE portal_action_events;

ALTER TABLE portal_action_events_old RENAME TO portal_action_events;

CREATE INDEX IF NOT EXISTS idx_action_events_entity
  ON portal_action_events (entity_id, created_at DESC);
