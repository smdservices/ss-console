import { beforeEach, describe, expect, it } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import { loadPortalInvoiceDetail } from './invoice-detail'
import { loadPortalQuoteDetail } from './quote-detail'

const migrationsDir = resolve(process.cwd(), 'migrations')

const ORG_A = 'portal-detail-org-a'
const ORG_B = 'portal-detail-org-b'
const ENTITY_A = 'portal-detail-entity-a'
const ENTITY_B = 'portal-detail-entity-b'
const ASSESSMENT_A = 'portal-detail-assessment-a'
const ASSESSMENT_B = 'portal-detail-assessment-b'
const QUOTE_A = 'portal-detail-quote-a'
const QUOTE_A2 = 'portal-detail-quote-a2'
const QUOTE_B = 'portal-detail-quote-b'
const ENGAGEMENT_A = 'portal-detail-engagement-a'
const ENGAGEMENT_B = 'portal-detail-engagement-b'
const INVOICE_A = 'portal-detail-invoice-a'
const INVOICE_B = 'portal-detail-invoice-b'

describe('portal detail readers', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await seedRows(db)
  })

  it('loads invoice detail rows through org and entity scope', async () => {
    const detail = await loadPortalInvoiceDetail(db, ORG_A, ENTITY_A, INVOICE_A)

    expect(detail?.invoice.id).toBe(INVOICE_A)
    expect(detail?.lineItems.map((item) => item.description)).toEqual(['Deposit'])
    expect(detail?.engagement?.id).toBe(ENGAGEMENT_A)
    expect(detail?.engagement?.consultant_name).toBe('Ada Lovelace')
  })

  it('returns null for invoice detail outside the caller org or entity', async () => {
    await expect(loadPortalInvoiceDetail(db, ORG_A, ENTITY_B, INVOICE_B)).resolves.toBeNull()
    await expect(loadPortalInvoiceDetail(db, ORG_B, ENTITY_A, INVOICE_A)).resolves.toBeNull()
  })

  it('loads quote detail rows through org and entity scope', async () => {
    const detail = await loadPortalQuoteDetail(db, ORG_A, ENTITY_A, QUOTE_A)

    expect(detail?.quote.id).toBe(QUOTE_A)
    expect(detail?.engagement?.id).toBe(ENGAGEMENT_A)
    expect(detail?.engagement?.next_touchpoint_label).toBe('Friday check-in')
    expect(detail?.superseding?.id).toBe(QUOTE_A2)
    expect(detail?.sowState.downloadableRevision).toBeNull()
  })

  it('returns null for quote detail outside the caller org or entity', async () => {
    await expect(loadPortalQuoteDetail(db, ORG_A, ENTITY_B, QUOTE_B)).resolves.toBeNull()
    await expect(loadPortalQuoteDetail(db, ORG_B, ENTITY_A, QUOTE_A)).resolves.toBeNull()
  })
})

async function seedRows(db: D1Database): Promise<void> {
  await seedOrgAndEntity(db, ORG_A, ENTITY_A, 'A')
  await seedOrgAndEntity(db, ORG_B, ENTITY_B, 'B')
  await seedQuote(db, ORG_A, ENTITY_A, ASSESSMENT_A, QUOTE_A, 1, null)
  await seedQuote(db, ORG_A, ENTITY_A, ASSESSMENT_A, QUOTE_A2, 2, QUOTE_A)
  await seedQuote(db, ORG_B, ENTITY_B, ASSESSMENT_B, QUOTE_B, 1, null)
  await seedEngagement(db, ORG_A, ENTITY_A, QUOTE_A, ENGAGEMENT_A)
  await seedEngagement(db, ORG_B, ENTITY_B, QUOTE_B, ENGAGEMENT_B)
  await seedInvoice(db, ORG_A, ENTITY_A, ENGAGEMENT_A, INVOICE_A)
  await seedInvoice(db, ORG_B, ENTITY_B, ENGAGEMENT_B, INVOICE_B)
}

async function seedOrgAndEntity(
  db: D1Database,
  orgId: string,
  entityId: string,
  suffix: string
): Promise<void> {
  await db
    .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
    .bind(orgId, `Portal Detail Org ${suffix}`, orgId)
    .run()

  await db
    .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
    .bind(entityId, orgId, `Portal Detail Entity ${suffix}`, entityId)
    .run()
}

async function seedQuote(
  db: D1Database,
  orgId: string,
  entityId: string,
  assessmentId: string,
  quoteId: string,
  version: number,
  parentQuoteId: string | null
): Promise<void> {
  if (version === 1) {
    await db
      .prepare('INSERT INTO assessments (id, org_id, entity_id, status) VALUES (?, ?, ?, ?)')
      .bind(assessmentId, orgId, entityId, 'completed')
      .run()
  }

  await db
    .prepare(
      `INSERT INTO quotes (
         id, org_id, entity_id, assessment_id, version, parent_quote_id,
         line_items, total_hours, rate, total_price, deposit_pct, status, sent_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, '[]', 12, 200, 2400, 0.5, 'sent', '2026-07-01T10:00:00Z', '2026-07-01T10:00:00Z')`
    )
    .bind(quoteId, orgId, entityId, assessmentId, version, parentQuoteId)
    .run()
}

async function seedEngagement(
  db: D1Database,
  orgId: string,
  entityId: string,
  quoteId: string,
  engagementId: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO engagements (
         id, org_id, entity_id, quote_id, status, consultant_name, consultant_phone,
         next_touchpoint_label, created_at
       )
       VALUES (?, ?, ?, ?, 'active', 'Ada Lovelace', '555-0100', 'Friday check-in', '2026-07-01T11:00:00Z')`
    )
    .bind(engagementId, orgId, entityId, quoteId)
    .run()
}

async function seedInvoice(
  db: D1Database,
  orgId: string,
  entityId: string,
  engagementId: string,
  invoiceId: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO invoices (
         id, org_id, entity_id, engagement_id, type, amount, description, status, due_date,
         sent_at, stripe_hosted_url, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, 'deposit', 500, 'Deposit', 'sent', '2026-07-15', '2026-07-01T12:00:00Z', 'https://pay.example/invoice', '2026-07-01T12:00:00Z', '2026-07-01T12:00:00Z')`
    )
    .bind(invoiceId, orgId, entityId, engagementId)
    .run()

  await db
    .prepare(
      `INSERT INTO invoice_line_items (id, invoice_id, description, amount_cents, sort_order, created_at)
       VALUES (?, ?, 'Deposit', 50000, 1, '2026-07-01T12:01:00Z')`
    )
    .bind(`${invoiceId}-line-1`, invoiceId)
    .run()
}
