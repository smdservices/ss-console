/**
 * Behavioral tests for the invoice data access layer — real D1 via the
 * crane-test-harness with the full migration set applied.
 *
 * Replaces the source-mirror describe block 'invoices: data layer' that
 * previously lived in tests/invoices.test.ts (readFileSync + toContain
 * assertions that passed even if every function were a stub).
 *
 * Covers:
 * - create/get/list with org_id tenant scoping (cross-org reads return nothing)
 * - listInvoices filters (entity, engagement, status) and ordering
 * - the dynamic UPDATE helper's allowed columns (updateInvoice)
 * - the status state machine (VALID_TRANSITIONS) incl. the #398 send-gate
 * - portal access scoping (listInvoicesForEntity / getInvoiceForEntity)
 * - the outstanding-invoice rollup (getInvoiceRollupForEntities)
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
  installWorkerdPolyfills,
} from '@venturecrane/crane-test-harness'
import type { D1Database } from '@cloudflare/workers-types'
import path from 'node:path'
import {
  createInvoice,
  getInvoice,
  getInvoiceForEntity,
  getInvoiceRollupForEntities,
  listInvoices,
  listInvoicesForEntity,
  updateInvoice,
  updateInvoiceStatus,
  type InvoiceStatus,
  type InvoiceType,
} from './invoices'

installWorkerdPolyfills()

const migrationsDir = path.resolve(__dirname, '../../../migrations')

const ORG_A = 'org-inv-a'
const ORG_B = 'org-inv-b'
const ENTITY_A = 'entity-inv-a'
const ENTITY_A2 = 'entity-inv-a2'
const ENTITY_B = 'entity-inv-b'
const ENGAGEMENT_A = 'engagement-inv-a'

/**
 * Seed one org with an entity and (optionally) the assessment → quote →
 * engagement chain required by the engagements FK graph.
 */
async function seedOrg(
  db: D1Database,
  orgId: string,
  entityId: string,
  opts?: { engagementId?: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO organizations (id, name, slug, created_at, updated_at)
       VALUES (?, ?, ?, datetime('now'), datetime('now'))`
    )
    .bind(orgId, `Org ${orgId}`, orgId)
    .run()

  await db
    .prepare(
      `INSERT INTO entities (id, org_id, name, slug, stage, stage_changed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'engaged', datetime('now'), datetime('now'), datetime('now'))`
    )
    .bind(entityId, orgId, `Entity ${entityId}`, entityId)
    .run()

  if (opts?.engagementId) {
    const assessmentId = `${opts.engagementId}-assessment`
    const quoteId = `${opts.engagementId}-quote`
    await db
      .prepare(
        `INSERT INTO assessments (id, org_id, entity_id, status, created_at)
         VALUES (?, ?, ?, 'completed', datetime('now'))`
      )
      .bind(assessmentId, orgId, entityId)
      .run()
    await db
      .prepare(
        `INSERT INTO quotes (id, org_id, entity_id, assessment_id, version, line_items, total_hours, rate, total_price, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, '[]', 10, 175, 1750, 'accepted', datetime('now'), datetime('now'))`
      )
      .bind(quoteId, orgId, entityId, assessmentId)
      .run()
    await db
      .prepare(
        `INSERT INTO engagements (id, org_id, entity_id, quote_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'scheduled', datetime('now'), datetime('now'))`
      )
      .bind(opts.engagementId, orgId, entityId, quoteId)
      .run()
  }
}

/** Raw invoice insert for fixtures that need a specific status / created_at. */
async function insertInvoice(
  db: D1Database,
  row: {
    id: string
    orgId: string
    entityId: string
    engagementId?: string | null
    type?: InvoiceType
    amount?: number
    status?: InvoiceStatus
    createdAt?: string
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO invoices (id, org_id, entity_id, engagement_id, type, amount, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      row.id,
      row.orgId,
      row.entityId,
      row.engagementId ?? null,
      row.type ?? 'completion',
      row.amount ?? 1000,
      row.status ?? 'draft',
      row.createdAt ?? new Date().toISOString(),
      row.createdAt ?? new Date().toISOString()
    )
    .run()
}

async function addLineItem(db: D1Database, invoiceId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO invoice_line_items (id, invoice_id, description, amount_cents, sort_order, created_at)
       VALUES (?, ?, 'Authored line item', 100000, 0, datetime('now'))`
    )
    .bind(crypto.randomUUID(), invoiceId)
    .run()
}

let db: D1Database

beforeAll(() => {
  const files = discoverNumericMigrations(migrationsDir)
  expect(files.length).toBeGreaterThan(0)
})

beforeEach(async () => {
  db = createTestD1()
  const files = discoverNumericMigrations(migrationsDir)
  await runMigrations(db, { files })
  await seedOrg(db, ORG_A, ENTITY_A, { engagementId: ENGAGEMENT_A })
  await db
    .prepare(
      `INSERT INTO entities (id, org_id, name, slug, stage, stage_changed_at, created_at, updated_at)
       VALUES (?, ?, 'Second Entity A', ?, 'engaged', datetime('now'), datetime('now'), datetime('now'))`
    )
    .bind(ENTITY_A2, ORG_A, ENTITY_A2)
    .run()
  await seedOrg(db, ORG_B, ENTITY_B)
})

// ---------------------------------------------------------------------------
// createInvoice / getInvoice
// ---------------------------------------------------------------------------

describe('createInvoice', () => {
  it('persists a draft invoice and returns the stored row', async () => {
    const invoice = await createInvoice(db, ORG_A, {
      entity_id: ENTITY_A,
      engagement_id: ENGAGEMENT_A,
      type: 'deposit',
      amount: 3500,
      description: 'Deposit (50% of project price)',
      due_date: '2026-07-01',
    })

    expect(invoice.id).toBeTruthy()
    expect(invoice.org_id).toBe(ORG_A)
    expect(invoice.entity_id).toBe(ENTITY_A)
    expect(invoice.engagement_id).toBe(ENGAGEMENT_A)
    expect(invoice.type).toBe('deposit')
    expect(invoice.amount).toBe(3500)
    expect(invoice.status).toBe('draft')
    expect(invoice.description).toBe('Deposit (50% of project price)')
    expect(invoice.due_date).toBe('2026-07-01')
    expect(invoice.sent_at).toBeNull()
    expect(invoice.paid_at).toBeNull()

    const stored = await db
      .prepare('SELECT * FROM invoices WHERE id = ?')
      .bind(invoice.id)
      .first<{ status: string; org_id: string }>()
    expect(stored?.status).toBe('draft')
    expect(stored?.org_id).toBe(ORG_A)
  })

  it('defaults engagement_id, description, and due_date to null when omitted', async () => {
    const invoice = await createInvoice(db, ORG_A, {
      entity_id: ENTITY_A,
      type: 'assessment',
      amount: 250,
    })
    expect(invoice.engagement_id).toBeNull()
    expect(invoice.description).toBeNull()
    expect(invoice.due_date).toBeNull()
  })
})

describe('getInvoice — org scoping', () => {
  it('returns the invoice for the owning org', async () => {
    const created = await createInvoice(db, ORG_A, {
      entity_id: ENTITY_A,
      type: 'completion',
      amount: 1750,
    })
    const fetched = await getInvoice(db, ORG_A, created.id)
    expect(fetched?.id).toBe(created.id)
  })

  it('returns null when another org requests the same invoice id', async () => {
    const created = await createInvoice(db, ORG_A, {
      entity_id: ENTITY_A,
      type: 'completion',
      amount: 1750,
    })
    expect(await getInvoice(db, ORG_B, created.id)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// listInvoices
// ---------------------------------------------------------------------------

describe('listInvoices', () => {
  beforeEach(async () => {
    await insertInvoice(db, {
      id: 'inv-a1',
      orgId: ORG_A,
      entityId: ENTITY_A,
      engagementId: ENGAGEMENT_A,
      status: 'sent',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    await insertInvoice(db, {
      id: 'inv-a2',
      orgId: ORG_A,
      entityId: ENTITY_A2,
      status: 'draft',
      createdAt: '2026-02-01T00:00:00.000Z',
    })
    await insertInvoice(db, {
      id: 'inv-b1',
      orgId: ORG_B,
      entityId: ENTITY_B,
      status: 'sent',
      createdAt: '2026-03-01T00:00:00.000Z',
    })
  })

  it('returns only the requesting org rows, newest first', async () => {
    const rows = await listInvoices(db, ORG_A)
    expect(rows.map((r) => r.id)).toEqual(['inv-a2', 'inv-a1'])
  })

  it('cross-org listing never leaks another tenant invoices', async () => {
    const rows = await listInvoices(db, ORG_B)
    expect(rows.map((r) => r.id)).toEqual(['inv-b1'])
  })

  it('filters by entityId', async () => {
    const rows = await listInvoices(db, ORG_A, { entityId: ENTITY_A2 })
    expect(rows.map((r) => r.id)).toEqual(['inv-a2'])
  })

  it('filters by engagementId', async () => {
    const rows = await listInvoices(db, ORG_A, { engagementId: ENGAGEMENT_A })
    expect(rows.map((r) => r.id)).toEqual(['inv-a1'])
  })

  it('filters by status', async () => {
    const rows = await listInvoices(db, ORG_A, { status: 'sent' })
    expect(rows.map((r) => r.id)).toEqual(['inv-a1'])
  })

  it('combines filters conjunctively', async () => {
    const rows = await listInvoices(db, ORG_A, { entityId: ENTITY_A, status: 'draft' })
    expect(rows).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// updateInvoice — dynamic UPDATE helper
// ---------------------------------------------------------------------------

describe('updateInvoice', () => {
  let invoiceId: string

  beforeEach(async () => {
    const created = await createInvoice(db, ORG_A, {
      entity_id: ENTITY_A,
      type: 'completion',
      amount: 1750,
      description: 'original',
      due_date: '2026-07-01',
    })
    invoiceId = created.id
  })

  it('updates each allowed column and leaves the rest untouched', async () => {
    const updated = await updateInvoice(db, ORG_A, invoiceId, {
      amount: 2000,
      description: 'revised',
      due_date: '2026-08-01',
      stripe_invoice_id: 'in_test_123',
      stripe_hosted_url: 'https://invoice.stripe.com/i/in_test_123',
    })
    expect(updated?.amount).toBe(2000)
    expect(updated?.description).toBe('revised')
    expect(updated?.due_date).toBe('2026-08-01')
    expect(updated?.stripe_invoice_id).toBe('in_test_123')
    expect(updated?.stripe_hosted_url).toBe('https://invoice.stripe.com/i/in_test_123')
    // Columns outside the allowed set are not part of the helper surface.
    expect(updated?.status).toBe('draft')
    expect(updated?.org_id).toBe(ORG_A)
    expect(updated?.type).toBe('completion')
  })

  it('only touches the columns provided — partial update preserves others', async () => {
    const updated = await updateInvoice(db, ORG_A, invoiceId, { amount: 999 })
    expect(updated?.amount).toBe(999)
    expect(updated?.description).toBe('original')
    expect(updated?.due_date).toBe('2026-07-01')
  })

  it('explicit null clears nullable columns', async () => {
    const updated = await updateInvoice(db, ORG_A, invoiceId, {
      description: null,
      due_date: null,
    })
    expect(updated?.description).toBeNull()
    expect(updated?.due_date).toBeNull()
  })

  it('returns the existing row unchanged when no fields are provided', async () => {
    const updated = await updateInvoice(db, ORG_A, invoiceId, {})
    expect(updated?.amount).toBe(1750)
    expect(updated?.description).toBe('original')
  })

  it('returns null for an unknown invoice id', async () => {
    expect(await updateInvoice(db, ORG_A, 'no-such-invoice', { amount: 1 })).toBeNull()
  })

  it('cross-org update returns null and writes nothing', async () => {
    const result = await updateInvoice(db, ORG_B, invoiceId, { amount: 1 })
    expect(result).toBeNull()
    const row = await getInvoice(db, ORG_A, invoiceId)
    expect(row?.amount).toBe(1750)
  })
})

// ---------------------------------------------------------------------------
// updateInvoiceStatus — state machine
// ---------------------------------------------------------------------------

describe('updateInvoiceStatus', () => {
  let invoiceId: string

  beforeEach(async () => {
    const created = await createInvoice(db, ORG_A, {
      entity_id: ENTITY_A,
      type: 'completion',
      amount: 1750,
    })
    invoiceId = created.id
  })

  it('draft -> sent fails the send-gate when no line items are authored (#398)', async () => {
    await expect(updateInvoiceStatus(db, ORG_A, invoiceId, 'sent')).rejects.toThrow(
      /missing authored line items/
    )
    const row = await getInvoice(db, ORG_A, invoiceId)
    expect(row?.status).toBe('draft')
    expect(row?.sent_at).toBeNull()
  })

  it('draft -> sent succeeds with an authored line item and stamps sent_at', async () => {
    await addLineItem(db, invoiceId)
    const updated = await updateInvoiceStatus(db, ORG_A, invoiceId, 'sent')
    expect(updated?.status).toBe('sent')
    expect(updated?.sent_at).toBeTruthy()
    expect(updated?.paid_at).toBeNull()
  })

  it('sent -> paid stamps paid_at', async () => {
    await addLineItem(db, invoiceId)
    await updateInvoiceStatus(db, ORG_A, invoiceId, 'sent')
    const paid = await updateInvoiceStatus(db, ORG_A, invoiceId, 'paid')
    expect(paid?.status).toBe('paid')
    expect(paid?.paid_at).toBeTruthy()
  })

  it('sent -> overdue -> paid is a valid path', async () => {
    await addLineItem(db, invoiceId)
    await updateInvoiceStatus(db, ORG_A, invoiceId, 'sent')
    const overdue = await updateInvoiceStatus(db, ORG_A, invoiceId, 'overdue')
    expect(overdue?.status).toBe('overdue')
    const paid = await updateInvoiceStatus(db, ORG_A, invoiceId, 'paid')
    expect(paid?.status).toBe('paid')
    expect(paid?.paid_at).toBeTruthy()
  })

  it('draft -> void is allowed without line items', async () => {
    const voided = await updateInvoiceStatus(db, ORG_A, invoiceId, 'void')
    expect(voided?.status).toBe('void')
    expect(voided?.sent_at).toBeNull()
    expect(voided?.paid_at).toBeNull()
  })

  it('rejects draft -> paid (skipping sent)', async () => {
    await expect(updateInvoiceStatus(db, ORG_A, invoiceId, 'paid')).rejects.toThrow(
      /Invalid status transition: draft -> paid/
    )
    const row = await getInvoice(db, ORG_A, invoiceId)
    expect(row?.status).toBe('draft')
  })

  it('paid is terminal — rejects any further transition', async () => {
    await addLineItem(db, invoiceId)
    await updateInvoiceStatus(db, ORG_A, invoiceId, 'sent')
    await updateInvoiceStatus(db, ORG_A, invoiceId, 'paid')
    await expect(updateInvoiceStatus(db, ORG_A, invoiceId, 'void')).rejects.toThrow(
      /Invalid status transition: paid -> void/
    )
  })

  it('void is terminal — rejects any further transition', async () => {
    await updateInvoiceStatus(db, ORG_A, invoiceId, 'void')
    await expect(updateInvoiceStatus(db, ORG_A, invoiceId, 'sent')).rejects.toThrow(
      /Invalid status transition: void -> sent/
    )
  })

  it('cross-org transition returns null and mutates nothing', async () => {
    const result = await updateInvoiceStatus(db, ORG_B, invoiceId, 'void')
    expect(result).toBeNull()
    const row = await getInvoice(db, ORG_A, invoiceId)
    expect(row?.status).toBe('draft')
  })
})

// ---------------------------------------------------------------------------
// Portal access — listInvoicesForEntity / getInvoiceForEntity
// ---------------------------------------------------------------------------

describe('portal invoice access', () => {
  beforeEach(async () => {
    await insertInvoice(db, { id: 'inv-draft', orgId: ORG_A, entityId: ENTITY_A, status: 'draft' })
    await insertInvoice(db, { id: 'inv-sent', orgId: ORG_A, entityId: ENTITY_A, status: 'sent' })
    await insertInvoice(db, { id: 'inv-paid', orgId: ORG_A, entityId: ENTITY_A, status: 'paid' })
    await insertInvoice(db, {
      id: 'inv-overdue',
      orgId: ORG_A,
      entityId: ENTITY_A,
      status: 'overdue',
    })
    await insertInvoice(db, { id: 'inv-void', orgId: ORG_A, entityId: ENTITY_A, status: 'void' })
    await insertInvoice(db, {
      id: 'inv-other-entity',
      orgId: ORG_A,
      entityId: ENTITY_A2,
      status: 'sent',
    })
  })

  it('listInvoicesForEntity returns only sent/paid/overdue — drafts and voids stay internal', async () => {
    const rows = await listInvoicesForEntity(db, ORG_A, ENTITY_A)
    expect(rows.map((r) => r.id).sort()).toEqual(['inv-overdue', 'inv-paid', 'inv-sent'])
  })

  it('listInvoicesForEntity never returns another entity rows', async () => {
    const rows = await listInvoicesForEntity(db, ORG_A, ENTITY_A2)
    expect(rows.map((r) => r.id)).toEqual(['inv-other-entity'])
  })

  it('listInvoicesForEntity returns nothing for the right entity under the wrong org (#399)', async () => {
    const rows = await listInvoicesForEntity(db, ORG_B, ENTITY_A)
    expect(rows).toEqual([])
  })

  it('getInvoiceForEntity returns a portal-visible invoice', async () => {
    const row = await getInvoiceForEntity(db, ORG_A, ENTITY_A, 'inv-sent')
    expect(row?.id).toBe('inv-sent')
  })

  it('getInvoiceForEntity hides draft and void invoices even with the right ids', async () => {
    expect(await getInvoiceForEntity(db, ORG_A, ENTITY_A, 'inv-draft')).toBeNull()
    expect(await getInvoiceForEntity(db, ORG_A, ENTITY_A, 'inv-void')).toBeNull()
  })

  it('getInvoiceForEntity returns null for another entity invoice id', async () => {
    expect(await getInvoiceForEntity(db, ORG_A, ENTITY_A, 'inv-other-entity')).toBeNull()
  })

  it('getInvoiceForEntity returns null under the wrong org (#399)', async () => {
    expect(await getInvoiceForEntity(db, ORG_B, ENTITY_A, 'inv-sent')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getInvoiceRollupForEntities
// ---------------------------------------------------------------------------

describe('getInvoiceRollupForEntities', () => {
  it('returns an empty map for empty input', async () => {
    const map = await getInvoiceRollupForEntities(db, ORG_A, [])
    expect(map.size).toBe(0)
  })

  it('counts and sums only outstanding (sent + overdue) invoices', async () => {
    await insertInvoice(db, {
      id: 'r-sent',
      orgId: ORG_A,
      entityId: ENTITY_A,
      status: 'sent',
      amount: 1000,
    })
    await insertInvoice(db, {
      id: 'r-overdue',
      orgId: ORG_A,
      entityId: ENTITY_A,
      status: 'overdue',
      amount: 500,
    })
    await insertInvoice(db, {
      id: 'r-paid',
      orgId: ORG_A,
      entityId: ENTITY_A,
      status: 'paid',
      amount: 9999,
    })
    await insertInvoice(db, {
      id: 'r-draft',
      orgId: ORG_A,
      entityId: ENTITY_A,
      status: 'draft',
      amount: 9999,
    })
    await insertInvoice(db, {
      id: 'r-void',
      orgId: ORG_A,
      entityId: ENTITY_A,
      status: 'void',
      amount: 9999,
    })

    const map = await getInvoiceRollupForEntities(db, ORG_A, [ENTITY_A])
    const rollup = map.get(ENTITY_A)
    expect(rollup).toBeDefined()
    expect(rollup?.outstanding_count).toBe(2)
    expect(rollup?.outstanding_amount).toBe(1500)
    expect(rollup?.has_overdue).toBe(true)
  })

  it('has_overdue is false when outstanding invoices are all merely sent', async () => {
    await insertInvoice(db, {
      id: 'r-sent-only',
      orgId: ORG_A,
      entityId: ENTITY_A,
      status: 'sent',
      amount: 750,
    })
    const map = await getInvoiceRollupForEntities(db, ORG_A, [ENTITY_A])
    expect(map.get(ENTITY_A)?.has_overdue).toBe(false)
  })

  it('omits entities with no outstanding invoices from the map', async () => {
    await insertInvoice(db, {
      id: 'r-paid-only',
      orgId: ORG_A,
      entityId: ENTITY_A2,
      status: 'paid',
      amount: 100,
    })
    const map = await getInvoiceRollupForEntities(db, ORG_A, [ENTITY_A, ENTITY_A2])
    expect(map.has(ENTITY_A)).toBe(false)
    expect(map.has(ENTITY_A2)).toBe(false)
  })

  it('excludes another org outstanding invoices for the same entity id', async () => {
    await insertInvoice(db, {
      id: 'r-cross-org',
      orgId: ORG_A,
      entityId: ENTITY_A,
      status: 'sent',
      amount: 1000,
    })
    const map = await getInvoiceRollupForEntities(db, ORG_B, [ENTITY_A])
    expect(map.size).toBe(0)
  })
})
