/**
 * Tests for the engaged-stage list hydrators that drive the Engaged
 * tab's per-row engagement progress + invoice rollup:
 *
 *   - getActiveEngagementForEntities
 *   - getInvoiceRollupForEntities
 *
 * Real D1 schema, FK chains bypassed via raw SQL inserts where the
 * helper's contract doesn't depend on the FK invariants.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'

import { createEntity } from '../src/lib/db/entities'
import { getActiveEngagementForEntities } from '../src/lib/db/engagements'
import { getInvoiceRollupForEntities } from '../src/lib/db/invoices'

const migrationsDir = resolve(process.cwd(), 'migrations')
const ORG_ID = 'org-test'

async function setup() {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  await db
    .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
    .bind(ORG_ID, 'Test Org', 'test-org')
    .run()
  return db
}

/**
 * Insert an engagement row directly so we can pick the status without
 * walking the createEngagement transition machine. The hydrator's
 * contract is "WHERE org_id AND status NOT IN (...) AND entity_id IN
 * (...)" — only entity_id and status matter for the test.
 */
async function insertEngagementRaw(
  db: D1Database,
  orgId: string,
  entityId: string,
  status: string,
  estimatedHours: number | null = 40,
  actualHours = 0,
  createdAt = new Date().toISOString()
): Promise<string> {
  const id = crypto.randomUUID()
  await db.prepare('PRAGMA foreign_keys = OFF').run()
  await db
    .prepare(
      `INSERT INTO engagements (
         id, org_id, entity_id, quote_id, status, estimated_hours, actual_hours,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      orgId,
      entityId,
      crypto.randomUUID(),
      status,
      estimatedHours,
      actualHours,
      createdAt,
      createdAt
    )
    .run()
  await db.prepare('PRAGMA foreign_keys = ON').run()
  return id
}

async function insertInvoiceRaw(
  db: D1Database,
  orgId: string,
  entityId: string,
  status: string,
  amount: number,
  type = 'deposit'
): Promise<void> {
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.prepare('PRAGMA foreign_keys = OFF').run()
  await db
    .prepare(
      `INSERT INTO invoices (
         id, org_id, entity_id, engagement_id, type, amount, description,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, orgId, entityId, null, type, amount, null, status, now, now)
    .run()
  await db.prepare('PRAGMA foreign_keys = ON').run()
}

describe('getActiveEngagementForEntities', () => {
  let db: D1Database
  beforeEach(async () => {
    db = await setup()
  })

  it('returns an empty map for empty input', async () => {
    expect((await getActiveEngagementForEntities(db, ORG_ID, [])).size).toBe(0)
  })

  it('returns the most recent non-terminal engagement per entity', async () => {
    const e = await createEntity(db, ORG_ID, { name: 'A' })
    await insertEngagementRaw(db, ORG_ID, e.id, 'scheduled', 40, 0, '2026-01-01T00:00:00Z')
    await insertEngagementRaw(db, ORG_ID, e.id, 'active', 40, 12, '2026-04-01T00:00:00Z')

    const result = await getActiveEngagementForEntities(db, ORG_ID, [e.id])
    expect(result.get(e.id)?.status).toBe('active')
    expect(result.get(e.id)?.actual_hours).toBe(12)
  })

  it('skips engagements with terminal status (completed, cancelled)', async () => {
    const e = await createEntity(db, ORG_ID, { name: 'B' })
    await insertEngagementRaw(db, ORG_ID, e.id, 'completed')

    const result = await getActiveEngagementForEntities(db, ORG_ID, [e.id])
    expect(result.has(e.id)).toBe(false)
  })

  it('does not leak engagements across orgs', async () => {
    await db
      .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .bind('org-other', 'Other', 'other')
      .run()
    const e = await createEntity(db, 'org-other', { name: 'Leak' })
    await insertEngagementRaw(db, 'org-other', e.id, 'active')

    const result = await getActiveEngagementForEntities(db, ORG_ID, [e.id])
    expect(result.size).toBe(0)
  })
})

describe('getInvoiceRollupForEntities', () => {
  let db: D1Database
  beforeEach(async () => {
    db = await setup()
  })

  it('returns an empty map for empty input', async () => {
    expect((await getInvoiceRollupForEntities(db, ORG_ID, [])).size).toBe(0)
  })

  it('rolls up outstanding count + amount from sent + overdue invoices', async () => {
    const e = await createEntity(db, ORG_ID, { name: 'A' })
    await insertInvoiceRaw(db, ORG_ID, e.id, 'sent', 1000)
    await insertInvoiceRaw(db, ORG_ID, e.id, 'overdue', 2000)
    // paid + draft + void should not contribute
    await insertInvoiceRaw(db, ORG_ID, e.id, 'paid', 9999)
    await insertInvoiceRaw(db, ORG_ID, e.id, 'draft', 9999)

    const result = await getInvoiceRollupForEntities(db, ORG_ID, [e.id])
    const rollup = result.get(e.id)
    expect(rollup?.outstanding_count).toBe(2)
    expect(rollup?.outstanding_amount).toBe(3000)
    expect(rollup?.has_overdue).toBe(true)
  })

  it('omits entities with no outstanding invoices', async () => {
    const e = await createEntity(db, ORG_ID, { name: 'B' })
    await insertInvoiceRaw(db, ORG_ID, e.id, 'paid', 500)
    const result = await getInvoiceRollupForEntities(db, ORG_ID, [e.id])
    expect(result.has(e.id)).toBe(false)
  })

  it('marks has_overdue=false when only sent (not overdue) invoices exist', async () => {
    const e = await createEntity(db, ORG_ID, { name: 'C' })
    await insertInvoiceRaw(db, ORG_ID, e.id, 'sent', 750)
    const rollup = (await getInvoiceRollupForEntities(db, ORG_ID, [e.id])).get(e.id)
    expect(rollup?.has_overdue).toBe(false)
    expect(rollup?.outstanding_count).toBe(1)
  })

  it('does not leak invoices across orgs', async () => {
    await db
      .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .bind('org-other', 'Other', 'other')
      .run()
    const e = await createEntity(db, 'org-other', { name: 'Leak' })
    await insertInvoiceRaw(db, 'org-other', e.id, 'sent', 100)

    const result = await getInvoiceRollupForEntities(db, ORG_ID, [e.id])
    expect(result.size).toBe(0)
  })
})
