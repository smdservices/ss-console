import { beforeEach, describe, expect, it } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import { loadPortalHomeDashboard } from './home'

const migrationsDir = resolve(process.cwd(), 'migrations')

const ORG_A = 'portal-home-org-a'
const ORG_B = 'portal-home-org-b'
const ENTITY_A = 'portal-home-entity-a'
const ENTITY_B = 'portal-home-entity-b'
const QUOTE_A = 'portal-home-quote-a'
const QUOTE_B = 'portal-home-quote-b'
const ENGAGEMENT_A = 'portal-home-engagement-a'
const ENGAGEMENT_B = 'portal-home-engagement-b'

describe('loadPortalHomeDashboard', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await seedBaseRows(db)
  })

  it('loads the active engagement dashboard scoped to the caller org and entity', async () => {
    await addInvoice(db, 'invoice-a-paid', ORG_A, ENTITY_A, ENGAGEMENT_A, 'paid', '2026-07-04')
    await addInvoice(db, 'invoice-b-sent', ORG_B, ENTITY_B, ENGAGEMENT_B, 'sent', '2026-07-01')
    await addMilestone(db, 'milestone-a', ORG_A, ENGAGEMENT_A, 'completed', '2026-07-03T12:00:00Z')
    await addMilestone(db, 'milestone-b', ORG_B, ENGAGEMENT_B, 'completed', '2026-07-04T12:00:00Z')

    const dashboard = await loadPortalHomeDashboard(db, ORG_A, ENTITY_A)

    expect(dashboard.activeEngagement?.id).toBe(ENGAGEMENT_A)
    expect(dashboard.invoices.map((invoice) => invoice.id)).toEqual(['invoice-a-paid'])
    expect(dashboard.quotes.map((quote) => quote.id)).toEqual([QUOTE_A])
    expect(dashboard.completedMilestones.map((milestone) => milestone.id)).toEqual(['milestone-a'])
  })

  it('selects the earliest due sent or overdue active-engagement invoice', async () => {
    await addInvoice(db, 'invoice-null-due', ORG_A, ENTITY_A, ENGAGEMENT_A, 'sent', null)
    await addInvoice(
      db,
      'invoice-paid-earlier',
      ORG_A,
      ENTITY_A,
      ENGAGEMENT_A,
      'paid',
      '2026-07-01'
    )
    await addInvoice(db, 'invoice-later', ORG_A, ENTITY_A, ENGAGEMENT_A, 'sent', '2026-07-10')
    await addInvoice(db, 'invoice-earliest', ORG_A, ENTITY_A, ENGAGEMENT_A, 'overdue', '2026-07-02')
    await addCompletedEngagement(db, 'inactive-engagement')
    await addInvoice(
      db,
      'invoice-other-engagement',
      ORG_A,
      ENTITY_A,
      'inactive-engagement',
      'sent',
      '2026-06-01'
    )

    const dashboard = await loadPortalHomeDashboard(db, ORG_A, ENTITY_A)

    expect(dashboard.pendingInvoice?.id).toBe('invoice-earliest')
    expect(dashboard.invoices.map((invoice) => invoice.id)).not.toContain(
      'invoice-other-engagement'
    )
  })

  it('returns quotes but no engagement artifacts when the entity has no active engagement', async () => {
    await db
      .prepare("UPDATE engagements SET status = 'completed' WHERE id = ? AND org_id = ?")
      .bind(ENGAGEMENT_A, ORG_A)
      .run()

    const dashboard = await loadPortalHomeDashboard(db, ORG_A, ENTITY_A)

    expect(dashboard.activeEngagement).toBeNull()
    expect(dashboard.pendingInvoice).toBeNull()
    expect(dashboard.invoices).toEqual([])
    expect(dashboard.completedMilestones).toEqual([])
    expect(dashboard.quotes.map((quote) => quote.id)).toEqual([QUOTE_A])
  })
})

async function seedBaseRows(db: D1Database): Promise<void> {
  for (const [orgId, name] of [
    [ORG_A, 'Portal Home Org A'],
    [ORG_B, 'Portal Home Org B'],
  ]) {
    await db
      .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .bind(orgId, name, orgId)
      .run()
  }

  for (const [entityId, orgId, name] of [
    [ENTITY_A, ORG_A, 'Portal Home Entity A'],
    [ENTITY_B, ORG_B, 'Portal Home Entity B'],
  ]) {
    await db
      .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
      .bind(entityId, orgId, name, entityId)
      .run()
  }

  await seedQuoteAndEngagement(db, ORG_A, ENTITY_A, QUOTE_A, ENGAGEMENT_A)
  await seedQuoteAndEngagement(db, ORG_B, ENTITY_B, QUOTE_B, ENGAGEMENT_B)
}

async function seedQuoteAndEngagement(
  db: D1Database,
  orgId: string,
  entityId: string,
  quoteId: string,
  engagementId: string
): Promise<void> {
  const assessmentId = `${quoteId}-assessment`
  await db
    .prepare('INSERT INTO assessments (id, org_id, entity_id, status) VALUES (?, ?, ?, ?)')
    .bind(assessmentId, orgId, entityId, 'completed')
    .run()

  await db
    .prepare(
      `INSERT INTO quotes (id, org_id, entity_id, assessment_id, line_items, total_hours, rate, total_price, status, sent_at, updated_at)
       VALUES (?, ?, ?, ?, '[]', 10, 200, 2000, 'sent', '2026-07-01T10:00:00Z', '2026-07-01T10:00:00Z')`
    )
    .bind(quoteId, orgId, entityId, assessmentId)
    .run()

  await db
    .prepare(
      `INSERT INTO engagements (id, org_id, entity_id, quote_id, status, consultant_name, next_touchpoint_label, created_at)
       VALUES (?, ?, ?, ?, 'active', 'Ada Lovelace', 'Friday check-in', '2026-07-01T11:00:00Z')`
    )
    .bind(engagementId, orgId, entityId, quoteId)
    .run()
}

async function addInvoice(
  db: D1Database,
  id: string,
  orgId: string,
  entityId: string,
  engagementId: string,
  status: string,
  dueDate: string | null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO invoices (id, org_id, entity_id, engagement_id, type, amount, status, due_date, sent_at, paid_at, created_at)
       VALUES (?, ?, ?, ?, 'deposit', 500, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      orgId,
      entityId,
      engagementId,
      status,
      dueDate,
      status === 'sent' || status === 'overdue' ? '2026-07-01T12:00:00Z' : null,
      status === 'paid' ? '2026-07-02T12:00:00Z' : null,
      `2026-07-01T12:00:${id.length}Z`
    )
    .run()
}

async function addCompletedEngagement(db: D1Database, engagementId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO engagements (id, org_id, entity_id, quote_id, status, created_at)
       VALUES (?, ?, ?, ?, 'completed', '2026-06-01T12:00:00Z')`
    )
    .bind(engagementId, ORG_A, ENTITY_A, QUOTE_A)
    .run()
}

async function addMilestone(
  db: D1Database,
  id: string,
  orgId: string,
  engagementId: string,
  status: string,
  completedAt: string | null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO milestones (id, engagement_id, org_id, name, status, completed_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    )
    .bind(id, engagementId, orgId, `Milestone ${id}`, status, completedAt)
    .run()
}
