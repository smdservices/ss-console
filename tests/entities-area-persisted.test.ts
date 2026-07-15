import { describe, expect, it } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import { createEntity, findOrCreateEntity } from '../src/lib/db/entities'

const migrationsDir = resolve(process.cwd(), 'migrations')
const ORG = 'org-test'

async function setup() {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  await db
    .prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)`)
    .bind(ORG, 'Test Org', 'test-org')
    .run()
  return db
}

describe('entities INSERT persists area column (regression for silent area-drop in PR #136)', () => {
  it('createEntity stores area on the row', async () => {
    const db = await setup()
    const e = await createEntity(db, ORG, {
      name: 'Sonoran Desert Plumbing LLC',
      area: 'Phoenix, AZ',
      source_pipeline: 'new_business',
    })
    expect(e.area).toBe('Phoenix, AZ')
  })

  it('createEntity stores null when area is omitted', async () => {
    const db = await setup()
    const e = await createEntity(db, ORG, {
      name: 'Some Other Co',
      source_pipeline: 'new_business',
    })
    expect(e.area).toBeNull()
  })

  it('findOrCreateEntity stores area when a new entity is created', async () => {
    const db = await setup()
    const result = await findOrCreateEntity(db, ORG, {
      name: 'East Valley HVAC',
      area: 'Mesa, AZ',
      source_pipeline: 'job_monitor',
    })
    expect(result.status).toBe('created')
    expect(result.entity.area).toBe('Mesa, AZ')
  })

  it('findOrCreateEntity returns the existing entity (with area) on a second call with matching slug', async () => {
    const db = await setup()
    const first = await findOrCreateEntity(db, ORG, {
      name: 'Reliable Cooling LLC',
      area: 'Tempe, AZ',
      source_pipeline: 'job_monitor',
    })
    expect(first.status).toBe('created')
    expect(first.entity.area).toBe('Tempe, AZ')

    const second = await findOrCreateEntity(db, ORG, {
      name: 'Reliable Cooling LLC',
      area: 'Tempe, AZ',
      source_pipeline: 'job_monitor',
    })
    expect(second.status).toBe('found')
    expect(second.entity.id).toBe(first.entity.id)
    expect(second.entity.area).toBe('Tempe, AZ')
  })
})

describe('entities INSERT persists vertical column (add-a-client, ADR 0077)', () => {
  it('createEntity stores vertical and prospect stage on the row', async () => {
    const db = await setup()
    // Mirrors the add-a-client endpoint (POST /api/admin/clients): a manual
    // record is created at stage `prospect` with its vertical. Before the DAL
    // fix the INSERT silently dropped vertical (column existed, INSERT omitted
    // it), so a new client always listed with no vertical.
    const e = await createEntity(db, ORG, {
      name: 'Acme Plumbing',
      vertical: 'home_services',
      stage: 'prospect',
      source_pipeline: 'admin_manual',
    })
    expect(e.vertical).toBe('home_services')
    expect(e.stage).toBe('prospect')

    // Read back from the row, not the return value, to prove it persisted.
    const row = await db
      .prepare('SELECT vertical, stage FROM entities WHERE id = ?')
      .bind(e.id)
      .first<{ vertical: string | null; stage: string }>()
    expect(row?.vertical).toBe('home_services')
    expect(row?.stage).toBe('prospect')
  })

  it('createEntity stores null when vertical is omitted', async () => {
    const db = await setup()
    const e = await createEntity(db, ORG, { name: 'No Vertical Co' })
    expect(e.vertical).toBeNull()
  })
})
