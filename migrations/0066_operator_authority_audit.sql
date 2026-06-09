-- Operator authority-flip audit ledger — ADR 0041 §4.3 / design §5.9
-- ============================================================================
--
-- Records every SMD flip of a per-domain authority switch (managed <-> client)
-- on a customer's posture. Authority is Layer 1 (who may OPERATE a domain — the
-- client org or only SMD), deliberately distinct from Layer 3 entitlements
-- (what the operator itself may do, recorded in config_change_audit). The
-- foundations doc §2 names that distinction as the one we will not blur, so the
-- authority audit is its OWN ledger rather than an overloaded change_type on the
-- entitlement ledger.
--
-- WHY AN INTENT LEDGER (not a replica write):
--   The authority block lives in customer.yaml (git source of truth, ADR 0012);
--   customer_configs is a read replica written only by git -> CI. A portal flip
--   therefore records INTENT here and reaches the runtime via the deferred git
--   write-back path (same posture as config_change_audit for ceilings). The
--   `source` column scopes a row as 'portal_intent' so a reader is never misled
--   into treating it as a runtime-confirmed fact.
--
-- ISOLATION / SCOPE: a console-side control-plane table (like config_change_audit
-- and operator_change_requests), NOT per-customer runtime D1 — so the admin
-- authority surface legitimately reads it per customer. No secrets, no runtime
-- state; just who flipped which domain, from what to what, when.
--
-- INVARIANT: authority governs only the CLIENT org's operability. SMD always
-- retains full control regardless of any value here (Layer 0). A row never
-- encodes "SMD may not" — `old_holder`/`new_holder` describe the client switch.
--
-- Append-only by convention: no UPDATE/DELETE code path. Forward-only,
-- additive. No drops.
--
-- Refers to: docs/adr/0041-operator-authority-posture.md
--            docs/adr/0012-customer-yaml-storage.md (git source of truth)
--            docs/design/operator/01-admin-portal.md §5.9
-- ============================================================================

CREATE TABLE IF NOT EXISTS operator_authority_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id       TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  customer_slug   TEXT NOT NULL,
  -- Provenance scope. 'portal_intent' = SMD action in the control plane (the
  -- only source today). Reserved 'runtime_confirmed' for a future
  -- runtime->portal reconciliation, mirroring config_change_audit.
  source          TEXT NOT NULL DEFAULT 'portal_intent'
                    CHECK (source IN ('portal_intent', 'runtime_confirmed')),
  -- Who: the authenticated SMD staff actor (Layer 0).
  actor_user_id   TEXT NOT NULL,
  actor_email     TEXT NOT NULL,
  actor_role      TEXT NOT NULL,
  -- The switchable authority domain flipped (e.g. 'people_access', 'connectors').
  -- Validated in code against SWITCHABLE_AUTHORITY_DOMAINS.
  domain          TEXT NOT NULL,
  -- Who operated the domain before / after, on the CLIENT axis. SMD control is
  -- constant and not encoded here.
  old_holder      TEXT NOT NULL CHECK (old_holder IN ('managed', 'client')),
  new_holder      TEXT NOT NULL CHECK (new_holder IN ('managed', 'client')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_operator_authority_audit_entity_created
  ON operator_authority_audit (entity_id, created_at DESC);
