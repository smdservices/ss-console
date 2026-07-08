/**
 * Tests for the Operator access gate (src/lib/portal/operator-access.ts).
 *
 * Each Operator surface page calls `resolveOperatorAccess` with the set
 * of roles it accepts. The helper returns either `{ kind: 'redirect', to }` —
 * the page does `Astro.redirect(access.to)` — or `{ kind: 'allowed', ... }`
 * with the resolved user/client/subscription/roles. This contract is what
 * keeps wrong-role users out of drafts, matters, calendar, audit, and the
 * settings sub-pages.
 *
 * We mock `getPortalClient` so the test can exercise each redirect branch
 * without standing up a Clerk session, then drive subscriptions and
 * product_roles via a real test D1. Migrations are applied per spec so the
 * schema constraints (UNIQUE(entity_id, product_slug), the CHECK on status,
 * the UNIQUE on (user, entity, product_slug, role)) are real.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import { ORG_ID } from '../src/lib/constants'

// Mock getPortalClient before importing the helper. The portal-session
// module pulls in @clerk/astro middleware types that aren't available in
// the vitest environment, so we replace the whole module surface.
vi.mock('../src/lib/portal/session', () => ({
  getPortalClient: vi.fn(),
}))

import { getPortalClient } from '../src/lib/portal/session'
import { resolveOperatorAccess } from '../src/lib/portal/operator-access'

const migrationsDir = resolve(process.cwd(), 'migrations')

const ENTITY_ID = 'entity-test'
const USER_ID = 'user-test'
const OTHER_USER_ID = 'user-other'
const PRODUCT_SLUG = 'operator'
// The operator instance addressed in these tests (its customer_slug). Multi-
// operator: the slug — not the entity alone — identifies the operator.
const SLUG = 'test-op'

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  return db
}

async function seedEntity(db: D1Database): Promise<void> {
  await db
    .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
    .bind(ENTITY_ID, ORG_ID, 'Test Firm', 'test-firm')
    .run()
  // The instance's config must exist and belong to this entity for the gate's
  // ownership check to pass. Seeded alongside the entity for every test.
  await seedConfig(db, SLUG, ENTITY_ID)
}

async function seedConfig(db: D1Database, slug: string, entityId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO customer_configs
        (customer_slug, entity_id, org_id, schema_version, personas_json, git_sha, synced_at)
       VALUES (?, ?, ?, '1', '[]', 'sha-test', '2026-05-21T00:00:00Z')`
    )
    .bind(slug, entityId, ORG_ID)
    .run()
}

async function seedUser(db: D1Database, userId: string, email: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, org_id, email, name, role, entity_id, clerk_user_id)
       VALUES (?, ?, ?, ?, 'client', ?, ?)`
    )
    .bind(userId, ORG_ID, email, email, ENTITY_ID, `clerk_${userId}`)
    .run()
}

async function seedSubscription(
  db: D1Database,
  status: 'provisioning' | 'active' | 'paused' | 'cancelled'
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO subscriptions (id, org_id, entity_id, product_slug, instance_slug, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind('sub-test', ORG_ID, ENTITY_ID, PRODUCT_SLUG, SLUG, status)
    .run()
}

async function grantRole(db: D1Database, userId: string, role: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO product_roles (id, org_id, user_id, entity_id, product_slug, role)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(`pr-${userId}-${role}`, ORG_ID, userId, ENTITY_ID, PRODUCT_SLUG, role)
    .run()
}

function mockUser(id: string, email: string) {
  return {
    id,
    org_id: ORG_ID,
    email,
    name: email,
    role: 'client',
    entity_id: ENTITY_ID,
    clerk_user_id: `clerk_${id}`,
  }
}

function mockClient() {
  return {
    id: ENTITY_ID,
    org_id: ORG_ID,
    name: 'Test Firm',
    slug: 'test-firm',
    phone: null,
    website: null,
    stage: 'engaged' as const,
    stage_changed_at: '2026-05-21T00:00:00Z',
    pain_score: null,
    vertical: null,
    area: null,
    employee_count: null,
    tier: null,
    summary: null,
    next_action: null,
    next_action_at: null,
    source_pipeline: null,
    created_at: '2026-05-21T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
    clerk_org_id: 'clerk_org_test',
  }
}

const fakeLocals = {} as App.Locals

describe('resolveOperatorAccess', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await freshDb()
    vi.mocked(getPortalClient).mockReset()
  })

  it('redirects to sign-in when no portal session exists', async () => {
    vi.mocked(getPortalClient).mockResolvedValue(null)

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['staff', 'principal'],
    })

    expect(result.kind).toBe('redirect')
    if (result.kind === 'redirect') {
      expect(result.to).toBe('/auth/sign-in')
    }
  })

  it('redirects to no-subscription sign-in when entity not provisioned', async () => {
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'principal@firm.com'),
      client: null,
    })

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['staff', 'principal'],
    })

    expect(result.kind).toBe('redirect')
    if (result.kind === 'redirect') {
      expect(result.to).toBe('/auth/sign-in?status=no_subscription')
    }
  })

  it('redirects to landing when entity has no Operator subscription', async () => {
    await seedEntity(db)
    await seedUser(db, USER_ID, 'principal@firm.com')
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'principal@firm.com'),
      client: mockClient(),
    })

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['staff', 'principal'],
    })

    expect(result.kind).toBe('redirect')
    if (result.kind === 'redirect') {
      expect(result.to).toBe('/portal/products/operator')
    }
  })

  it('redirects to landing when subscription is cancelled', async () => {
    await seedEntity(db)
    await seedUser(db, USER_ID, 'principal@firm.com')
    await seedSubscription(db, 'cancelled')
    await grantRole(db, USER_ID, 'principal')
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'principal@firm.com'),
      client: mockClient(),
    })

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['staff', 'principal'],
    })

    expect(result.kind).toBe('redirect')
    if (result.kind === 'redirect') {
      expect(result.to).toBe('/portal/products/operator')
    }
  })

  it('redirects to landing when user has no role on this product', async () => {
    await seedEntity(db)
    await seedUser(db, USER_ID, 'noaccess@firm.com')
    await seedSubscription(db, 'active')
    // No grantRole — caller has zero product_roles rows
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'noaccess@firm.com'),
      client: mockClient(),
    })

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['staff', 'principal'],
    })

    expect(result.kind).toBe('redirect')
    if (result.kind === 'redirect') {
      expect(result.to).toBe('/portal/products/operator')
    }
  })

  it("redirects to landing when caller's role isn't in allowedRoles (compliance hitting drafts)", async () => {
    await seedEntity(db)
    await seedUser(db, USER_ID, 'compliance@firm.com')
    await seedSubscription(db, 'active')
    await grantRole(db, USER_ID, 'compliance')
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'compliance@firm.com'),
      client: mockClient(),
    })

    // Drafts allows operator | principal only — compliance must be redirected
    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['staff', 'principal'],
    })

    expect(result.kind).toBe('redirect')
    if (result.kind === 'redirect') {
      expect(result.to).toBe('/portal/products/operator')
    }
  })

  it('allows access when caller has principal role and surface accepts principal', async () => {
    await seedEntity(db)
    await seedUser(db, USER_ID, 'principal@firm.com')
    await seedSubscription(db, 'active')
    await grantRole(db, USER_ID, 'principal')
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'principal@firm.com'),
      client: mockClient(),
    })

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['staff', 'principal'],
    })

    expect(result.kind).toBe('allowed')
    if (result.kind === 'allowed') {
      expect(result.user.id).toBe(USER_ID)
      expect(result.client.id).toBe(ENTITY_ID)
      expect(result.subscription.status).toBe('active')
      expect(result.subscription.instance_slug).toBe(SLUG)
      expect(result.roles).toContain('principal')
      // The resolved instance is returned so pages don't re-read it.
      expect(result.customerSlug).toBe(SLUG)
      expect(result.config.customer_slug).toBe(SLUG)
      expect(result.config.entity_id).toBe(ENTITY_ID)
    }
  })

  it('allows access when caller has operator role and surface accepts operator', async () => {
    await seedEntity(db)
    await seedUser(db, USER_ID, 'operator@firm.com')
    await seedSubscription(db, 'active')
    await grantRole(db, USER_ID, 'staff')
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'operator@firm.com'),
      client: mockClient(),
    })

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['staff', 'principal'],
    })

    expect(result.kind).toBe('allowed')
    if (result.kind === 'allowed') {
      expect(result.roles).toContain('staff')
    }
  })

  it('allows access during provisioning status (matches surface gate posture)', async () => {
    await seedEntity(db)
    await seedUser(db, USER_ID, 'principal@firm.com')
    await seedSubscription(db, 'provisioning')
    await grantRole(db, USER_ID, 'principal')
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'principal@firm.com'),
      client: mockClient(),
    })

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['staff', 'principal'],
    })

    // Provisioning subscriptions DO return — the helper matches getProductSubscription
    // which treats provisioning/active/paused as "exists". Surfaces render their
    // own empty state. Only the landing branches on lifecycle status.
    expect(result.kind).toBe('allowed')
    if (result.kind === 'allowed') {
      expect(result.subscription.status).toBe('provisioning')
    }
  })

  it('allows access during paused status', async () => {
    await seedEntity(db)
    await seedUser(db, USER_ID, 'principal@firm.com')
    await seedSubscription(db, 'paused')
    await grantRole(db, USER_ID, 'principal')
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'principal@firm.com'),
      client: mockClient(),
    })

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['staff', 'principal'],
    })

    expect(result.kind).toBe('allowed')
    if (result.kind === 'allowed') {
      expect(result.subscription.status).toBe('paused')
    }
  })

  it('audit-surface configuration allows all three role vocabularies', async () => {
    await seedEntity(db)
    await seedUser(db, USER_ID, 'compliance@firm.com')
    await seedSubscription(db, 'active')
    await grantRole(db, USER_ID, 'compliance')
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'compliance@firm.com'),
      client: mockClient(),
    })

    // Audit accepts principal | operator | compliance
    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['principal', 'staff', 'compliance'],
    })

    expect(result.kind).toBe('allowed')
    if (result.kind === 'allowed') {
      expect(result.roles).toEqual(['compliance'])
    }
  })

  it('returns all of the caller’s granted roles, not just the matched one', async () => {
    await seedEntity(db)
    await seedUser(db, USER_ID, 'wearsmanyhats@firm.com')
    await seedSubscription(db, 'active')
    await grantRole(db, USER_ID, 'principal')
    await grantRole(db, USER_ID, 'compliance')
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'wearsmanyhats@firm.com'),
      client: mockClient(),
    })

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['principal'],
    })

    expect(result.kind).toBe('allowed')
    if (result.kind === 'allowed') {
      expect(result.roles).toEqual(expect.arrayContaining(['principal', 'compliance']))
      expect(result.roles).toHaveLength(2)
    }
  })

  it('only counts non-revoked roles', async () => {
    await seedEntity(db)
    await seedUser(db, USER_ID, 'wasprincipal@firm.com')
    await seedSubscription(db, 'active')
    await grantRole(db, USER_ID, 'principal')
    // Revoke the only role
    await db
      .prepare(
        `UPDATE product_roles SET revoked_at = datetime('now')
         WHERE user_id = ? AND entity_id = ? AND product_slug = ?`
      )
      .bind(USER_ID, ENTITY_ID, PRODUCT_SLUG)
      .run()
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'wasprincipal@firm.com'),
      client: mockClient(),
    })

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['principal'],
    })

    expect(result.kind).toBe('redirect')
    if (result.kind === 'redirect') {
      expect(result.to).toBe('/portal/products/operator')
    }
  })

  it('cross-entity guard: a valid slug owned by ANOTHER entity is refused', async () => {
    // The signed-in client (ENTITY_ID) has a live subscription + role, but asks
    // for a slug whose config belongs to a different entity. Even with a role on
    // its own operator, it must not reach another client's operator by slug.
    await seedEntity(db)
    await seedUser(db, USER_ID, 'principal@firm.com')
    await seedSubscription(db, 'active')
    await grantRole(db, USER_ID, 'principal')
    // A foreign entity that owns the config for slug 'foreign-op'.
    await db
      .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
      .bind('entity-foreign', ORG_ID, 'Foreign Firm', 'foreign-firm')
      .run()
    await seedConfig(db, 'foreign-op', 'entity-foreign')
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'principal@firm.com'),
      client: mockClient(),
    })

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: 'foreign-op',
      allowedRoles: ['principal'],
    })

    expect(result.kind).toBe('redirect')
    if (result.kind === 'redirect') {
      expect(result.to).toBe('/portal/products/operator')
    }
  })

  it('unknown slug (no such config) redirects to the operator root', async () => {
    await seedEntity(db)
    await seedUser(db, USER_ID, 'principal@firm.com')
    await seedSubscription(db, 'active')
    await grantRole(db, USER_ID, 'principal')
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'principal@firm.com'),
      client: mockClient(),
    })

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: 'no-such-operator',
      allowedRoles: ['principal'],
    })

    expect(result.kind).toBe('redirect')
    if (result.kind === 'redirect') {
      expect(result.to).toBe('/portal/products/operator')
    }
  })

  it('isolates roles per (user, entity, product) — another user’s role doesn’t grant access', async () => {
    await seedEntity(db)
    await seedUser(db, USER_ID, 'noaccess@firm.com')
    await seedUser(db, OTHER_USER_ID, 'principal@firm.com')
    await seedSubscription(db, 'active')
    await grantRole(db, OTHER_USER_ID, 'principal')
    vi.mocked(getPortalClient).mockResolvedValue({
      user: mockUser(USER_ID, 'noaccess@firm.com'),
      client: mockClient(),
    })

    const result = await resolveOperatorAccess(db, fakeLocals, {
      customerSlug: SLUG,
      allowedRoles: ['principal'],
    })

    expect(result.kind).toBe('redirect')
    if (result.kind === 'redirect') {
      expect(result.to).toBe('/portal/products/operator')
    }
  })
})
