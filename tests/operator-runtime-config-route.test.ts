/**
 * Tests for GET /api/internal/operator/:slug/runtime-config — the scoped read
 * route the operator drift audit (Phase B Cut D-act) calls. This is a
 * credentialed endpoint; the security-critical guarantees are:
 *
 *   - token unset            → 503 (fail-closed, never open)
 *   - no / malformed bearer  → 401
 *   - wrong token            → 401
 *   - unknown slug           → 404 (no enumeration)
 *   - read path unconfigured → 503 (master/url absent)
 *
 * The happy-path snapshot fetch goes through the live transport (network) and is
 * exercised end-to-end against staging in the PR; here we pin the auth + allow-
 * list gates that must hold before any Machine is ever contacted.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { GET } from '../src/pages/api/internal/operator/[slug]/runtime-config'
import { env as testEnv } from 'cloudflare:workers'

const TOKEN = 'test-drift-audit-token-1234567890'

function ctx(opts: { slug: string; authorization?: string }) {
  const headers: Record<string, string> = {}
  if (opts.authorization) headers.Authorization = opts.authorization
  const request = new Request(
    `https://admin.smd.services/api/internal/operator/${opts.slug}/runtime-config`,
    {
      method: 'GET',
      headers,
    }
  )
  return { request, params: { slug: opts.slug }, locals: {} } as unknown as Parameters<
    typeof GET
  >[0]
}

afterEach(() => {
  delete (testEnv as unknown as Record<string, unknown>).OPERATOR_DRIFT_AUDIT_TOKEN
  delete (testEnv as unknown as Record<string, unknown>).OPERATOR_RUNTIME_READ_URL
  delete (testEnv as unknown as Record<string, unknown>).OPERATOR_RUNTIME_READ_SECRET
})

describe('GET /api/internal/operator/:slug/runtime-config', () => {
  it('503 when the scoped token is unset (fail-closed)', async () => {
    const res = await GET(ctx({ slug: 'smd', authorization: `Bearer ${TOKEN}` }))
    expect(res.status).toBe(503)
  })

  it('401 with no bearer', async () => {
    ;(testEnv as unknown as Record<string, unknown>).OPERATOR_DRIFT_AUDIT_TOKEN = TOKEN
    const res = await GET(ctx({ slug: 'smd' }))
    expect(res.status).toBe(401)
  })

  it('401 with the wrong token', async () => {
    ;(testEnv as unknown as Record<string, unknown>).OPERATOR_DRIFT_AUDIT_TOKEN = TOKEN
    const res = await GET(ctx({ slug: 'smd', authorization: 'Bearer nope' }))
    expect(res.status).toBe(401)
  })

  it('404 for an unknown slug (no enumeration), even with a valid token', async () => {
    ;(testEnv as unknown as Record<string, unknown>).OPERATOR_DRIFT_AUDIT_TOKEN = TOKEN
    const res = await GET(
      ctx({ slug: 'definitely-not-a-customer', authorization: `Bearer ${TOKEN}` })
    )
    expect(res.status).toBe(404)
  })

  it('503 when authed + known slug but the read path is unconfigured', async () => {
    ;(testEnv as unknown as Record<string, unknown>).OPERATOR_DRIFT_AUDIT_TOKEN = TOKEN
    // OPERATOR_RUNTIME_READ_URL / _SECRET intentionally unset.
    const res = await GET(ctx({ slug: 'smd', authorization: `Bearer ${TOKEN}` }))
    expect(res.status).toBe(503)
  })

  it('no-store on every response (a snapshot never lands in a shared cache)', async () => {
    const res = await GET(ctx({ slug: 'smd', authorization: `Bearer ${TOKEN}` }))
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
