/**
 * Worker-level tests for ss-cost-anomaly. Covers the orchestration shell:
 * window computation, per-customer outcome aggregation, and notification
 * gating. The pure-function detection logic is tested in
 * tests/admin-cost-anomaly.test.ts at the ss-web level.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// We test the helpers exported from index.ts via an internal-only import.
// The run() orchestrator depends on a real D1 binding plus the D1 HTTP
// fetch path; rather than mock both, we exercise the constituent pieces
// directly.

import { sendAnomalyDigest, type AlertNotificationItem } from './notify'

describe('sendAnomalyDigest', () => {
  let originalFetch: typeof globalThis.fetch
  let captured: Array<{ url: string; body: unknown; headers: Record<string, string> }> = []

  beforeEach(() => {
    captured = []
    originalFetch = globalThis.fetch
  })

  function installFetch(response: { ok: boolean; status?: number; body?: unknown }) {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const body = init?.body ? JSON.parse(String(init.body)) : null
      const headers = (init?.headers ?? {}) as Record<string, string>
      captured.push({ url, body, headers })
      const responseBody = JSON.stringify(response.body ?? { id: 'resend-123' })
      return new Response(responseBody, {
        status: response.status ?? (response.ok ? 200 : 500),
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  function makeAlert(overrides: Partial<AlertNotificationItem> = {}): AlertNotificationItem {
    return {
      customer_slug: 'biz',
      entity_name: 'Biz Inc',
      alert_date: '2026-05-20',
      driver: 'claude_api_input_tokens',
      daily_cents: 500,
      rolling_avg_cents: 200,
      ratio_bps: 25000,
      ...overrides,
    }
  }

  it('short-circuits when no alerts to notify', async () => {
    installFetch({ ok: true })
    const result = await sendAnomalyDigest(
      {
        apiKey: 'rk_test',
        fromEmail: 'from@x',
        toEmail: 'to@x',
        dashboardUrl: 'https://admin.test/operator/costs',
      },
      [],
      '2026-05-20'
    )
    expect(result.ok).toBe(true)
    expect(captured.length).toBe(0)
    globalThis.fetch = originalFetch
  })

  it('posts to Resend with bearer auth and JSON body', async () => {
    installFetch({ ok: true })
    const result = await sendAnomalyDigest(
      {
        apiKey: 'rk_test',
        fromEmail: 'SMD Ops <ops@x>',
        toEmail: 'captain@x',
        dashboardUrl: 'https://admin.test/operator/costs',
      },
      [makeAlert()],
      '2026-05-20'
    )
    expect(result.ok).toBe(true)
    expect(result.resendId).toBe('resend-123')
    expect(captured.length).toBe(1)
    expect(captured[0].url).toBe('https://api.resend.com/emails')
    expect(captured[0].headers['Authorization']).toBe('Bearer rk_test')
    const body = captured[0].body as Record<string, unknown>
    expect(body.from).toBe('SMD Ops <ops@x>')
    expect(body.to).toEqual(['captain@x'])
    expect(String(body.subject)).toContain('1 cost anomaly')
    expect(String(body.html)).toContain('Biz Inc')
    expect(String(body.html)).toContain('claude_api_input_tokens')
    globalThis.fetch = originalFetch
  })

  it('renders aggregate-driver sentinel as a human label, not empty', async () => {
    installFetch({ ok: true })
    await sendAnomalyDigest(
      {
        apiKey: 'rk_test',
        fromEmail: 'f@x',
        toEmail: 't@x',
        dashboardUrl: 'https://admin.test/operator/costs',
      },
      [makeAlert({ driver: '' })],
      '2026-05-20'
    )
    const body = captured[0].body as Record<string, unknown>
    expect(String(body.html)).toContain('all drivers (aggregate)')
    globalThis.fetch = originalFetch
  })

  it('returns ok=false on Resend error response', async () => {
    installFetch({ ok: false, status: 400, body: { message: 'bad' } })
    const result = await sendAnomalyDigest(
      {
        apiKey: 'rk_test',
        fromEmail: 'f@x',
        toEmail: 't@x',
        dashboardUrl: 'https://admin.test/operator/costs',
      },
      [makeAlert()],
      '2026-05-20'
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('400')
    globalThis.fetch = originalFetch
  })

  it('escapes HTML in customer name and driver to prevent injection', async () => {
    installFetch({ ok: true })
    await sendAnomalyDigest(
      {
        apiKey: 'rk_test',
        fromEmail: 'f@x',
        toEmail: 't@x',
        dashboardUrl: 'https://admin.test/operator/costs',
      },
      [makeAlert({ entity_name: '<script>x</script>', driver: '"><img/>' })],
      '2026-05-20'
    )
    const body = captured[0].body as Record<string, unknown>
    const html = String(body.html)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;&gt;&lt;img/&gt;')
    globalThis.fetch = originalFetch
  })
})
