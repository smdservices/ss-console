-- Operator provisioning-intent ledger — design §4.5
-- ============================================================================
--
-- Records every SMD attempt to stand up a new operator from the admin console:
-- the authored customer.yaml essentials, validated by the existing validator +
-- secret-exclusion scan, with the rendered candidate YAML captured on success.
--
-- WHY THIS LEDGER HAS NO entities() FK (unlike operator_authority_audit and
-- config_change_audit):
--   Provisioning is the one admin action whose subject does NOT exist yet — the
--   customer (its entity, its customer_configs row) is created downstream by the
--   stand-up tooling (operator/bin/provision-customer.sh). So this ledger keys on
--   the PROPOSED customer_id, not an entity_id. A future reconciliation can link
--   a row to the entity once provisioned; v1 does not.
--
-- WHY AN INTENT LEDGER (not a config write):
--   A Cloudflare Worker cannot commit the git source of truth (ADR 0012 §2 —
--   configs-repo write-back is OUT OF SCOPE at v1) or call Fly. The console
--   authors + validates; the actual commit + Machine stand-up is the existing
--   tooling (#1262). This row records that an authored candidate passed (or
--   failed) validation, and on success preserves the exact YAML the operator
--   drops into operator/customers/<slug>/customer.yaml before running the tool.
--   `source` scopes a row as 'portal_intent' so a reader never treats it as a
--   provisioned-and-running fact.
--
-- ISOLATION / SCOPE: a console-side control-plane table (like config_change_audit
-- and operator_authority_audit), NOT per-customer runtime D1. No live secrets:
-- the candidate_yaml is the secret-SCANNED config (token_refs are pointers, never
-- values — the validator's secret detector rejects inline secrets before a row is
-- ever written on the success path).
--
-- Append-only by convention: no UPDATE/DELETE code path. Forward-only, additive.
--
-- Refers to: docs/design/operator/01-admin-portal.md §4.5
--            docs/adr/0012-customer-yaml-storage.md (git source of truth)
--            docs/adr/0019-customer-yaml-to-profile-config-translation.md
-- ============================================================================

CREATE TABLE IF NOT EXISTS operator_provisioning_intent (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Provenance scope. 'portal_intent' = SMD console action (the only source
  -- today). Reserved 'runtime_confirmed' for a future provisioned-link pass.
  source          TEXT NOT NULL DEFAULT 'portal_intent'
                    CHECK (source IN ('portal_intent', 'runtime_confirmed')),
  -- The PROPOSED customer slug (^[a-z0-9][a-z0-9-]{0,31}$, enforced in code via
  -- the customer.yaml validator). Not an entity_id — the entity does not exist
  -- yet at authoring time.
  customer_id     TEXT NOT NULL,
  customer_name   TEXT NOT NULL,
  vertical        TEXT NOT NULL,
  -- Who: the authenticated SMD staff actor (Layer 0).
  actor_user_id   TEXT NOT NULL,
  actor_email     TEXT NOT NULL,
  actor_role      TEXT NOT NULL,
  -- Did the authored candidate pass validation?
  outcome         TEXT NOT NULL CHECK (outcome IN ('validated', 'rejected')),
  -- Count of validation errors (0 on the validated path).
  error_count     INTEGER NOT NULL DEFAULT 0,
  -- The rendered, secret-scanned candidate customer.yaml. Populated on the
  -- validated path; may be empty text on a rejected attempt.
  candidate_yaml  TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_operator_provisioning_intent_created
  ON operator_provisioning_intent (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_provisioning_intent_customer
  ON operator_provisioning_intent (customer_id, created_at DESC);
