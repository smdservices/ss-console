/**
 * Tests for the Operator retainer Stripe subscription client
 * (src/lib/stripe/subscriptions.ts, #1679).
 *
 * The configured path is exercised through the real fetch layer with a
 * stubbed global fetch, asserting the exact Stripe API shapes: send_invoice
 * collection, inline monthly price_data against the shared retainer product,
 * pause via pause_collection[behavior]=void, resume via clearing
 * pause_collection, cancel via DELETE.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  cancelOperatorSubscription,
  createOperatorSubscription,
  getOperatorSubscription,
  pauseOperatorSubscription,
  resumeOperatorSubscription,
} from '../src/lib/stripe/subscriptions'

const KEY = 'sk_test_fake'

interface RecordedCall {
  url: string
  method: string
  body: string
}

/** Stub fetch with per-URL-substring responders; records every call. */
function stubStripe(
  responders: Array<{ match: string; method?: string; json: unknown; status?: number }>
): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? init.body : ''
      calls.push({ url, method, body })
      for (const r of responders) {
        if (url.includes(r.match) && (!r.method || r.method === method)) {
          return new Response(JSON.stringify(r.json), { status: r.status ?? 200 })
        }
      }
      return new Response(JSON.stringify({ error: `unmatched ${method} ${url}` }), { status: 500 })
    })
  )
  return { calls }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createOperatorSubscription', () => {
  it('dev-mode stub when apiKey is undefined (no fetch)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await createOperatorSubscription(undefined, {
      customer_email: 'owner@firm.com',
      monthly_amount_cents: 500000,
      entity_id: 'ent-1',
      subscription_row_id: 'sub-row-1',
    })
    expect(result.id).toMatch(/^dev_sub_/)
    expect(result.status).toBe('active')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves customer + shared product, then creates a send_invoice monthly subscription', async () => {
    const { calls } = stubStripe([
      { match: '/customers/search', json: { data: [{ id: 'cus_1' }] } },
      { match: '/products/search', json: { data: [{ id: 'prod_retainer' }] } },
      { match: '/subscriptions', method: 'POST', json: { id: 'sub_9', status: 'active' } },
    ])

    const result = await createOperatorSubscription(KEY, {
      customer_email: 'owner@firm.com',
      monthly_amount_cents: 500000,
      entity_id: 'ent-1',
      subscription_row_id: 'sub-row-1',
      metadata: { smd_smoke_test: '1' },
    })
    expect(result).toEqual({ id: 'sub_9', status: 'active' })

    const create = calls.find((c) => c.url.endsWith('/subscriptions') && c.method === 'POST')
    expect(create).toBeDefined()
    const body = new URLSearchParams(create!.body)
    expect(body.get('customer')).toBe('cus_1')
    expect(body.get('collection_method')).toBe('send_invoice')
    expect(body.get('days_until_due')).toBe('30')
    expect(body.get('items[0][price_data][unit_amount]')).toBe('500000')
    expect(body.get('items[0][price_data][currency]')).toBe('usd')
    expect(body.get('items[0][price_data][product]')).toBe('prod_retainer')
    expect(body.get('items[0][price_data][recurring][interval]')).toBe('month')
    expect(body.get('metadata[smd_entity_id]')).toBe('ent-1')
    expect(body.get('metadata[smd_subscription_id]')).toBe('sub-row-1')
    expect(body.get('metadata[smd_smoke_test]')).toBe('1')
  })

  it('anchors the first cycle invoice to a future Billing Start Date with no proration', async () => {
    const { calls } = stubStripe([
      { match: '/customers/search', json: { data: [{ id: 'cus_1' }] } },
      { match: '/products/search', json: { data: [{ id: 'prod_retainer' }] } },
      { match: '/subscriptions', method: 'POST', json: { id: 'sub_10', status: 'active' } },
    ])

    await createOperatorSubscription(KEY, {
      customer_email: 'owner@firm.com',
      monthly_amount_cents: 500000,
      entity_id: 'ent-1',
      subscription_row_id: 'sub-row-1',
      billing_cycle_anchor: 1788019200,
    })

    const create = calls.find((c) => c.url.endsWith('/subscriptions') && c.method === 'POST')
    const body = new URLSearchParams(create!.body)
    expect(body.get('billing_cycle_anchor')).toBe('1788019200')
    expect(body.get('proration_behavior')).toBe('none')
    expect(body.get('collection_method')).toBe('send_invoice')
  })

  it('sends no anchor when billing starts now', async () => {
    const { calls } = stubStripe([
      { match: '/customers/search', json: { data: [{ id: 'cus_1' }] } },
      { match: '/products/search', json: { data: [{ id: 'prod_retainer' }] } },
      { match: '/subscriptions', method: 'POST', json: { id: 'sub_11', status: 'active' } },
    ])
    await createOperatorSubscription(KEY, {
      customer_email: 'owner@firm.com',
      monthly_amount_cents: 500000,
      entity_id: 'ent-1',
      subscription_row_id: 'sub-row-1',
    })
    const create = calls.find((c) => c.url.endsWith('/subscriptions') && c.method === 'POST')
    const body = new URLSearchParams(create!.body)
    expect(body.has('billing_cycle_anchor')).toBe(false)
    expect(body.has('proration_behavior')).toBe(false)
  })

  it('creates the shared retainer product on first use', async () => {
    const { calls } = stubStripe([
      { match: '/customers/search', json: { data: [{ id: 'cus_1' }] } },
      { match: '/products/search', json: { data: [] } },
      { match: '/products', method: 'POST', json: { id: 'prod_new' } },
      { match: '/subscriptions', method: 'POST', json: { id: 'sub_9', status: 'active' } },
    ])
    await createOperatorSubscription(KEY, {
      customer_email: 'owner@firm.com',
      monthly_amount_cents: 500000,
      entity_id: 'ent-1',
      subscription_row_id: 'sub-row-1',
    })
    const productCreate = calls.find((c) => c.url.endsWith('/products') && c.method === 'POST')
    expect(productCreate).toBeDefined()
    const body = new URLSearchParams(productCreate!.body)
    expect(body.get('name')).toBe('SMD Operator Retainer')
    expect(body.get('metadata[smd_product]')).toBe('operator-retainer')
    const subCreate = calls.find((c) => c.url.endsWith('/subscriptions') && c.method === 'POST')
    expect(new URLSearchParams(subCreate!.body).get('items[0][price_data][product]')).toBe(
      'prod_new'
    )
  })

  it('throws on a Stripe error (caller decides the redirect)', async () => {
    stubStripe([
      { match: '/customers/search', json: { data: [{ id: 'cus_1' }] } },
      { match: '/products/search', json: { data: [{ id: 'prod_1' }] } },
      { match: '/subscriptions', method: 'POST', json: { error: 'nope' }, status: 402 },
    ])
    await expect(
      createOperatorSubscription(KEY, {
        customer_email: 'owner@firm.com',
        monthly_amount_cents: 500000,
        entity_id: 'ent-1',
        subscription_row_id: 'sub-row-1',
      })
    ).rejects.toThrow(/402/)
  })
})

describe('pause / resume / cancel', () => {
  it('pauses with pause_collection[behavior]=void', async () => {
    const { calls } = stubStripe([
      { match: '/subscriptions/sub_9', method: 'POST', json: { id: 'sub_9', status: 'active' } },
    ])
    await pauseOperatorSubscription(KEY, 'sub_9')
    expect(new URLSearchParams(calls[0].body).get('pause_collection[behavior]')).toBe('void')
  })

  it('resumes by clearing pause_collection (send_invoice cannot use /resume)', async () => {
    const { calls } = stubStripe([
      { match: '/subscriptions/sub_9', method: 'POST', json: { id: 'sub_9', status: 'active' } },
    ])
    await resumeOperatorSubscription(KEY, 'sub_9')
    expect(calls[0].url.endsWith('/subscriptions/sub_9')).toBe(true)
    expect(new URLSearchParams(calls[0].body).get('pause_collection')).toBe('')
  })

  it('cancels via DELETE', async () => {
    const { calls } = stubStripe([
      {
        match: '/subscriptions/sub_9',
        method: 'DELETE',
        json: { id: 'sub_9', status: 'canceled' },
      },
    ])
    const result = await cancelOperatorSubscription(KEY, 'sub_9')
    expect(result.status).toBe('canceled')
    expect(calls[0].method).toBe('DELETE')
  })

  it('getOperatorSubscription reports pause posture from pause_collection presence', async () => {
    stubStripe([
      {
        match: '/subscriptions/sub_9',
        json: { id: 'sub_9', status: 'active', pause_collection: { behavior: 'void' } },
      },
    ])
    const state = await getOperatorSubscription(KEY, 'sub_9')
    expect(state.paused).toBe(true)
  })
})
