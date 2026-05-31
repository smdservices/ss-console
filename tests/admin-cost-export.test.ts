/**
 * Tests for GET /api/admin/ai-employee/costs/export — auth and input
 * validation. The CSV serialization is covered by the cost-query unit
 * tests; this file focuses on the handler-level guarantees:
 *
 *   - Unauthorized (no session / non-admin role) → 401
 *   - Missing customer_slug param → 400
 *   - Bad date format → 400
 *   - start >= end → 400
 *   - Unknown customer → 404
 *   - Customer without per-customer D1 → 409
 *   - Worker env missing CF tokens → 503
 *
 * Architecture note: the same `buildContext` shape used by other admin
 * cross-org tests applies here. The handler imports `env` from the
 * vitest-aliased `cloudflare:workers` stub; we populate it with a
 * minimal D1 mock that satisfies the customer enumeration query.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GET } from '../src/pages/api/admin/ai-employee/costs/export'
import { env as testEnv } from 'cloudflare:workers'

interface MinimalSession {
  userId: string
  orgId: string
  role: string
  email: string
  expiresAt: string
}

function buildContext(opts: { session: MinimalSession | null; url: string }) {
  const request = new Request(opts.url, { method: 'GET' })
  return {
    request,
    params: {},
    locals: { session: opts.session },
  } as unknown as Parameters<typeof GET>[0]
}

function adminSession(): MinimalSession {
  return {
    userId: 'admin-1',
    orgId: 'org-1',
    role: 'admin',
    email: 'captain@smd.services',
    expiresAt: '2099-12-31T00:00:00Z',
  }
}

interface FakeD1Result<T> {
  results: T[]
}

function makeMockDb(
  configs: Array<{ customer_slug: string; entity_id: string; connectors_json: string | null }>,
  subs: Array<{ entity_id: string; status: string; settings_json: string | null }> = [],
  entities: Array<{ id: string; name: string }> = []
): unknown {
  return {
    prepare(sql: string) {
      let boundParams: unknown[] = []
      const result = {
        bind(...args: unknown[]) {
          boundParams = args
          return result
        },
        async all<T>(): Promise<FakeD1Result<T>> {
          if (sql.includes('FROM customer_configs')) {
            return { results: configs as unknown as T[] }
          }
          if (sql.includes('FROM subscriptions')) {
            const filtered = subs.filter((s) => boundParams.some((p) => p === s.entity_id))
            return { results: filtered as unknown as T[] }
          }
          if (sql.includes('FROM entities')) {
            const filtered = entities.filter((e) => boundParams.some((p) => p === e.id))
            return { results: filtered as unknown as T[] }
          }
          return { results: [] }
        },
      }
      return result
    },
  }
}

describe('GET /api/admin/ai-employee/costs/export', () => {
  beforeEach(() => {
    for (const k of Object.keys(testEnv)) delete (testEnv as unknown as Record<string, unknown>)[k]
    Object.assign(testEnv, {
      DB: makeMockDb([]),
      CF_ACCOUNT_ID: 'acct',
      CF_D1_API_TOKEN: 'tok',
    })
  })

  afterEach(() => {
    for (const k of Object.keys(testEnv)) delete (testEnv as unknown as Record<string, unknown>)[k]
  })

  it('returns 401 when no session', async () => {
    const ctx = buildContext({
      session: null,
      url: 'http://test.local/api/admin/ai-employee/costs/export?customer_slug=acme',
    })
    const res = await GET(ctx)
    expect(res.status).toBe(401)
  })

  it('returns 401 when session.role !== admin', async () => {
    const ctx = buildContext({
      session: { ...adminSession(), role: 'client' },
      url: 'http://test.local/api/admin/ai-employee/costs/export?customer_slug=acme',
    })
    const res = await GET(ctx)
    expect(res.status).toBe(401)
  })

  it('returns 400 when customer_slug missing', async () => {
    const ctx = buildContext({
      session: adminSession(),
      url: 'http://test.local/api/admin/ai-employee/costs/export',
    })
    const res = await GET(ctx)
    expect(res.status).toBe(400)
  })

  it('returns 400 on bad date format', async () => {
    const ctx = buildContext({
      session: adminSession(),
      url: 'http://test.local/api/admin/ai-employee/costs/export?customer_slug=acme&start=bad&end=2026-05-01',
    })
    const res = await GET(ctx)
    expect(res.status).toBe(400)
  })

  it('returns 400 when start >= end', async () => {
    const ctx = buildContext({
      session: adminSession(),
      url: 'http://test.local/api/admin/ai-employee/costs/export?customer_slug=acme&start=2026-05-10&end=2026-05-01',
    })
    const res = await GET(ctx)
    expect(res.status).toBe(400)
  })

  it('returns 404 when customer not found', async () => {
    Object.assign(testEnv, { DB: makeMockDb([]) })
    const ctx = buildContext({
      session: adminSession(),
      url: 'http://test.local/api/admin/ai-employee/costs/export?customer_slug=acme',
    })
    const res = await GET(ctx)
    expect(res.status).toBe(404)
  })

  it('returns 409 when customer has no per-customer D1', async () => {
    Object.assign(testEnv, {
      DB: makeMockDb(
        [{ customer_slug: 'acme', entity_id: 'ent-1', connectors_json: null }],
        [],
        [{ id: 'ent-1', name: 'Acme Co' }]
      ),
    })
    const ctx = buildContext({
      session: adminSession(),
      url: 'http://test.local/api/admin/ai-employee/costs/export?customer_slug=acme',
    })
    const res = await GET(ctx)
    expect(res.status).toBe(409)
  })

  it('returns 503 when CF env not configured', async () => {
    Object.assign(testEnv, {
      DB: makeMockDb(
        [
          {
            customer_slug: 'acme',
            entity_id: 'ent-1',
            connectors_json: JSON.stringify({ per_customer_d1_database_id: 'db-id-1' }),
          },
        ],
        [],
        [{ id: 'ent-1', name: 'Acme Co' }]
      ),
    })
    delete (testEnv as unknown as Record<string, unknown>).CF_ACCOUNT_ID
    delete (testEnv as unknown as Record<string, unknown>).CF_D1_API_TOKEN
    const ctx = buildContext({
      session: adminSession(),
      url: 'http://test.local/api/admin/ai-employee/costs/export?customer_slug=acme',
    })
    const res = await GET(ctx)
    expect(res.status).toBe(503)
  })

  it('returns CSV with proper headers on happy path', async () => {
    Object.assign(testEnv, {
      DB: makeMockDb(
        [
          {
            customer_slug: 'acme',
            entity_id: 'ent-1',
            connectors_json: JSON.stringify({ per_customer_d1_database_id: 'db-id-1' }),
          },
        ],
        [],
        [{ id: 'ent-1', name: 'Acme Co' }]
      ),
      CF_ACCOUNT_ID: 'acct',
      CF_D1_API_TOKEN: 'tok',
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: [
            {
              results: [
                {
                  date: '2026-05-01',
                  driver: 'fly_machine_minutes',
                  amount_cents: 30,
                  units: 30,
                  unit_type: 'minutes',
                },
              ],
            },
          ],
        }),
        { status: 200 }
      )

    try {
      const ctx = buildContext({
        session: adminSession(),
        url: 'http://test.local/api/admin/ai-employee/costs/export?customer_slug=acme&start=2026-05-01&end=2026-05-15',
      })
      const res = await GET(ctx)
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('text/csv')
      expect(res.headers.get('Content-Disposition')).toContain('attachment')
      expect(res.headers.get('Content-Disposition')).toContain('acme')
      const text = await res.text()
      expect(text).toContain('customer_slug,date,driver,amount_cents,units,unit_type')
      expect(text).toContain('acme,2026-05-01,fly_machine_minutes,30,30,minutes')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
