import { beforeEach, describe, expect, it } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
} from '@venturecrane/crane-test-harness'
import type { D1Database } from '@cloudflare/workers-types'
import { resolve } from 'node:path'
import { ORG_ID } from '../src/lib/constants'
import { loadMcpCustomer } from '../src/lib/operator/mcp/customer-resolution'
import {
  adminIssueGrant,
  clampTtlDays,
  countActiveGrants,
  GRANT_TTL_DEFAULT_DAYS,
  GRANT_TTL_MAX_DAYS,
  jitIssueGrant,
  listGrants,
  MCP_OPEN_GRANT_CAP,
  revokeGrant,
} from '../src/lib/operator/mcp/grant-store'

const migrationsDir = resolve(process.cwd(), 'migrations')
const SLUG = 'smd'
const ENTITY_ID = 'entity-grant-test'
const ISSUER = 'https://clerk.smd.services'
const RESOURCE_URI = 'https://smd.services/api/operator/smd/mcp'
const ACTOR = 'admin@smd.services'

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  return db
}

async function seed(db: D1Database): Promise<void> {
  await db
    .prepare('INSERT INTO entities (id, org_id, name, slug, clerk_org_id) VALUES (?, ?, ?, ?, ?)')
    .bind(ENTITY_ID, ORG_ID, 'Grant Test', SLUG, null)
    .run()
  await db
    .prepare(
      'INSERT INTO customer_configs ' +
        '(entity_id, org_id, customer_slug, schema_version, personas_json, mcp_connector_json, ' +
        'git_sha, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      ENTITY_ID,
      ORG_ID,
      SLUG,
      '1',
      '[]',
      JSON.stringify({ enabled: true, data_posture: 'open', access: [] }),
      'test-sha',
      '2026-06-27T00:00:00Z'
    )
    .run()
  await db
    .prepare(
      'INSERT INTO mcp_clerk_bindings (entity_id, customer_slug, issuer, resource_uri) ' +
        'VALUES (?, ?, ?, ?)'
    )
    .bind(ENTITY_ID, SLUG, ISSUER, RESOURCE_URI)
    .run()
}

const issueCtx = { entityId: ENTITY_ID, actor: ACTOR, reason: null }

async function auditRows(db: D1Database) {
  const res = await db
    .prepare(
      'SELECT action, clerk_user_id, email, profile, ttl_days, expires_at, actor, reason ' +
        'FROM operator_mcp_grant_audit WHERE customer_slug = ? ORDER BY id ASC'
    )
    .bind(SLUG)
    .all()
  return res.results ?? []
}

describe('grant-store TTL clamping', () => {
  it('clamps junk and out-of-range TTLs into [1, max], default on garbage', () => {
    expect(clampTtlDays(45)).toBe(45)
    expect(clampTtlDays(200)).toBe(GRANT_TTL_MAX_DAYS)
    expect(clampTtlDays(0)).toBe(GRANT_TTL_DEFAULT_DAYS)
    expect(clampTtlDays(-5)).toBe(GRANT_TTL_DEFAULT_DAYS)
    expect(clampTtlDays(Number.NaN)).toBe(GRANT_TTL_DEFAULT_DAYS)
    expect(clampTtlDays(12.9)).toBe(12)
  })
})

describe('grant-store write side (ADR 0057)', () => {
  let db: D1Database
  beforeEach(async () => {
    db = await freshDb()
    await seed(db)
  })

  it('admin-issues a live grant that loadMcpCustomer authorizes', async () => {
    const { expiresAt } = await adminIssueGrant(
      db,
      {
        customerSlug: SLUG,
        clerkUserId: 'user_a',
        email: 'a@firm.com',
        profile: 'quinn',
        ttlDays: 30,
      },
      issueCtx
    )
    expect(expiresAt > new Date().toISOString()).toBe(true)

    const customer = await loadMcpCustomer(db, SLUG)
    expect(customer?.principals).toContainEqual({
      localUserId: 'user_a',
      clerkUserId: 'user_a',
      email: 'a@firm.com',
      profile: 'quinn',
    })

    const audit = await auditRows(db)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      action: 'issue',
      clerk_user_id: 'user_a',
      email: 'a@firm.com',
      profile: 'quinn',
      ttl_days: 30,
      actor: ACTOR,
    })
    expect((audit[0] as { expires_at: string }).expires_at).toBe(expiresAt)
  })

  it('clamps an over-ceiling TTL at issue time', async () => {
    await adminIssueGrant(
      db,
      {
        customerSlug: SLUG,
        clerkUserId: 'user_b',
        email: 'b@firm.com',
        profile: 'quinn',
        ttlDays: 999,
      },
      issueCtx
    )
    const audit = await auditRows(db)
    expect((audit[0] as { ttl_days: number }).ttl_days).toBe(GRANT_TTL_MAX_DAYS)
  })

  it('revokes a grant so loadMcpCustomer drops it, and audits the revoke', async () => {
    await adminIssueGrant(
      db,
      {
        customerSlug: SLUG,
        clerkUserId: 'user_a',
        email: 'a@firm.com',
        profile: 'quinn',
        ttlDays: 30,
      },
      issueCtx
    )
    const res = await revokeGrant(db, { customerSlug: SLUG, clerkUserId: 'user_a' }, issueCtx)
    expect(res.changed).toBe(true)

    const customer = await loadMcpCustomer(db, SLUG)
    expect(customer?.principals.find((p) => p.clerkUserId === 'user_a')).toBeUndefined()

    const audit = await auditRows(db)
    expect(audit.map((r) => (r as { action: string }).action)).toEqual(['issue', 'revoke'])
  })

  it('is idempotent on a missing or already-revoked grant (no audit row)', async () => {
    const missing = await revokeGrant(db, { customerSlug: SLUG, clerkUserId: 'nope' }, issueCtx)
    expect(missing.changed).toBe(false)

    await adminIssueGrant(
      db,
      {
        customerSlug: SLUG,
        clerkUserId: 'user_a',
        email: 'a@firm.com',
        profile: 'quinn',
        ttlDays: 30,
      },
      issueCtx
    )
    await revokeGrant(db, { customerSlug: SLUG, clerkUserId: 'user_a' }, issueCtx)
    const second = await revokeGrant(db, { customerSlug: SLUG, clerkUserId: 'user_a' }, issueCtx)
    expect(second.changed).toBe(false)

    const audit = await auditRows(db)
    expect(audit.map((r) => (r as { action: string }).action)).toEqual(['issue', 'revoke'])
  })

  it('admin re-issue lifts a revocation (clears revoked_at) and re-authorizes', async () => {
    await adminIssueGrant(
      db,
      {
        customerSlug: SLUG,
        clerkUserId: 'user_a',
        email: 'a@firm.com',
        profile: 'quinn',
        ttlDays: 30,
      },
      issueCtx
    )
    await revokeGrant(db, { customerSlug: SLUG, clerkUserId: 'user_a' }, issueCtx)
    await adminIssueGrant(
      db,
      {
        customerSlug: SLUG,
        clerkUserId: 'user_a',
        email: 'a@firm.com',
        profile: 'quinn',
        ttlDays: 30,
      },
      issueCtx
    )

    const customer = await loadMcpCustomer(db, SLUG)
    expect(customer?.principals.find((p) => p.clerkUserId === 'user_a')).toBeDefined()

    const grants = await listGrants(db, SLUG)
    expect(grants).toHaveLength(1)
    expect(grants[0]?.revoked_at).toBeNull()
  })

  it('lists all grants including revoked, newest first', async () => {
    await adminIssueGrant(
      db,
      {
        customerSlug: SLUG,
        clerkUserId: 'user_a',
        email: 'a@firm.com',
        profile: 'quinn',
        ttlDays: 30,
      },
      issueCtx
    )
    await revokeGrant(db, { customerSlug: SLUG, clerkUserId: 'user_a' }, issueCtx)
    const grants = await listGrants(db, SLUG)
    expect(grants).toHaveLength(1)
    expect(grants[0]?.revoked_at).not.toBeNull()
  })
})

describe('jitIssueGrant — open-by-domain (slice 2e)', () => {
  let db: D1Database
  const jitCtx = { entityId: ENTITY_ID, actor: 'system:jit', reason: 'open-policy' }
  beforeEach(async () => {
    db = await freshDb()
    await seed(db)
  })

  const jit = (clerkUserId: string, ttlDays = 7) =>
    jitIssueGrant(
      db,
      {
        customerSlug: SLUG,
        clerkUserId,
        email: `${clerkUserId}@firm.com`,
        profile: 'quinn',
        ttlDays,
      },
      jitCtx
    )

  it('mints a grant and authorizes the subject', async () => {
    const res = await jit('user_jit')
    expect(res).toMatchObject({ issued: true })
    const customer = await loadMcpCustomer(db, SLUG)
    expect(customer?.principals.find((p) => p.clerkUserId === 'user_jit')).toBeDefined()
    const audit = await auditRows(db)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ action: 'issue', actor: 'system:jit' })
  })

  it('STICKY REVOKE: refuses to re-mint a revoked subject (no audit, no resurrection)', async () => {
    await adminIssueGrant(
      db,
      {
        customerSlug: SLUG,
        clerkUserId: 'user_x',
        email: 'user_x@firm.com',
        profile: 'quinn',
        ttlDays: 7,
      },
      issueCtx
    )
    await revokeGrant(db, { customerSlug: SLUG, clerkUserId: 'user_x' }, issueCtx)
    const res = await jit('user_x')
    expect(res).toEqual({ issued: false, reason: 'revoked' })
    const customer = await loadMcpCustomer(db, SLUG)
    expect(customer?.principals.find((p) => p.clerkUserId === 'user_x')).toBeUndefined()
  })

  it('re-mints over an expired (not revoked) grant', async () => {
    await db
      .prepare(
        'INSERT INTO mcp_issued_grants (customer_slug, clerk_user_id, email, profile, expires_at, revoked_at) ' +
          'VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(SLUG, 'user_exp', 'user_exp@firm.com', 'quinn', '2000-01-01T00:00:00.000Z', null)
      .run()
    const res = await jit('user_exp')
    expect(res).toMatchObject({ issued: true })
    const customer = await loadMcpCustomer(db, SLUG)
    expect(customer?.principals.find((p) => p.clerkUserId === 'user_exp')).toBeDefined()
  })

  it('refuses at the per-customer cap', async () => {
    const far = '2999-01-01T00:00:00.000Z'
    const stmts = Array.from({ length: MCP_OPEN_GRANT_CAP }, (_, i) =>
      db
        .prepare(
          'INSERT INTO mcp_issued_grants (customer_slug, clerk_user_id, email, profile, expires_at, revoked_at) ' +
            'VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(SLUG, `cap_${i}`, `cap_${i}@firm.com`, 'quinn', far, null)
    )
    await db.batch(stmts)
    expect(await countActiveGrants(db, SLUG)).toBe(MCP_OPEN_GRANT_CAP)
    const res = await jit('user_overflow')
    expect(res).toEqual({ issued: false, reason: 'cap_exceeded' })
  })
})
