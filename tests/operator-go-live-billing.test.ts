/**
 * The Operator's commercial go-live, end to end at the data layer
 * (A&P production-client readiness, 2026-08-29).
 *
 * Three facts the portal's visibility rules depend on (offerings.ts):
 *   1. A `provisioning` operator row is promoted to `active` by the admin's
 *      start-billing act and by nothing else (the webhooks keep their
 *      provisioning guard). That flip is what reveals Home + Billing.
 *   2. The stand-up fee is an `implementation` invoice (migration 0110) that
 *      is born with its authored line item, so it can be presented at once.
 *   3. The Billing Start Date parser refuses the past and anchors the future
 *      at 16:00 UTC.
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
  createInvoice,
  invoiceTypeLabel,
  isInvoiceType,
  listLineItemsForInvoice,
  updateInvoiceStatus,
} from '../src/lib/db/invoices'
import { parseBillingStart } from '../src/pages/api/admin/clients/[id]/subscription-billing'

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

describe('go-live: start-billing promotes the operator row (offerings.ts hasBillingRelationship)', () => {
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

describe('parseBillingStart', () => {
  const now = new Date('2026-08-29T20:00:00Z')

  it('empty means bill now', () => {
    expect(parseBillingStart(null, now)).toEqual({ ok: true, anchor: undefined })
    expect(parseBillingStart('', now)).toEqual({ ok: true, anchor: undefined })
  })

  it('a future date anchors at 16:00 UTC that day', () => {
    const r = parseBillingStart('2026-09-08', now)
    expect(r).toEqual({ ok: true, anchor: Date.UTC(2026, 8, 8, 16, 0, 0) / 1000 })
  })

  it('today after 16:00 UTC becomes now + 5 minutes (Stripe needs a future anchor)', () => {
    const r = parseBillingStart('2026-08-29', now)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.anchor).toBe(Math.floor((now.getTime() + 5 * 60 * 1000) / 1000))
  })

  it('refuses the past and malformed input', () => {
    expect(parseBillingStart('2026-08-28', now)).toEqual({ ok: false })
    expect(parseBillingStart('next week', now)).toEqual({ ok: false })
    expect(parseBillingStart('2026-13-40', now)).toEqual({ ok: false })
  })
})
