-- 0099: portal_action_events — durable ledger for client-initiated console
-- actions whose attribution previously lived only in console.info tail logs
-- (role grants/revokes, invitations, advanced customer.yaml submissions) or
-- nowhere (connector re-consent).
--
-- Companion to operator_pause_events (0096) and operator_entitlement_changes
-- (0097): same actor columns, same append-only posture. One generic table
-- rather than four per-domain ones because these actions share a single
-- shape (principal console action + actor + small metadata); the per-domain
-- tables earned their bespoke columns (gate_level, pr_url) — these don't
-- have any. metadata_json follows the delta_json precedent in 0097.
--
-- STATUS SEMANTICS, deliberately honest (matches 0097): the customer.yaml
-- endpoint validates and acknowledges but applies nothing at v1, so its
-- events are 'submitted' or 'rejected' — never 'applied'. Nothing fabricates
-- an applied state.
--
-- The existing console.info emitters (rbac-audit.ts, customer-yaml-audit.ts)
-- remain as secondary sinks; this table is the primary, queryable record and
-- is unioned into the client-readable Activity feed.
--
-- created_at is written by JS as ISO-8601 (no SQL default); see 0098.

CREATE TABLE IF NOT EXISTS portal_action_events (
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

CREATE INDEX IF NOT EXISTS idx_action_events_entity
  ON portal_action_events (entity_id, created_at DESC);
