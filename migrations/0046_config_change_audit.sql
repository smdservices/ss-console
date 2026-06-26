-- ============================================================================
-- Migration 0046: config_change_audit table (ADR 0026 / ADR 0030)
-- ============================================================================
--
-- The control-plane ledger for autonomy-config governance actions. ADR 0026
-- requires every change to a trust ceiling / exposure setting to be
-- principal-authenticated, immutably audited, and floor-checked. ADR 0030
-- names the control plane as the principal's single governing surface, and
-- §4 (Authority) is operated through this table.
--
-- WHY A NEW TABLE (not customer_config_history, migration 0045):
--   0045 records git-sync EVENTS (git_sha-keyed; shouldRecordSync no-ops on
--   identical SHA). A governance action is a different thing:
--     * it has no git_sha — the git write-back leg is deferred (ADR 0025
--       step 7), so the live config is not mutated by the portal (customer-
--       config.ts is read-only on principle, ADR 0012 §2);
--     * a REJECTED floor-violation attempt must be recorded (ADR 0026 §4)
--       and produces no sync and no SHA, so it cannot live in 0045 at all.
--   This table answers "who authorized which authority change, from what to
--   what, and was it floor-rejected" — the compliance question ADR 0026 exists
--   to answer.
--
-- HONEST SCOPING (`source` column):
--   Rows are `portal_intent`: the principal's governance action recorded in
--   the control plane. They are NOT the per-customer runtime audit log (which
--   lives on the Machine, unreachable from the portal per ADR 0009). The
--   value change reaches the runtime via the deferred git write-back path;
--   correlating this ledger with the runtime audit is a tracked follow-on.
--   The column exists so a future reader is never misled into treating an
--   intent row as a runtime-confirmed fact.
--
-- Append-only by convention: no UPDATE/DELETE code path. Forward-only,
-- additive. No drops.
--
-- Refers to: docs/adr/0026-config-surface-is-a-security-boundary.md
--            docs/adr/0030-control-plane-human-principal-surface.md
--            docs/adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md (floors)
--            docs/adr/0009-cross-machine-query-prohibition.md (control-plane carve-out)
-- ============================================================================

CREATE TABLE IF NOT EXISTS config_change_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_slug   TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  -- Provenance scope. 'portal_intent' = principal action in the control
  -- plane (the only source today). Reserved for a future
  -- 'runtime_confirmed' once the runtime->portal reconciliation lands.
  source          TEXT NOT NULL DEFAULT 'portal_intent'
                    CHECK (source IN ('portal_intent', 'runtime_confirmed')),
  -- Who: the authenticated principal (principal-only per ADR 0011/0026).
  actor_user_id   TEXT NOT NULL,
  actor_email     TEXT NOT NULL,
  actor_role      TEXT NOT NULL,
  -- What changed.
  change_type     TEXT NOT NULL
                    CHECK (change_type IN ('entitlement_exposure', 'entitlement_initiation', 'skill_enabled')),
  persona_slug    TEXT,
  skill_name      TEXT,
  action_class    TEXT,           -- e.g. 'external_send', when change_type='action_ceiling'
  -- Value transition.
  old_value       TEXT,
  new_value       TEXT,
  -- Outcome — the immutable record of the decision, INCLUDING rejections.
  outcome         TEXT NOT NULL
                    CHECK (outcome IN ('accepted', 'rejected_floor', 'rejected_invalid')),
  outcome_reason  TEXT,
  -- Direction of a raise/lower relative to the restrictiveness ordering.
  direction       TEXT NOT NULL DEFAULT 'n/a'
                    CHECK (direction IN ('raise', 'lower', 'lateral', 'n/a')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_cca_slug_created
  ON config_change_audit (customer_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cca_entity_created
  ON config_change_audit (entity_id, created_at DESC);
