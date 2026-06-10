import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
} from '@venturecrane/crane-test-harness'
import type { D1Database } from '@cloudflare/workers-types'
import path from 'node:path'
import {
  createService,
  getService,
  listServices,
  getServicesForEntity,
  updateServiceStatus,
  projectConsultingStatus,
  projectOperatorStatus,
  findConsultingSpineDrift,
  hasSpineDrift,
  SERVICE_VALID_TRANSITIONS,
} from '../src/lib/db/services'
import { createEngagement } from '../src/lib/db/engagements'
import { createQuote } from '../src/lib/db/quotes'

const migrationsDir = path.resolve(__dirname, '../migrations')
const ORG = 'org-test'

async function seed(db: D1Database) {
  await db
    .prepare(
      `INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, 'T', 't', datetime('now'), datetime('now'))`
    )
    .bind(ORG)
    .run()
  for (const e of ['ent-1', 'ent-2']) {
    await db
      .prepare(
        `INSERT INTO entities (id, org_id, name, slug, stage, stage_changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'engaged', datetime('now'), datetime('now'), datetime('now'))`
      )
      .bind(e, ORG, e, e)
      .run()
  }
}

/** Real assessment+quote so an engagement can satisfy its FK to quotes(id). */
async function seedQuote(db: D1Database, entityId: string): Promise<string> {
  const assessmentId = `mtg-${entityId}`
  await db
    .prepare(
      `INSERT INTO assessments (id, org_id, entity_id, scheduled_at, status, created_at) VALUES (?, ?, ?, ?, 'scheduled', datetime('now'))`
    )
    .bind(assessmentId, ORG, entityId, null)
    .run()
  const quote = await createQuote(db, ORG, {
    entityId,
    assessmentId,
    lineItems: [],
    rate: 175,
  })
  return quote.id
}

describe('services DAL', () => {
  let db: D1Database
  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await seed(db)
  })

  it('createService writes a svc_-prefixed row scoped to the org', async () => {
    const svc = await createService(db, ORG, {
      entity_id: 'ent-1',
      type: 'consulting',
      cadence: 'one_time',
      quote_id: 'q1',
      status: 'active',
    })
    expect(svc.id.startsWith('svc_')).toBe(true)
    expect(svc.type).toBe('consulting')
    expect(svc.status).toBe('active')
    expect(svc.recurring_price).toBeNull()

    const fetched = await getService(db, ORG, svc.id)
    expect(fetched?.id).toBe(svc.id)
    // org isolation
    expect(await getService(db, 'other-org', svc.id)).toBeNull()
  })

  it('createService stores an operator recurring price', async () => {
    const svc = await createService(db, ORG, {
      entity_id: 'ent-1',
      type: 'operator',
      cadence: 'recurring',
      recurring_price: 1200,
      status: 'active',
    })
    expect(svc.cadence).toBe('recurring')
    expect(svc.recurring_price).toBe(1200)
  })

  it('the operator partial-unique index allows one operator + many consulting per entity', async () => {
    await createService(db, ORG, {
      entity_id: 'ent-1',
      type: 'operator',
      cadence: 'recurring',
      status: 'active',
    })
    // a second operator for the same entity must fail
    await expect(
      createService(db, ORG, {
        entity_id: 'ent-1',
        type: 'operator',
        cadence: 'recurring',
        status: 'active',
      })
    ).rejects.toThrow()
    // multiple consulting services for the same entity are fine
    await createService(db, ORG, {
      entity_id: 'ent-1',
      type: 'consulting',
      cadence: 'one_time',
      status: 'active',
    })
    await createService(db, ORG, {
      entity_id: 'ent-1',
      type: 'consulting',
      cadence: 'one_time',
      status: 'completed',
    })
    const all = await getServicesForEntity(db, ORG, 'ent-1')
    expect(all.filter((s) => s.type === 'consulting')).toHaveLength(2)
    expect(all.filter((s) => s.type === 'operator')).toHaveLength(1)
  })

  it('listServices filters by type and status', async () => {
    await createService(db, ORG, {
      entity_id: 'ent-1',
      type: 'consulting',
      cadence: 'one_time',
      status: 'active',
    })
    await createService(db, ORG, {
      entity_id: 'ent-2',
      type: 'consulting',
      cadence: 'one_time',
      status: 'completed',
    })
    expect(await listServices(db, ORG, { type: 'consulting' })).toHaveLength(2)
    expect(await listServices(db, ORG, { status: 'active' })).toHaveLength(1)
    expect(await listServices(db, ORG, { type: 'operator' })).toHaveLength(0)
  })

  it('updateServiceStatus enforces the commercial transition guard + stamps ended_at', async () => {
    const svc = await createService(db, ORG, {
      entity_id: 'ent-1',
      type: 'consulting',
      cadence: 'one_time',
      status: 'active',
    })
    // active → proposed is invalid
    await expect(updateServiceStatus(db, ORG, svc.id, 'proposed')).rejects.toThrow(
      /Invalid service status transition/
    )
    // active → completed is valid and stamps ended_at
    const done = await updateServiceStatus(db, ORG, svc.id, 'completed')
    expect(done?.status).toBe('completed')
    expect(done?.ended_at).toBeTruthy()
    // completed is terminal
    await expect(updateServiceStatus(db, ORG, svc.id, 'churned')).rejects.toThrow(
      /none \(terminal state\)/
    )
  })

  it('updateServiceStatus returns null for an unknown id', async () => {
    expect(await updateServiceStatus(db, ORG, 'svc_nope', 'active')).toBeNull()
  })
})

describe('status projection (must match the backfill SQL CASE in 0069/0070)', () => {
  it('consulting: completed→completed, cancelled→churned, else→active', () => {
    expect(projectConsultingStatus('completed')).toBe('completed')
    expect(projectConsultingStatus('cancelled')).toBe('churned')
    for (const s of ['scheduled', 'active', 'handoff', 'safety_net']) {
      expect(projectConsultingStatus(s)).toBe('active')
    }
  })
  it('operator: cancelled→churned, else→active', () => {
    expect(projectOperatorStatus('cancelled')).toBe('churned')
    for (const s of ['provisioning', 'active', 'paused']) {
      expect(projectOperatorStatus(s)).toBe('active')
    }
  })
  it('transition graph terminals are empty', () => {
    expect(SERVICE_VALID_TRANSITIONS.completed).toEqual([])
    expect(SERVICE_VALID_TRANSITIONS.churned).toEqual([])
  })
})

describe('createEngagement spawns a linked service (ADR 0046 Stage 1b)', () => {
  let db: D1Database
  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await seed(db)
  })

  it('creates a consulting service parent and links the engagement 1:1', async () => {
    const quoteId = await seedQuote(db, 'ent-1')
    const eng = await createEngagement(db, ORG, { entity_id: 'ent-1', quote_id: quoteId })

    expect(eng.service_id).toBeTruthy()
    expect(eng.service_id?.startsWith('svc_')).toBe(true)

    const services = await getServicesForEntity(db, ORG, 'ent-1')
    expect(services).toHaveLength(1)
    expect(services[0].id).toBe(eng.service_id)
    expect(services[0].type).toBe('consulting')
    expect(services[0].cadence).toBe('one_time')
    // born active — projectConsultingStatus('scheduled') === 'active'
    expect(services[0].status).toBe('active')
    expect(services[0].quote_id).toBe(quoteId)
  })
})

describe('findConsultingSpineDrift (ADR 0046 Stage 1b)', () => {
  let db: D1Database
  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await seed(db)
  })

  it('returns empty when every engagement has its service parent', async () => {
    const quoteId = await seedQuote(db, 'ent-1')
    await createEngagement(db, ORG, { entity_id: 'ent-1', quote_id: quoteId })

    const drift = await findConsultingSpineDrift(db, ORG)
    expect(hasSpineDrift(drift)).toBe(false)
    expect(drift.orphanEngagements).toHaveLength(0)
    expect(drift.childlessServices).toHaveLength(0)
  })

  it('flags an in-flight engagement with no service parent and a childless service', async () => {
    const quoteId = await seedQuote(db, 'ent-1')
    // orphan engagement: in-flight, service_id NULL (the pre-fix corruption shape)
    await db
      .prepare(
        `INSERT INTO engagements (id, org_id, entity_id, quote_id, status, created_at, updated_at) VALUES ('eng-orphan', ?, 'ent-1', ?, 'active', datetime('now'), datetime('now'))`
      )
      .bind(ORG, quoteId)
      .run()
    // childless service: active consulting with no engagement pointing back
    const childless = await createService(db, ORG, {
      entity_id: 'ent-2',
      type: 'consulting',
      cadence: 'one_time',
      status: 'active',
    })

    const drift = await findConsultingSpineDrift(db, ORG)
    expect(hasSpineDrift(drift)).toBe(true)
    expect(drift.orphanEngagements.map((e) => e.id)).toContain('eng-orphan')
    expect(drift.childlessServices.map((s) => s.id)).toContain(childless.id)
  })

  it('does not flag a completed engagement or a completed service', async () => {
    const quoteId = await seedQuote(db, 'ent-1')
    // completed engagement with no service_id — terminal, not in-flight, so ignored
    await db
      .prepare(
        `INSERT INTO engagements (id, org_id, entity_id, quote_id, status, created_at, updated_at) VALUES ('eng-done', ?, 'ent-1', ?, 'completed', datetime('now'), datetime('now'))`
      )
      .bind(ORG, quoteId)
      .run()
    // completed consulting service with no child — only 'active' counts as childless drift
    await createService(db, ORG, {
      entity_id: 'ent-2',
      type: 'consulting',
      cadence: 'one_time',
      status: 'completed',
    })

    const drift = await findConsultingSpineDrift(db, ORG)
    expect(hasSpineDrift(drift)).toBe(false)
  })
})
