-- Portal substrate for Clerk auth + product subscription model
-- ============================================================================
--
-- Adds the schema substrate the AI Employee dashboard (and future subscription
-- products) needs to live inside portal.smd.services as product modules.
--
-- Decisions encoded here:
--   * Clerk is the identity layer. `users.clerk_user_id` and
--     `entities.clerk_org_id` are the bridge to local business state.
--   * Subscriptions are product-agnostic. The same table tracks AI Employee
--     and any future productized SKU.
--   * Per-product roles (principal | operator | compliance for AI Employee)
--     live in a polymorphic table keyed by (user, entity, product_slug).
--     Clerk's `admin | basic_member` Organization role sits at a separate axis
--     and is resolved from Clerk, not from this table.
--
-- Forward-only, additive. No drops. Existing magic-link auth keeps working
-- through the migration. Removal of magic-link tables is deferred to a later
-- migration once Clerk-backed login is verified in production.
-- ============================================================================

-- ---------- users.clerk_user_id ----------
-- Bridge column to the Clerk user that owns this portal identity. Nullable
-- during transition; backfilled by the Clerk-import flow. Unique when present.
ALTER TABLE users ADD COLUMN clerk_user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_user
  ON users(clerk_user_id) WHERE clerk_user_id IS NOT NULL;

-- ---------- entities.clerk_org_id ----------
-- Bridge column to the Clerk Organization representing this customer. Nullable
-- until the entity becomes a paying customer with portal access provisioned.
-- A single entity maps to at most one Clerk Organization (1:1).
ALTER TABLE entities ADD COLUMN clerk_org_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_clerk_org
  ON entities(clerk_org_id) WHERE clerk_org_id IS NOT NULL;

-- ---------- subscriptions ----------
-- Product-agnostic subscription ledger. One row per (entity, product) pair
-- the customer has purchased. The `product_slug` is a stable identifier
-- ('ai-employee' for the v1 SKU); future products add new slugs without
-- schema changes.
--
-- `settings_json` holds per-product configuration the portal needs to render
-- the product module (e.g., the AI Employee customer slug used to address
-- the per-customer Hermes Machine). Substantive product state lives in the
-- customer's per-customer D1 per ADR 0008, not here.
CREATE TABLE IF NOT EXISTS subscriptions (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  product_slug    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN (
    'provisioning', 'active', 'paused', 'cancelled'
  )),
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at        TEXT,
  settings_json   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_id, product_slug)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_entity
  ON subscriptions(entity_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_product_status
  ON subscriptions(product_slug, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_org_product
  ON subscriptions(org_id, product_slug);

-- ---------- product_roles ----------
-- Per-user, per-entity, per-product role assignment. For AI Employee, the
-- `role` vocabulary is 'principal' | 'operator' | 'compliance' (set by the
-- product, not constrained at the schema layer — future products may use
-- different vocabularies).
--
-- Sits on a separate axis from Clerk's Organization membership role
-- (admin | basic_member), which governs who can manage the org itself.
-- Product roles govern what a user can do INSIDE a specific product they
-- have access to.
--
-- Soft-delete via revoked_at preserves the audit trail. A user may have
-- multiple roles within a single product on a single entity (the UNIQUE
-- constraint permits row coexistence on different role values).
CREATE TABLE IF NOT EXISTS product_roles (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES organizations(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  entity_id       TEXT NOT NULL REFERENCES entities(id),
  product_slug    TEXT NOT NULL,
  role            TEXT NOT NULL,
  granted_by      TEXT REFERENCES users(id),
  granted_at      TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at      TEXT,
  UNIQUE(user_id, entity_id, product_slug, role)
);

CREATE INDEX IF NOT EXISTS idx_product_roles_user_entity
  ON product_roles(user_id, entity_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_product_roles_entity_product
  ON product_roles(entity_id, product_slug) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_product_roles_org_product
  ON product_roles(org_id, product_slug) WHERE revoked_at IS NULL;
