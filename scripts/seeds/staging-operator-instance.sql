-- Staging Operator instance fixture — STAGING DATABASE ONLY.
--
-- Applied by `npm run db:seed:staging -- --tier=2`. Depends on tier 1
-- (scripts/seeds/staging-portal-access.sql) for the entity and client user, and
-- on the customer_configs row having been PROJECTED first:
--
--   npx tsx scripts/project-customer-config.ts smd-staging 01JSTAGING000ENTITY00001 \
--     --out=scripts/.generated/project-smd-staging-STAGING.sql
--   npx wrangler d1 execute ss-console-db-staging --remote -y \
--     --file=scripts/.generated/project-smd-staging-STAGING.sql
--
-- This file deliberately contains NO customer_configs write. ADR 0012 forbids
-- hand-edited rows there; they are projected from the committed customer.yaml.
-- tests/staging-isolation.test.ts enforces that.
--
-- `smd-staging` is the permanent pre-production Operator seat — a real,
-- provisioned Machine that serves nobody. Pointing the staging console at it
-- pairs the pre-prod seat with the pre-prod console.

-- ---------------------------------------------------------------------------
-- The subscription that makes the Operator product visible to the fixture
-- entity. resolveOperatorAccess (src/lib/portal/operator-access.ts) requires
-- instance_slug to match a customer_configs.customer_slug.
--
-- status = 'active', not 'provisioning', on purpose. deriveOfferings
-- (src/lib/portal/offerings.ts) computes
--   hasBillingRelationship = hasInvoices || subscriptions.some(s => s.status !== 'provisioning')
-- and an entity whose only offerings are provisioning operator subscriptions,
-- with no invoices, is redirected off Home into the operator area by
-- preGoLiveLanding. Flip this single value to 'provisioning' when you
-- specifically want to rehearse that pre-go-live redirect.
-- ---------------------------------------------------------------------------
INSERT INTO subscriptions (id, org_id, entity_id, product_slug, instance_slug, status)
VALUES (
  '01JSTAGING000SUBOPER0001',
  '01JQFK0000SMDSERVICES000',
  '01JSTAGING000ENTITY00001',
  'operator',
  'smd-staging',
  'active'
)
ON CONFLICT(id) DO UPDATE SET
  status        = 'active',
  instance_slug = excluded.instance_slug,
  ended_at      = NULL,
  updated_at    = datetime('now');

-- ---------------------------------------------------------------------------
-- The in-product role. 'principal' is the only role that can reach the
-- switchable domains, so it is what a Named Administrator holds.
--
-- The update un-revokes rather than inserting a duplicate, so the role-gate
-- negative test (revoke, observe the redirect, re-seed) is repeatable.
-- ---------------------------------------------------------------------------
INSERT INTO product_roles (id, org_id, user_id, entity_id, product_slug, role)
VALUES (
  '01JSTAGING000ROLEPRIN001',
  '01JQFK0000SMDSERVICES000',
  '01JSTAGING000USERCLIENT1',
  '01JSTAGING000ENTITY00001',
  'operator',
  'principal'
)
ON CONFLICT(id) DO UPDATE SET
  role       = 'principal',
  revoked_at = NULL;
