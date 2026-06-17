/**
 * Tests for GET /api/admin/fleet/health (issue #1440).
 *
 * Covers: auth rejection (missing key, wrong key), empty fleet, single-slug
 * with no runtime summary (LEFT JOIN null fields), and multi-slug fleet with
 * mixed status values.
 *
 * Auth is a dedicated bearer secret (`OPERATOR_HEALTH_READ_KEY`) distinct from
 * the machine heartbeat write key. The handler verifies with constant-time
 * compare; no DB lookup is needed for auth.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
  installWorkerdPolyfills,
} from '@venturecrane/crane-test-harness'
import path from 'node:path'
import { GET } from '../src/pages/api/admin/fleet/health'
import { env as testEnv } from 'cloudflare:workers'

installWorkerdPolyfills()

const migrationsDir = path.resolve(__dirname, '../migrations')
const HEALTH_KEY = 'test-health-read-key-32-chars-xxxx'

const ORG_ID = 'org-health-test'
const ENTITY_A = 'ent-alpha'
const ENTITY_B = 'ent-beta'

function buildRequest(opts: { key?: string } = {}): Parameters<typeof GET>[0] {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.key !== undefined) headers['Authorization'] = `Bearer ${opts.key}`
  const request = new Request('http://test.local/api/admin/fleet/health', { headers })
  return { request, params: {}, locals: {} } as unknown as Parameters<typeof GET>[0]
}

async function seedOrg(db: D1Database): Promise<void> {
  await db
    .prepare(
      `INSERT INTO organizations (id, name, slug, created_at, updated_at)
       VALUES (?, 'Health Test Org', 'health-test', datetime('now'), datetime('now'))`
    )
    .bind(ORG_ID)
    .run()
}

async function seedEntity(db: D1Database, entityId: string, slug: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO entities (id, org_id, name, slug, stage, stage_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ongoing', datetime('now'), datetime('now'), datetime('now'))`
    )
    .bind(entityId, ORG_ID, slug, slug)
    .run()
}

async function seedFleetStatus(
  db: D1Database,
  entityId: string,
  slug: string,
  opts: {
    heartbeat_status?: string
    last_heartbeat_ts?: string
    last_audit_ts?: string
  } = {}
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO fleet_status
         (entity_id, customer_slug, heartbeat_status, last_heartbeat_ts, last_audit_ts, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(
      entityId,
      slug,
      opts.heartbeat_status ?? 'green',
      opts.last_heartbeat_ts ?? new Date().toISOString(),
      opts.last_audit_ts ?? null
    )
    .run()
}

async function seedRuntimeSummary(
  db: D1Database,
  entityId: string,
  slug: string,
  opts: {
    summary_status?: string
    open_alerts?: number
    last_activity_ts?: string
  } = {}
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO operator_runtime_summary
         (entity_id, customer_slug, summary_status, open_alerts, last_activity_ts, pushed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(
      entityId,
      slug,
      opts.summary_status ?? 'green',
      opts.open_alerts ?? 0,
      opts.last_activity_ts ?? null
    )
    .run()
}

describe('GET /api/admin/fleet/health', () => {
  beforeAll(() => {
    const files = discoverNumericMigrations(migrationsDir)
    expect(files.length).toBeGreaterThan(0)
  })

  beforeEach(async () => {
    const db = createTestD1()
    const files = discoverNumericMigrations(migrationsDir)
    await runMigrations(db, { files })
    await seedOrg(db)
    for (const k of Object.keys(testEnv)) delete (testEnv as unknown as Record<string, unknown>)[k]
    Object.assign(testEnv, { DB: db, OPERATOR_HEALTH_READ_KEY: HEALTH_KEY })
  })

  it('returns 401 when Authorization header is absent', async () => {
    const res = await GET(buildRequest())
    expect(res.status).toBe(401)
    const body = await res.json<{ error: string }>()
    expect(body.error).toBe('unauthorized')
  })

  it('returns 401 when bearer value is wrong', async () => {
    const res = await GET(buildRequest({ key: 'wrong-key' }))
    expect(res.status).toBe(401)
  })

  it('returns 401 when OPERATOR_HEALTH_READ_KEY is unset', async () => {
    const db = (testEnv as unknown as Record<string, unknown>).DB
    for (const k of Object.keys(testEnv)) delete (testEnv as unknown as Record<string, unknown>)[k]
    Object.assign(testEnv, { DB: db })
    const res = await GET(buildRequest({ key: HEALTH_KEY }))
    expect(res.status).toBe(401)
  })

  it('returns 200 with empty entries when no Machines are provisioned', async () => {
    const res = await GET(buildRequest({ key: HEALTH_KEY }))
    expect(res.status).toBe(200)
    const body = await res.json<{ generated_at: string; entries: unknown[] }>()
    expect(Array.isArray(body.entries)).toBe(true)
    expect(body.entries).toHaveLength(0)
    expect(typeof body.generated_at).toBe('string')
  })

  it('returns an entry with null summary fields when no runtime summary has been pushed', async () => {
    const db = (testEnv as unknown as { DB: D1Database }).DB
    await seedEntity(db, ENTITY_A, 'alpha')
    await seedFleetStatus(db, ENTITY_A, 'alpha', {
      heartbeat_status: 'green',
      last_heartbeat_ts: '2026-06-17T10:00:00Z',
      last_audit_ts: '2026-06-17T09:55:00Z',
    })

    const res = await GET(buildRequest({ key: HEALTH_KEY }))
    expect(res.status).toBe(200)
    const body = await res.json<{ entries: Array<Record<string, unknown>> }>()
    expect(body.entries).toHaveLength(1)

    const entry = body.entries[0]
    expect(entry.slug).toBe('alpha')
    expect(entry.heartbeat_status).toBe('green')
    expect(entry.last_heartbeat_ts).toBe('2026-06-17T10:00:00Z')
    expect(entry.last_audit_ts).toBe('2026-06-17T09:55:00Z')
    expect(entry.summary_status).toBeNull()
    expect(entry.open_alerts).toBeNull()
    expect(entry.last_activity_ts).toBeNull()
    expect(entry.pushed_at).toBeNull()
  })

  it('includes summary fields when a runtime summary has been pushed', async () => {
    const db = (testEnv as unknown as { DB: D1Database }).DB
    await seedEntity(db, ENTITY_A, 'alpha')
    await seedFleetStatus(db, ENTITY_A, 'alpha', { heartbeat_status: 'red' })
    await seedRuntimeSummary(db, ENTITY_A, 'alpha', { summary_status: 'red', open_alerts: 3 })

    const res = await GET(buildRequest({ key: HEALTH_KEY }))
    expect(res.status).toBe(200)
    const body = await res.json<{ entries: Array<Record<string, unknown>> }>()
    const entry = body.entries[0]
    expect(entry.heartbeat_status).toBe('red')
    expect(entry.summary_status).toBe('red')
    expect(entry.open_alerts).toBe(3)
  })

  it('returns multiple entries ordered by slug', async () => {
    const db = (testEnv as unknown as { DB: D1Database }).DB
    await seedEntity(db, ENTITY_A, 'alpha')
    await seedEntity(db, ENTITY_B, 'beta')
    await seedFleetStatus(db, ENTITY_A, 'alpha', { heartbeat_status: 'green' })
    await seedFleetStatus(db, ENTITY_B, 'beta', { heartbeat_status: 'yellow' })

    const res = await GET(buildRequest({ key: HEALTH_KEY }))
    expect(res.status).toBe(200)
    const body = await res.json<{ entries: Array<{ slug: string }> }>()
    expect(body.entries).toHaveLength(2)
    expect(body.entries[0].slug).toBe('alpha')
    expect(body.entries[1].slug).toBe('beta')
  })

  it('omits customers that have no fleet_status row', async () => {
    const db = (testEnv as unknown as { DB: D1Database }).DB
    await seedEntity(db, ENTITY_A, 'alpha')
    // no fleet_status row for alpha — it has no Machine yet

    const res = await GET(buildRequest({ key: HEALTH_KEY }))
    expect(res.status).toBe(200)
    const body = await res.json<{ entries: unknown[] }>()
    expect(body.entries).toHaveLength(0)
  })
})
