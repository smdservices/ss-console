/**
 * Tests for the authority-flip write path — the pure validators + ledger
 * (src/lib/admin/authority-write.ts) and the flip endpoint
 * (POST /api/admin/operator/[customer]/authority). Design §5.9, ADR 0041.
 *
 * The endpoint tests run against a real D1 and assert the two invariants that
 * matter most: a flip records INTENT to operator_authority_audit with the
 * Layer-0 SMD actor, and it NEVER mutates the read-only customer_configs replica
 * (ADR 0012 — the value reaches runtime via deferred git write-back).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
  installWorkerdPolyfills,
} from '@venturecrane/crane-test-harness'
import path from 'node:path'
import { POST } from '../src/pages/api/admin/operator/[customer]/authority'
import { env as testEnv } from 'cloudflare:workers'
import {
  validateAuthorityFlip,
  toggleHolder,
  isAuthorityHolder,
  listAuthorityAudit,
} from '../src/lib/admin/authority-write'
import { getCustomerConfig } from '../src/lib/portal/customer-config'

installWorkerdPolyfills()

const migrationsDir = path.resolve(__dirname, '../migrations')
const ORG_ID = 'org-1'
const ENTITY_ID = 'ent-auth'
const SLUG = 'acme'

describe('authority-write pure helpers', () => {
  it('toggleHolder flips between managed and client', () => {
    expect(toggleHolder('managed')).toBe('client')
    expect(toggleHolder('client')).toBe('managed')
  })

  it('isAuthorityHolder accepts only the two holders', () => {
    expect(isAuthorityHolder('managed')).toBe(true)
    expect(isAuthorityHolder('client')).toBe(true)
    expect(isAuthorityHolder('smd')).toBe(false)
    expect(isAuthorityHolder(null)).toBe(false)
  })

  it('validateAuthorityFlip rejects non-switchable domains (incl. SMD-only)', () => {
    expect(
      validateAuthorityFlip({ domain: 'cost', old_holder: 'managed', new_holder: 'client' })
    ).toEqual({ ok: false, error: 'invalid_domain' })
    expect(
      validateAuthorityFlip({ domain: 'provisioning', old_holder: 'managed', new_holder: 'client' })
    ).toEqual({ ok: false, error: 'invalid_domain' })
    expect(
      validateAuthorityFlip({ domain: 'nonsense', old_holder: 'managed', new_holder: 'client' })
    ).toEqual({ ok: false, error: 'invalid_domain' })
  })

  it('validateAuthorityFlip rejects a bad holder and a no-op', () => {
    expect(
      validateAuthorityFlip({ domain: 'connectors', old_holder: 'managed', new_holder: 'smd' })
    ).toEqual({ ok: false, error: 'invalid_holder' })
    expect(
      validateAuthorityFlip({ domain: 'connectors', old_holder: 'client', new_holder: 'client' })
    ).toEqual({ ok: false, error: 'no_change' })
  })

  it('validateAuthorityFlip accepts a real switch flip', () => {
    const r = validateAuthorityFlip({
      domain: 'people_access',
      old_holder: 'managed',
      new_holder: 'client',
    })
    expect(r).toEqual({
      ok: true,
      domain: 'people_access',
      old_holder: 'managed',
      new_holder: 'client',
    })
  })
})

interface MinimalSession {
  userId: string
  orgId: string
  role: string
  email: string
  expiresAt: string
}

function adminSession(): MinimalSession {
  return {
    userId: 'usr-captain',
    orgId: ORG_ID,
    role: 'admin',
    email: 'captain@example.com',
    expiresAt: '2099-12-31T00:00:00Z',
  }
}

function buildCtx(opts: {
  session: MinimalSession | null
  slug: string
  form: Record<string, string>
}): Parameters<typeof POST>[0] {
  const body = new URLSearchParams(opts.form)
  const request = new Request(`http://test.local/api/admin/operator/${opts.slug}/authority`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  return {
    request,
    params: { customer: opts.slug },
    locals: { session: opts.session },
  } as unknown as Parameters<typeof POST>[0]
}

async function seedConfig(): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO customer_configs
       (entity_id, org_id, customer_slug, schema_version, personas_json, git_sha, synced_at)
     VALUES (?, ?, ?, '1.0.0', '[]', 'sha', '2026-06-08T00:00:00Z')`
  )
    .bind(ENTITY_ID, ORG_ID, SLUG)
    .run()
}

function locationOf(res: Response): string {
  return res.headers.get('Location') ?? ''
}

describe('POST /api/admin/operator/[customer]/authority', () => {
  beforeAll(() => {
    expect(discoverNumericMigrations(migrationsDir).length).toBeGreaterThan(0)
  })

  beforeEach(async () => {
    const db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await db
      .prepare(
        `INSERT INTO organizations (id, name, slug, created_at, updated_at)
         VALUES (?, 'Test Org', 'test-org', datetime('now'), datetime('now'))`
      )
      .bind(ORG_ID)
      .run()
    await db
      .prepare(`INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, 'Acme', ?)`)
      .bind(ENTITY_ID, ORG_ID, SLUG)
      .run()
    for (const k of Object.keys(testEnv)) delete (testEnv as unknown as Record<string, unknown>)[k]
    Object.assign(testEnv, { DB: db })
  })

  it('rejects a non-admin session', async () => {
    const res = await POST(
      buildCtx({ session: null, slug: SLUG, form: { domain: 'connectors', new_holder: 'client' } })
    )
    expect(res.status).toBe(401)
  })

  it('redirects not_found when the slug has no operator', async () => {
    const res = await POST(
      buildCtx({
        session: adminSession(),
        slug: 'ghost',
        form: { domain: 'connectors', new_holder: 'client' },
      })
    )
    expect(locationOf(res)).toContain('status=not_found')
  })

  it('records a flip to the ledger and does NOT mutate the config replica', async () => {
    await seedConfig()
    const res = await POST(
      buildCtx({
        session: adminSession(),
        slug: SLUG,
        form: { domain: 'people_access', new_holder: 'client' },
      })
    )
    expect(locationOf(res)).toContain('status=saved')

    // Intent recorded with the SMD actor.
    const audit = await listAuthorityAudit(testEnv.DB, ENTITY_ID)
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      domain: 'people_access',
      old_holder: 'managed',
      new_holder: 'client',
      actor_email: 'captain@example.com',
      source: 'portal_intent',
    })

    // The live replica is untouched — posture still resolves to the launch
    // default (managed) until the deferred git write-back materializes it.
    const config = await getCustomerConfig(testEnv.DB, ENTITY_ID)
    expect(config?.authority).toEqual({ default: 'managed', overrides: {} })
  })

  it('rejects flipping an SMD-only domain', async () => {
    await seedConfig()
    const res = await POST(
      buildCtx({
        session: adminSession(),
        slug: SLUG,
        form: { domain: 'cost', new_holder: 'client' },
      })
    )
    expect(locationOf(res)).toContain('status=invalid_domain')
    expect(await listAuthorityAudit(testEnv.DB, ENTITY_ID)).toHaveLength(0)
  })

  it('rejects a no-op flip (target equals current holder)', async () => {
    await seedConfig()
    const res = await POST(
      buildCtx({
        session: adminSession(),
        slug: SLUG,
        form: { domain: 'connectors', new_holder: 'managed' },
      })
    )
    expect(locationOf(res)).toContain('status=no_change')
    expect(await listAuthorityAudit(testEnv.DB, ENTITY_ID)).toHaveLength(0)
  })
})
