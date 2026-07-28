import { beforeEach, describe, expect, it } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
} from '@venturecrane/crane-test-harness'
import type { D1Database } from '@cloudflare/workers-types'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getMagicLinkClientUser, recordUserLogin } from '../src/lib/auth/magic-link-users'
import { listFollowUpEntityNames } from '../src/lib/db/follow-ups'

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
    if (!user) throw new Error('expected magic-link user row')
    await recordUserLogin(db, user)
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
