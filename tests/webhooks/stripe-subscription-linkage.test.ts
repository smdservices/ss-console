/**
 * Stripe invoice → subscription linkage (ss#2315, #2280 hardening item 10).
 *
 * The linkage between a cycle invoice and its subscription decides which of
 * two handlers runs, and it has moved between Stripe API versions. Reading it
 * as `string | null` overloads `null`: "this is a one-time console-originated
 * invoice" and "this is a retainer invoice whose linkage this code cannot
 * read" become the same value, and the second is answered with a 200 ack and
 * no mirror — a money-adjacent row that quietly never appears.
 *
 * These tests pin the three outcomes apart, and pin the expanded-object shape
 * (Stripe's expandable fields) as parseable rather than unknown.
 *
 * The route is driven end-to-end, through signature verification, because the
 * ack is the defect: the observable is the RESPONSE, and a handler-level test
 * would not see it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installWorkerdPolyfills } from '@venturecrane/crane-test-harness'
import { env as testEnv } from 'cloudflare:workers'
import { POST } from '../../src/pages/api/webhooks/stripe'
import {
  extractStripeSubscriptionId,
  resolveStripeSubscriptionLinkage,
} from '../../src/lib/webhooks/stripe-subscription-handler'

installWorkerdPolyfills()

const SECRET = 'whsec_test_stripe_webhook_secret'

async function computeStripeV1(timestamp: number, body: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${body}`))
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** A schema-valid `invoice.finalized` event; `invoiceExtra` carries the shape under test. */
function invoiceEvent(invoiceExtra: Record<string, unknown>): string {
  return JSON.stringify({
    id: 'evt_linkage',
    object: 'event',
    type: 'invoice.finalized',
    created: 1785000000,
    data: {
      object: {
        id: 'in_linkage_1',
        object: 'invoice',
        status: 'open',
        amount_due: 500000,
        amount_paid: 0,
        currency: 'usd',
        customer: 'cus_1',
        customer_email: null,
        description: null,
        hosted_invoice_url: null,
        invoice_pdf: null,
        collection_method: 'charge_automatically',
        status_transitions: { paid_at: null, finalized_at: 1785000000, voided_at: null },
        metadata: {},
        created: 1785000000,
        due_date: null,
        ...invoiceExtra,
      },
    },
  })
}

async function postEvent(body: string): Promise<Response> {
  const ts = Math.floor(Date.now() / 1000)
  const sig = await computeStripeV1(ts, body, SECRET)
  const request = new Request('http://test.local/api/webhooks/stripe', {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/json',
      'stripe-signature': `t=${ts},v1=${sig}`,
    }),
    body,
  })
  const context = {
    request,
    params: {},
    locals: {},
    redirect: (url: string, status: number) =>
      new Response(null, { status, headers: { Location: url } }),
  } as unknown as Parameters<typeof POST>[0]
  return POST(context)
}

// ---------------------------------------------------------------------------
// Tri-state resolution
// ---------------------------------------------------------------------------

describe('resolveStripeSubscriptionLinkage', () => {
  it('reads the legacy top-level string', () => {
    expect(resolveStripeSubscriptionLinkage({ subscription: 'sub_a' })).toEqual({
      kind: 'linked',
      subscriptionId: 'sub_a',
    })
  })

  it('reads the parent.subscription_details string', () => {
    expect(
      resolveStripeSubscriptionLinkage({
        parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_b' } },
      })
    ).toEqual({ kind: 'linked', subscriptionId: 'sub_b' })
  })

  it('reads an EXPANDED subscription object at either position', () => {
    expect(
      resolveStripeSubscriptionLinkage({
        subscription: { id: 'sub_c', object: 'subscription' },
      })
    ).toEqual({ kind: 'linked', subscriptionId: 'sub_c' })

    expect(
      resolveStripeSubscriptionLinkage({
        parent: { subscription_details: { subscription: { id: 'sub_d', object: 'subscription' } } },
      })
    ).toEqual({ kind: 'linked', subscriptionId: 'sub_d' })
  })

  it('reports a genuine one-time invoice as unlinked, not unrecognized', () => {
    expect(resolveStripeSubscriptionLinkage({ billing_reason: 'manual' }).kind).toBe('unlinked')
    expect(resolveStripeSubscriptionLinkage({ subscription: null }).kind).toBe('unlinked')
    expect(
      resolveStripeSubscriptionLinkage({ parent: { type: null, subscription_details: null } }).kind
    ).toBe('unlinked')
    expect(resolveStripeSubscriptionLinkage({}).kind).toBe('unlinked')
    expect(resolveStripeSubscriptionLinkage(null).kind).toBe('unlinked')
  })

  it('reports a subscription-signalling invoice it cannot read as unrecognized', () => {
    // billing_reason is the version-stable signal: whatever Stripe does to the
    // linkage field next, a cycle invoice still says why it was billed.
    expect(resolveStripeSubscriptionLinkage({ billing_reason: 'subscription_cycle' }).kind).toBe(
      'unrecognized'
    )
    // A linkage field that is present but shaped in a way this code cannot read.
    expect(resolveStripeSubscriptionLinkage({ subscription: { ref: 'sub_z' } }).kind).toBe(
      'unrecognized'
    )
    expect(
      resolveStripeSubscriptionLinkage({
        parent: { type: 'subscription_details', subscription_details: { sub_id: 'sub_z' } },
      }).kind
    ).toBe('unrecognized')
  })
})

describe('extractStripeSubscriptionId', () => {
  it('parses the expanded-object shape (previously read as no linkage at all)', () => {
    expect(
      extractStripeSubscriptionId({ subscription: { id: 'sub_e', object: 'subscription' } })
    ).toBe('sub_e')
  })
})

// ---------------------------------------------------------------------------
// The ack is the defect
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/stripe — unreadable subscription linkage', () => {
  beforeEach(() => {
    Object.assign(testEnv, { STRIPE_WEBHOOK_SECRET: SECRET })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const k of Object.keys(testEnv)) {
      delete (testEnv as unknown as Record<string, unknown>)[k]
    }
    vi.restoreAllMocks()
  })

  it('fails the delivery instead of acking when the shape is unreadable', async () => {
    const res = await postEvent(
      invoiceEvent({ billing_reason: 'subscription_cycle', parent: { type: 'something_new' } })
    )

    expect(res.status).toBe(500)
    expect(console.error).toHaveBeenCalled()
  })

  it('still acks a genuine one-time invoice without alerting', async () => {
    // The falsifier for the detector itself: if this over-fires, the legacy
    // console-originated flow starts 500ing and Stripe retry-loops it.
    const res = await postEvent(invoiceEvent({ billing_reason: 'manual' }))

    expect(res.status).toBe(200)
    expect(console.error).not.toHaveBeenCalled()
  })
})
