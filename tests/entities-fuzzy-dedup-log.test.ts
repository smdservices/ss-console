import { describe, expect, it } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import { findOrCreateEntity } from '../src/lib/db/entities'

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

describe('candidate_merge_log fuzzy dedup logging (#751 bugs 2 & 3)', () => {
  it('logs an org-wide near-match even when both entities have no area', async () => {
    const db = await setup()

    // First ingest: clean business
    const first = await findOrCreateEntity(db, ORG, {
      name: 'Sonoran Desert Plumbing',
      source_pipeline: 'job_monitor',
    })
    expect(first.status).toBe('created')

    // Second ingest: typo'd version of the same name. Slug differs but
    // Jaro-Winkler scores well above the 0.92 default threshold. Area
    // is null on both — pre-fix this would have silently bailed out
    // via `if (!data.area) return`.
    const second = await findOrCreateEntity(db, ORG, {
      name: 'Sonaran Desert Plumbing',
      source_pipeline: 'new_business',
    })
    expect(second.status).toBe('created')

    const rows = await db
      .prepare(`SELECT * FROM candidate_merge_log WHERE org_id = ?`)
      .bind(ORG)
      .all<{
        candidate_name: string
        matched_name: string
        score: number
        reason: string
        source_pipeline: string
      }>()
    expect(rows.results.length).toBe(1)
    const row = rows.results[0]
    expect(row.candidate_name).toBe('Sonaran Desert Plumbing')
    expect(row.matched_name).toBe('Sonoran Desert Plumbing')
    expect(row.reason).toBe('slug_fuzzy_match')
    expect(row.score).toBeGreaterThan(0.92)
  })

  it('does not log when no candidate clears the fuzzy threshold', async () => {
    const db = await setup()

    await findOrCreateEntity(db, ORG, {
      name: 'Sonoran Electric LLC',
      source_pipeline: 'job_monitor',
    })
    await findOrCreateEntity(db, ORG, {
      name: 'High Desert Veterinary Group',
      source_pipeline: 'job_monitor',
    })

    const rows = await db
      .prepare(`SELECT COUNT(*) AS n FROM candidate_merge_log WHERE org_id = ?`)
      .bind(ORG)
      .first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })

  it('exact-name re-ingest hits the slug UNIQUE check, not the fuzzy logger', async () => {
    // Same business, two slightly different area strings from SerpAPI.
    // Pre-#751: each created a new entity (slug included area). Post-fix:
    // slug is name-only, second call returns the first entity.
    const db = await setup()

    const first = await findOrCreateEntity(db, ORG, {
      name: 'Old Town Towing',
      area: 'Phoenix, AZ',
      source_pipeline: 'job_monitor',
    })
    expect(first.status).toBe('created')

    const second = await findOrCreateEntity(db, ORG, {
      name: 'Old Town Towing',
      area: 'Phoenix, AZ, United States',
      source_pipeline: 'job_monitor',
    })
    expect(second.status).toBe('found')
    expect(second.entity.id).toBe(first.entity.id)

    // No fuzzy-log row: the slug check matched directly.
    const rows = await db
      .prepare(`SELECT COUNT(*) AS n FROM candidate_merge_log WHERE org_id = ?`)
      .bind(ORG)
      .first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })
})
