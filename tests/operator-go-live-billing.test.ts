/**
 * The Operator's commercial go-live, end to end at the data layer
 * (A&P production-client readiness, 2026-08-29).
 *
 * Three facts the portal's visibility rules depend on (offerings.ts):
 *   1. A `provisioning` operator row is promoted to `active` by the client's
 *      own checkout (operator-checkout-handler) and by nothing else (the
 *      generic status mirror keeps its provisioning guard). That flip is
 *      what reveals Home + Billing.
 *   2. The stand-up fee is an `implementation` invoice (migration 0110) that
 *      is born with its authored line item, so it can be presented at once.
 *   3. The checkout-completed handler binds, promotes, and is idempotent.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import {
  activateOperatorSubscriptionForBilling,
  getSubscriptionForBilling,
  setSubscriptionBillingStatus,
} from '../src/lib/db/subscriptions'
import {
  CARD_FEE_LINE_DESCRIPTION,
  cardProcessingFeeCents,
  createInvoice,
  invoiceIsCardPayable,
  invoiceTypeLabel,
  isInvoiceType,
  listLineItemsForInvoice,
  updateInvoiceStatus,
} from '../src/lib/db/invoices'
import {
  handleOperatorCheckoutCompleted,
  type OperatorCheckoutSessionPayload,
} from '../src/lib/webhooks/operator-checkout-handler'

const migrationsDir = resolve(process.cwd(), 'migrations')
const ORG = 'org-a'
const ENTITY = 'entity-a'

async function seed(db: D1Database): Promise<void> {
  await db
    .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
    .bind(ORG, 'Org A', 'org-a')
    .run()
  await db
    .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
    .bind(ENTITY, ORG, 'Entity A', 'entity-a')
    .run()
}

async function insertSubscription(
  db: D1Database,
  id: string,
  productSlug: string,
  status: string
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO subscriptions (id, org_id, entity_id, product_slug, instance_slug, status) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(id, ORG, ENTITY, productSlug, productSlug === 'operator' ? 'seat-a' : null, status)
    .run()
}

describe('go-live: the promotion primitive (offerings.ts hasBillingRelationship)', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await seed(db)
  })

  it('promotes a provisioning operator row to active', async () => {
    await insertSubscription(db, 'sub-op', 'operator', 'provisioning')
    expect(await activateOperatorSubscriptionForBilling(db, 'sub-op')).toBe(true)
    const row = await getSubscriptionForBilling(db, ENTITY, 'operator')
    expect(row?.status).toBe('active')
  })

  it('is a no-op on rows that are not provisioning (never resurrects cancelled, never re-flips)', async () => {
    await insertSubscription(db, 'sub-cancel', 'operator', 'cancelled')
    expect(await activateOperatorSubscriptionForBilling(db, 'sub-cancel')).toBe(false)
    expect((await getSubscriptionForBilling(db, ENTITY, 'operator'))?.status).toBe('cancelled')
  })

  it('never touches a non-operator product (the Hosted Agent has its own activation flow)', async () => {
    await insertSubscription(db, 'sub-ha', 'hosted-agent', 'provisioning')
    expect(await activateOperatorSubscriptionForBilling(db, 'sub-ha')).toBe(false)
    expect((await getSubscriptionForBilling(db, ENTITY, 'hosted-agent'))?.status).toBe(
      'provisioning'
    )
  })

  it('the webhook mirror still cannot promote a provisioning row (guard intact)', async () => {
    await insertSubscription(db, 'sub-op', 'operator', 'provisioning')
    await setSubscriptionBillingStatus(db, 'sub-op', 'active')
    expect((await getSubscriptionForBilling(db, ENTITY, 'operator'))?.status).toBe('provisioning')
  })
})

describe('the stand-up fee is an implementation invoice, born presentable (migration 0110)', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await seed(db)
  })

  it('implementation is in the vocabulary with a client-readable label', () => {
    expect(isInvoiceType('implementation')).toBe(true)
    expect(invoiceTypeLabel('implementation')).toBe('Implementation')
    expect(isInvoiceType('surcharge')).toBe(false)
    expect(invoiceTypeLabel('surcharge')).toBeNull()
  })

  it('creates the invoice with its authored line and passes the send-gate', async () => {
    const invoice = await createInvoice(db, ORG, {
      entity_id: ENTITY,
      type: 'implementation',
      amount: 4000,
      description: 'Operator implementation',
      line_items: [{ description: 'Operator implementation and stand-up', amount_cents: 400000 }],
    })
    expect(invoice.type).toBe('implementation')
    const lines = await listLineItemsForInvoice(db, invoice.id)
    expect(lines).toHaveLength(1)
    expect(lines[0].amount_cents).toBe(400000)

    const sent = await updateInvoiceStatus(db, ORG, invoice.id, 'sent')
    expect(sent?.status).toBe('sent')
  })

  it('a line-less invoice is still unsendable (gate unchanged)', async () => {
    const invoice = await createInvoice(db, ORG, {
      entity_id: ENTITY,
      type: 'implementation',
      amount: 4000,
    })
    await expect(updateInvoiceStatus(db, ORG, invoice.id, 'sent')).rejects.toThrow(
      /missing authored line items/
    )
  })

  it('line items still cascade with their invoice after the table rebuild', async () => {
    const invoice = await createInvoice(db, ORG, {
      entity_id: ENTITY,
      type: 'deposit',
      amount: 10,
      line_items: [{ description: 'x', amount_cents: 1000 }],
    })
    await db.prepare('DELETE FROM invoices WHERE id = ?').bind(invoice.id).run()
    expect(await listLineItemsForInvoice(db, invoice.id)).toHaveLength(0)
  })
})

describe('card processing fee (agreement §3.8)', () => {
  it('is 3% of the amount paid by card, rounded to the cent', () => {
    expect(cardProcessingFeeCents(400000)).toBe(12000)
    expect(cardProcessingFeeCents(500000)).toBe(15000)
    expect(cardProcessingFeeCents(1)).toBe(0)
  })

  it('an invoice is card-payable only when it carries the fee line', () => {
    expect(invoiceIsCardPayable([{ description: 'Operator implementation' }])).toBe(false)
    expect(
      invoiceIsCardPayable([
        { description: 'Operator implementation' },
        { description: CARD_FEE_LINE_DESCRIPTION },
      ])
    ).toBe(true)
  })
})

describe("operator checkout.session.completed: the client's payment is the go-live act", () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await seed(db)
    await insertSubscription(db, 'sub-op', 'operator', 'provisioning')
  })

  const payload = (
    over: Partial<OperatorCheckoutSessionPayload> = {}
  ): OperatorCheckoutSessionPayload => ({
    id: 'cs_test_1',
    client_reference_id: 'user-1',
    customer: 'cus_1',
    subscription: 'sub_stripe_1',
    amount_total: 500000,
    customer_details: { email: 'admin@firm.com', name: 'Admin' },
    metadata: { product_slug: 'operator', smd_entity_id: ENTITY, smd_subscription_id: 'sub-op' },
    ...over,
  })

  it('binds the Stripe subscription + customer and promotes the row to active', async () => {
    const res = await handleOperatorCheckoutCompleted(db, payload())
    expect(res.status).toBe(200)
    const row = await db
      .prepare(
        'SELECT status, stripe_subscription_id, settings_json FROM subscriptions WHERE id = ?'
      )
      .bind('sub-op')
      .first<{ status: string; stripe_subscription_id: string; settings_json: string }>()
    expect(row?.status).toBe('active')
    expect(row?.stripe_subscription_id).toBe('sub_stripe_1')
    expect(JSON.parse(row!.settings_json)).toEqual({ stripe_customer_id: 'cus_1' })
    const order = await db
      .prepare('SELECT status, product_slug FROM stripe_checkout_orders WHERE session_id = ?')
      .bind('cs_test_1')
      .first<{ status: string; product_slug: string }>()
    expect(order).toEqual({ status: 'processed', product_slug: 'operator' })
  })

  it('is idempotent on replay', async () => {
    await handleOperatorCheckoutCompleted(db, payload())
    const res = await handleOperatorCheckoutCompleted(db, payload({ subscription: 'sub_other' }))
    expect(res.status).toBe(200)
    const row = await db
      .prepare('SELECT stripe_subscription_id FROM subscriptions WHERE id = ?')
      .bind('sub-op')
      .first<{ stripe_subscription_id: string }>()
    expect(row?.stripe_subscription_id).toBe('sub_stripe_1')
  })

  it('acks a session for another product without touching anything', async () => {
    const res = await handleOperatorCheckoutCompleted(
      db,
      payload({ metadata: { product_slug: 'hosted-agent' } })
    )
    expect(res.status).toBe(200)
    const row = await db
      .prepare('SELECT status FROM subscriptions WHERE id = ?')
      .bind('sub-op')
      .first<{ status: string }>()
    expect(row?.status).toBe('provisioning')
  })

  it('records a session naming an unknown row as failed (200, no invention)', async () => {
    const res = await handleOperatorCheckoutCompleted(
      db,
      payload({ metadata: { product_slug: 'operator', smd_subscription_id: 'sub-nope' } })
    )
    expect(res.status).toBe(200)
    const order = await db
      .prepare('SELECT status FROM stripe_checkout_orders WHERE session_id = ?')
      .bind('cs_test_1')
      .first<{ status: string }>()
    expect(order?.status).toBe('failed')
    const row = await db
      .prepare('SELECT status FROM subscriptions WHERE id = ?')
      .bind('sub-op')
      .first<{ status: string }>()
    expect(row?.status).toBe('provisioning')
  })
})
