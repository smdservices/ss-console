/**
 * Tests for the Operator retainer webhook handling
 * (src/lib/webhooks/stripe-subscription-handler.ts, #1679).
 *
 * Covers: subscription-id extraction across both Stripe API shapes, the
 * finalized/paid cycle-invoice mirror (insert, refresh, idempotency), the
 * payment-failure posture (overdue + alert, never a Machine action), and the
 * customer.subscription.* status mirror onto the local row.
 */

import { describe, it, expect } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import {
  extractStripeSubscriptionId,
  handleRetainerInvoiceFinalized,
  handleRetainerInvoicePaid,
  handleRetainerInvoicePaymentFailed,
  handleSubscriptionLifecycle,
  type RetainerInvoicePayload,
} from '../src/lib/webhooks/stripe-subscription-handler'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeDbState {
  /** subscriptions row served by SELECT ... WHERE stripe_subscription_id = ? */
  subRow?: {
    id: string
    org_id: string
    entity_id: string
    product_slug: string
    status: string
    stripe_subscription_id: string | null
    settings_json?: string | null
  } | null
  /** invoices row served by SELECT ... WHERE stripe_invoice_id = ? */
  invoiceRow?: { id: string; org_id: string; status: string } | null
}

interface Recorded {
  sql: string
  args: unknown[]
}

function makeDb(state: FakeDbState): { db: D1Database; writes: Recorded[] } {
  const writes: Recorded[] = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first() {
              if (sql.includes('FROM subscriptions')) return Promise.resolve(state.subRow ?? null)
              if (sql.includes('FROM invoices')) return Promise.resolve(state.invoiceRow ?? null)
              if (sql.includes('FROM contacts')) return Promise.resolve(null)
              if (sql.includes('FROM entities')) return Promise.resolve({ name: 'Test Firm' })
              throw new Error(`unexpected first(): ${sql}`)
            },
            run() {
              writes.push({ sql, args })
              return Promise.resolve({})
            },
          }
        },
      }
    },
  }
  return { db: db as unknown as D1Database, writes }
}

const SUB_ROW = {
  id: 'local-sub-1',
  org_id: 'org-1',
  entity_id: 'ent-1',
  product_slug: 'operator',
  status: 'active',
  stripe_subscription_id: 'sub_stripe_1',
  settings_json: null,
}

function invoicePayload(overrides?: Partial<RetainerInvoicePayload>): RetainerInvoicePayload {
  return {
    id: 'in_cycle_1',
    amount_due: 500000,
    amount_paid: 0,
    hosted_invoice_url: 'https://invoice.stripe.com/i/x',
    due_date: 1785000000,
    status_transitions: { paid_at: null },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// extractStripeSubscriptionId — both API shapes
// ---------------------------------------------------------------------------

describe('extractStripeSubscriptionId', () => {
  it('reads the legacy top-level subscription field', () => {
    expect(extractStripeSubscriptionId({ subscription: 'sub_a' })).toBe('sub_a')
  })

  it('reads the current parent.subscription_details.subscription shape', () => {
    expect(
      extractStripeSubscriptionId({
        parent: { subscription_details: { subscription: 'sub_b' } },
      })
    ).toBe('sub_b')
  })

  it('returns null for one-time invoices and junk', () => {
    expect(extractStripeSubscriptionId({})).toBeNull()
    expect(extractStripeSubscriptionId({ subscription: null })).toBeNull()
    expect(extractStripeSubscriptionId({ subscription: '' })).toBeNull()
    expect(extractStripeSubscriptionId({ parent: null })).toBeNull()
    expect(extractStripeSubscriptionId(null)).toBeNull()
    expect(extractStripeSubscriptionId('sub_x')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Cycle-invoice mirror
// ---------------------------------------------------------------------------

describe('handleRetainerInvoiceFinalized', () => {
  it('inserts a local retainer row (status sent) for a known subscription', async () => {
    const { db, writes } = makeDb({ subRow: SUB_ROW, invoiceRow: null })
    const res = await handleRetainerInvoiceFinalized(db, 'sub_stripe_1', invoicePayload())
    expect(res.status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(writes[0].sql).toContain('INSERT INTO invoices')
    expect(writes[0].sql).toContain("'retainer'")
    expect(writes[0].sql).toContain("'sent'")
    // amount converted from cents; entity/org from the subscription row
    expect(writes[0].args).toContain(5000)
    expect(writes[0].args).toContain('ent-1')
    expect(writes[0].args).toContain('org-1')
  })

  it('refreshes an existing mirror row instead of duplicating', async () => {
    const { db, writes } = makeDb({
      subRow: SUB_ROW,
      invoiceRow: { id: 'local-inv-1', org_id: 'org-1', status: 'sent' },
    })
    await handleRetainerInvoiceFinalized(db, 'sub_stripe_1', invoicePayload())
    expect(writes).toHaveLength(1)
    expect(writes[0].sql).toContain('UPDATE invoices')
  })

  it('skips honestly when no local subscription matches (e.g. a smoke test)', async () => {
    const { db, writes } = makeDb({ subRow: null })
    const res = await handleRetainerInvoiceFinalized(db, 'sub_unknown', invoicePayload())
    expect(res.status).toBe(200)
    expect(writes).toHaveLength(0)
  })
})

describe('handleRetainerInvoicePaid', () => {
  it('upserts a paid retainer row when no mirror exists (paid arrived first)', async () => {
    const { db, writes } = makeDb({ subRow: SUB_ROW, invoiceRow: null })
    const res = await handleRetainerInvoicePaid(
      db,
      undefined,
      'sub_stripe_1',
      invoicePayload({ amount_paid: 500000, status_transitions: { paid_at: 1785100000 } })
    )
    expect(res.status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(writes[0].sql).toContain('INSERT INTO invoices')
    expect(writes[0].sql).toContain("'paid'")
  })

  it('marks an existing mirror row paid', async () => {
    const { db, writes } = makeDb({
      subRow: SUB_ROW,
      invoiceRow: { id: 'local-inv-1', org_id: 'org-1', status: 'sent' },
    })
    await handleRetainerInvoicePaid(
      db,
      undefined,
      'sub_stripe_1',
      invoicePayload({ amount_paid: 500000, status_transitions: { paid_at: 1785100000 } })
    )
    expect(writes).toHaveLength(1)
    expect(writes[0].sql).toContain("SET status = 'paid'")
  })

  it('is idempotent: an already-paid mirror row is not rewritten', async () => {
    const { db, writes } = makeDb({
      subRow: SUB_ROW,
      invoiceRow: { id: 'local-inv-1', org_id: 'org-1', status: 'paid' },
    })
    const res = await handleRetainerInvoicePaid(db, undefined, 'sub_stripe_1', invoicePayload())
    expect(res.status).toBe(200)
    expect(writes).toHaveLength(0)
  })
})

describe('handleRetainerInvoicePaymentFailed', () => {
  it('marks the mirror row overdue and takes NO other local action', async () => {
    const { db, writes } = makeDb({
      subRow: SUB_ROW,
      invoiceRow: { id: 'local-inv-1', org_id: 'org-1', status: 'sent' },
    })
    const res = await handleRetainerInvoicePaymentFailed(
      db,
      undefined,
      'sub_stripe_1',
      invoicePayload()
    )
    expect(res.status).toBe(200)
    expect(writes).toHaveLength(1)
    expect(writes[0].sql).toContain("SET status = 'overdue'")
    // Exactly one write: no subscriptions-row change, no Machine-facing action.
    const touchedSubscriptions = writes.some((w) => w.sql.includes('UPDATE subscriptions'))
    expect(touchedSubscriptions).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Subscription lifecycle mirror
// ---------------------------------------------------------------------------

describe('handleSubscriptionLifecycle', () => {
  it('deleted → cancelled with ended_at', async () => {
    const { db, writes } = makeDb({ subRow: SUB_ROW })
    await handleSubscriptionLifecycle(db, 'customer.subscription.deleted', {
      id: 'sub_stripe_1',
      status: 'canceled',
    })
    expect(writes).toHaveLength(1)
    expect(writes[0].sql).toContain("status = 'cancelled'")
    expect(writes[0].sql).toContain('ended_at')
  })

  it('updated with pause_collection present → paused', async () => {
    const { db, writes } = makeDb({ subRow: SUB_ROW })
    await handleSubscriptionLifecycle(db, 'customer.subscription.updated', {
      id: 'sub_stripe_1',
      status: 'active',
      pause_collection: { behavior: 'void' },
    })
    expect(writes).toHaveLength(1)
    expect(writes[0].args).toContain('paused')
  })

  it('updated active without pause_collection → active; past_due keeps access', async () => {
    for (const status of ['active', 'past_due']) {
      const { db, writes } = makeDb({ subRow: SUB_ROW })
      await handleSubscriptionLifecycle(db, 'customer.subscription.updated', {
        id: 'sub_stripe_1',
        status,
      })
      expect(writes).toHaveLength(1)
      expect(writes[0].args).toContain('active')
    }
  })

  it('unknown Stripe subscription is skipped honestly', async () => {
    const { db, writes } = makeDb({ subRow: null })
    const res = await handleSubscriptionLifecycle(db, 'customer.subscription.updated', {
      id: 'sub_unknown',
      status: 'active',
    })
    expect(res.status).toBe(200)
    expect(writes).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Client-scheduled cancellation mirror
//
// The client cancels in the Stripe Billing Portal (mode: at_period_end).
// Stripe keeps the subscription `active` and only flips cancel_at_period_end,
// so without this mirror the cancellation is invisible on both surfaces until
// the delete event lands weeks later.
// ---------------------------------------------------------------------------

/** Writes that touch the scheduled-cancellation key, in order. */
function cancelWrites(writes: { sql: string; args: unknown[] }[]) {
  return writes.filter((w) => w.sql.includes('cancel_at'))
}

describe('scheduled cancellation mirror', () => {
  const PERIOD_END = 1788883200 // 2026-09-08T00:00:00Z

  it('records the end date from cancel_at', async () => {
    const { db, writes } = makeDb({ subRow: SUB_ROW })
    await handleSubscriptionLifecycle(db, 'customer.subscription.updated', {
      id: 'sub_stripe_1',
      status: 'active',
      cancel_at_period_end: true,
      cancel_at: PERIOD_END,
    })
    const c = cancelWrites(writes)
    expect(c).toHaveLength(1)
    expect(c[0].sql).toContain('json_set')
    expect(c[0].args[0]).toBe(new Date(PERIOD_END * 1000).toISOString())
  })

  it('falls back to the ITEM period end — this API version has no top-level one', async () => {
    const { db, writes } = makeDb({ subRow: SUB_ROW })
    await handleSubscriptionLifecycle(db, 'customer.subscription.updated', {
      id: 'sub_stripe_1',
      status: 'active',
      cancel_at_period_end: true,
      cancel_at: null,
      items: { data: [{ current_period_end: PERIOD_END }] },
    })
    expect(cancelWrites(writes)[0].args[0]).toBe(new Date(PERIOD_END * 1000).toISOString())
  })

  it('never invents a date when Stripe names none', async () => {
    const { db, writes } = makeDb({ subRow: SUB_ROW })
    const res = await handleSubscriptionLifecycle(db, 'customer.subscription.updated', {
      id: 'sub_stripe_1',
      status: 'active',
      cancel_at_period_end: true,
      cancel_at: null,
    })
    expect(res.status).toBe(200)
    expect(cancelWrites(writes)).toHaveLength(0)
  })

  it('does not re-write an already-recorded schedule (Stripe resends the whole object)', async () => {
    const iso = new Date(PERIOD_END * 1000).toISOString()
    const { db, writes } = makeDb({
      subRow: { ...SUB_ROW, settings_json: JSON.stringify({ cancel_at: iso }) },
    })
    await handleSubscriptionLifecycle(db, 'customer.subscription.updated', {
      id: 'sub_stripe_1',
      status: 'active',
      cancel_at_period_end: true,
      cancel_at: PERIOD_END,
    })
    expect(cancelWrites(writes)).toHaveLength(0)
  })

  it('clears the schedule when the client reverses the cancellation', async () => {
    const { db, writes } = makeDb({
      subRow: {
        ...SUB_ROW,
        settings_json: JSON.stringify({ cancel_at: new Date(PERIOD_END * 1000).toISOString() }),
      },
    })
    await handleSubscriptionLifecycle(db, 'customer.subscription.updated', {
      id: 'sub_stripe_1',
      status: 'active',
      cancel_at_period_end: false,
    })
    const c = cancelWrites(writes)
    expect(c).toHaveLength(1)
    expect(c[0].sql).toContain('json_remove')
  })

  it('an ordinary update on a healthy subscription writes no cancellation state', async () => {
    const { db, writes } = makeDb({ subRow: SUB_ROW })
    await handleSubscriptionLifecycle(db, 'customer.subscription.updated', {
      id: 'sub_stripe_1',
      status: 'active',
    })
    expect(cancelWrites(writes)).toHaveLength(0)
  })
})
