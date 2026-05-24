/**
 * Tests for POST /api/admin/ai-employee/costs/anomalies/{snooze,acknowledge}.
 *
 * Auth and input validation in isolation. The DB write itself is exercised
 * by admin-cost-anomaly.test.ts against a real D1; here we focus on the
 * handler-level guarantees so a refactor of cost-anomaly.ts's storage
 * functions does not silently regress the endpoint contract.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
  installWorkerdPolyfills,
} from '@venturecrane/crane-test-harness'
import path from 'node:path'
import { POST } from '../src/pages/api/admin/ai-employee/costs/anomalies/[action]'
import { env as testEnv } from 'cloudflare:workers'
import { listOpenAlerts, upsertAlert } from '../src/lib/admin/cost-anomaly'

installWorkerdPolyfills()

const migrationsDir = path.resolve(__dirname, '../migrations')

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
    orgId: 'org-1',
    role: 'admin',
    email: 'captain@example.com',
    expiresAt: '2099-12-31T00:00:00Z',
  }
}

function buildCtx(opts: {
  session: MinimalSession | null
  action: string
  body: unknown
}): Parameters<typeof POST>[0] {
  const request = new Request(
    `http://test.local/api/admin/ai-employee/costs/anomalies/${opts.action}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    }
  )
  return {
    request,
    params: { action: opts.action },
    locals: { session: opts.session },
  } as unknown as Parameters<typeof POST>[0]
}

const ORG_ID = 'org-1'
const ENTITY_ID = 'ent-anom'
const USER_ID = 'usr-captain'

describe('POST /api/admin/ai-employee/costs/anomalies/[action]', () => {
  beforeAll(() => {
    const files = discoverNumericMigrations(migrationsDir)
    expect(files.length).toBeGreaterThan(0)
  })

  beforeEach(async () => {
    const db = createTestD1()
    const files = discoverNumericMigrations(migrationsDir)
    await runMigrations(db, { files })

    await db
      .prepare(
        `INSERT INTO organizations (id, name, slug, created_at, updated_at)
         VALUES (?, 'Test Org', 'test-org', datetime('now'), datetime('now'))`
      )
      .bind(ORG_ID)
      .run()
    await db
      .prepare(
        `INSERT INTO entities (id, org_id, name, slug, stage, stage_changed_at, created_at, updated_at)
         VALUES (?, ?, 'Biz', 'biz', 'ongoing', datetime('now'), datetime('now'), datetime('now'))`
      )
      .bind(ENTITY_ID, ORG_ID)
      .run()
    await db
      .prepare(
        `INSERT INTO users (id, org_id, email, name, role, created_at)
         VALUES (?, ?, 'captain@example.com', 'Captain', 'admin', datetime('now'))`
      )
      .bind(USER_ID, ORG_ID)
      .run()

    await upsertAlert(db, {
      entity_id: ENTITY_ID,
      customer_slug: 'biz',
      alert_date: '2026-05-20',
      driver: 'd1',
      daily_cents: 500,
      rolling_avg_cents: 200,
      ratio_bps: 25000,
      threshold_bps: 15000,
    })

    for (const k of Object.keys(testEnv)) delete (testEnv as unknown as Record<string, unknown>)[k]
    Object.assign(testEnv, { DB: db })
  })

  it('returns 401 when no session', async () => {
    const res = await POST(
      buildCtx({
        session: null,
        action: 'snooze',
        body: { entity_id: ENTITY_ID, alert_date: '2026-05-20', driver: 'd1' },
      })
    )
    expect(res.status).toBe(401)
  })

  it('returns 401 when role !== admin', async () => {
    const res = await POST(
      buildCtx({
        session: { ...adminSession(), role: 'client' },
        action: 'snooze',
        body: { entity_id: ENTITY_ID, alert_date: '2026-05-20', driver: 'd1' },
      })
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 on unknown action', async () => {
    const res = await POST(
      buildCtx({
        session: adminSession(),
        action: 'delete',
        body: { entity_id: ENTITY_ID, alert_date: '2026-05-20', driver: 'd1' },
      })
    )
    expect(res.status).toBe(404)
  })

  it('returns 400 on invalid JSON body', async () => {
    const res = await POST(
      buildCtx({
        session: adminSession(),
        action: 'snooze',
        body: 'not-json{',
      })
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when entity_id missing', async () => {
    const res = await POST(
      buildCtx({
        session: adminSession(),
        action: 'snooze',
        body: { alert_date: '2026-05-20', driver: 'd1' },
      })
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 on bad alert_date format', async () => {
    const res = await POST(
      buildCtx({
        session: adminSession(),
        action: 'acknowledge',
        body: { entity_id: ENTITY_ID, alert_date: 'yesterday', driver: 'd1' },
      })
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 on bad snoozed_until format', async () => {
    const res = await POST(
      buildCtx({
        session: adminSession(),
        action: 'snooze',
        body: {
          entity_id: ENTITY_ID,
          alert_date: '2026-05-20',
          driver: 'd1',
          snoozed_until: 'tomorrow',
        },
      })
    )
    expect(res.status).toBe(400)
  })

  it('snooze with valid ISO timestamp hides the alert', async () => {
    const res = await POST(
      buildCtx({
        session: adminSession(),
        action: 'snooze',
        body: {
          entity_id: ENTITY_ID,
          alert_date: '2026-05-20',
          driver: 'd1',
          snoozed_until: '2099-01-01T00:00:00Z',
        },
      })
    )
    expect(res.status).toBe(200)
    const open = await listOpenAlerts(testEnv.DB)
    expect(open.length).toBe(0)
  })

  it('snooze with null clears the snooze', async () => {
    await POST(
      buildCtx({
        session: adminSession(),
        action: 'snooze',
        body: {
          entity_id: ENTITY_ID,
          alert_date: '2026-05-20',
          driver: 'd1',
          snoozed_until: '2099-01-01T00:00:00Z',
        },
      })
    )
    const res = await POST(
      buildCtx({
        session: adminSession(),
        action: 'snooze',
        body: { entity_id: ENTITY_ID, alert_date: '2026-05-20', driver: 'd1', snoozed_until: null },
      })
    )
    expect(res.status).toBe(200)
    const open = await listOpenAlerts(testEnv.DB)
    expect(open.length).toBe(1)
  })

  it('acknowledge records the user and hides the alert', async () => {
    const res = await POST(
      buildCtx({
        session: adminSession(),
        action: 'acknowledge',
        body: { entity_id: ENTITY_ID, alert_date: '2026-05-20', driver: 'd1' },
      })
    )
    expect(res.status).toBe(200)
    const open = await listOpenAlerts(testEnv.DB)
    expect(open.length).toBe(0)

    const result = await testEnv.DB.prepare(
      `SELECT acknowledged_by FROM cost_anomaly_alerts WHERE entity_id = ?`
    )
      .bind(ENTITY_ID)
      .first<{ acknowledged_by: string }>()
    expect(result?.acknowledged_by).toBe(USER_ID)
  })

  it('accepts the aggregate-driver sentinel (empty string)', async () => {
    // Seed an aggregate-level alert
    await upsertAlert(testEnv.DB, {
      entity_id: ENTITY_ID,
      customer_slug: 'biz',
      alert_date: '2026-05-21',
      driver: '',
      daily_cents: 1000,
      rolling_avg_cents: 200,
      ratio_bps: 50000,
      threshold_bps: 15000,
    })
    const res = await POST(
      buildCtx({
        session: adminSession(),
        action: 'acknowledge',
        body: { entity_id: ENTITY_ID, alert_date: '2026-05-21', driver: '' },
      })
    )
    expect(res.status).toBe(200)
  })
})
