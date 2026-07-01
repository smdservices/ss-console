import { beforeEach, describe, expect, it } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
} from '@venturecrane/crane-test-harness'
import type { D1Database } from '@cloudflare/workers-types'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  listGeneratorSignalDays,
  listGeneratorSignals,
  loadAveragePainScore,
  loadPipelineMetrics,
} from '../src/lib/admin/generator-readers'
import { getMagicLinkClientUser, recordUserLogin } from '../src/lib/auth/magic-link-users'
import { listFollowUpEntityNames } from '../src/lib/db/follow-ups'
import { appendContextRaw } from '../src/lib/db/context'

const migrationsDir = resolve(process.cwd(), 'migrations')
const ORG_ID = 'page-reader-org'
const OTHER_ORG_ID = 'page-reader-other-org'

describe('page SQL boundary', () => {
  it('keeps raw D1 prepares out of Astro page frontmatter', () => {
    const offenders = astroPages(resolve(process.cwd(), 'src/pages')).filter((file) =>
      readFileSync(file, 'utf8').includes('env.DB.prepare')
    )

    expect(offenders).toEqual([])
  })
})

describe('page reader helpers', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await seedOrgs(db)
  })

  it('loads generator dashboard metrics through org and pipeline scope', async () => {
    await seedSignalEntity(db, ORG_ID, 'signal-a', 'Alpha', 'review_mining', {
      painScore: 8,
      vertical: 'legal',
      area: 'Phoenix',
      employeeCount: 12,
      tier: 'hot',
      createdAt: new Date().toISOString(),
    })
    await seedSignalEntity(db, ORG_ID, 'signal-b', 'Beta', 'review_mining', {
      painScore: null,
      vertical: 'legal',
      area: null,
      employeeCount: null,
      tier: null,
      createdAt: new Date().toISOString(),
    })
    await seedSignalEntity(db, OTHER_ORG_ID, 'signal-c', 'Other', 'review_mining', {
      painScore: 10,
      vertical: 'medical',
      area: 'Tucson',
      employeeCount: 20,
      tier: 'warm',
      createdAt: new Date().toISOString(),
    })

    const metrics = await loadPipelineMetrics(db, ORG_ID, 'review_mining')
    const avg = await loadAveragePainScore(db, ORG_ID, 'review_mining')

    expect(metrics.total_signals).toBe(2)
    expect(metrics.has_pain).toBe(1)
    expect(metrics.top_vertical).toBe('legal')
    expect(metrics.top_vertical_count).toBe(2)
    expect(avg).toBe(8)
  })

  it('loads generator detail rows and deduplicates joined signal context', async () => {
    await seedSignalEntity(db, ORG_ID, 'signal-a', 'Alpha', 'job_monitor', {
      painScore: 5,
      vertical: 'logistics',
      area: 'Mesa',
      employeeCount: 30,
      tier: 'cool',
      createdAt: '2026-07-01T10:00:00.000Z',
    })
    await appendContextRaw(db, ORG_ID, {
      entity_id: 'signal-a',
      type: 'signal',
      content: 'older context',
      source: 'job_monitor',
      created_at: '2026-07-01T10:01:00.000Z',
    })
    await appendContextRaw(db, ORG_ID, {
      entity_id: 'signal-a',
      type: 'signal',
      content: 'newer context',
      source: 'job_monitor',
      created_at: '2026-07-01T10:02:00.000Z',
    })

    const signals = await listGeneratorSignals(db, ORG_ID, 'job_monitor')
    const days = await listGeneratorSignalDays(db, ORG_ID, 'job_monitor')

    expect(signals).toHaveLength(1)
    expect(signals[0]?.context_content).toBe('newer context')
    expect(days).toEqual([{ day: '2026-07-01', count: 1 }])
  })

  it('loads follow-up entity names through org scope', async () => {
    await seedEntity(db, ORG_ID, 'entity-a', 'A Client')
    await seedEntity(db, OTHER_ORG_ID, 'entity-b', 'Other Client')

    const names = await listFollowUpEntityNames(db, ORG_ID, ['entity-a', 'entity-b'])

    expect(names).toEqual({ 'entity-a': 'A Client' })
  })

  it('loads magic-link client users and records last login', async () => {
    await seedEntity(db, ORG_ID, 'entity-a', 'A Client')
    await db
      .prepare(
        `INSERT INTO users (id, org_id, email, name, role, entity_id)
         VALUES ('user-a', ?, 'client@example.com', 'Client User', 'client', 'entity-a')`
      )
      .bind(ORG_ID)
      .run()

    const user = await getMagicLinkClientUser(db, ORG_ID, 'user-a')
    await recordUserLogin(db, 'user-a')
    const row = await db
      .prepare('SELECT last_login_at FROM users WHERE id = ?')
      .bind('user-a')
      .first<{ last_login_at: string | null }>()

    expect(user?.email).toBe('client@example.com')
    expect(row?.last_login_at).toBeTruthy()
    await expect(getMagicLinkClientUser(db, OTHER_ORG_ID, 'user-a')).resolves.toBeNull()
  })
})

function astroPages(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      files.push(...astroPages(path))
    } else if (path.endsWith('.astro')) {
      files.push(path)
    }
  }
  return files
}

async function seedOrgs(db: D1Database): Promise<void> {
  await db
    .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
    .bind(ORG_ID, 'Page Reader Org', ORG_ID)
    .run()
  await db
    .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
    .bind(OTHER_ORG_ID, 'Page Reader Other Org', OTHER_ORG_ID)
    .run()
}

async function seedEntity(
  db: D1Database,
  orgId: string,
  entityId: string,
  name: string
): Promise<void> {
  await db
    .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
    .bind(entityId, orgId, name, entityId)
    .run()
}

async function seedSignalEntity(
  db: D1Database,
  orgId: string,
  entityId: string,
  name: string,
  pipeline: string,
  data: {
    painScore: number | null
    vertical: string | null
    area: string | null
    employeeCount: number | null
    tier: string | null
    createdAt: string
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO entities (
         id, org_id, name, slug, stage, source_pipeline, pain_score, vertical,
         area, employee_count, tier, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, 'signal', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      entityId,
      orgId,
      name,
      entityId,
      pipeline,
      data.painScore,
      data.vertical,
      data.area,
      data.employeeCount,
      data.tier,
      data.createdAt,
      data.createdAt
    )
    .run()
}
