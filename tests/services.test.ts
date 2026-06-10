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
  SERVICE_VALID_TRANSITIONS,
} from '../src/lib/db/services'

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
