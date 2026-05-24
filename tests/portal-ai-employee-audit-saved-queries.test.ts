/**
 * Tests for per-user audit-log saved queries
 * (src/lib/portal/ai-employee/audit-saved-queries.ts), per issue #896.
 *
 * Covers the validate / save / list / delete CRUD flow against a real
 * test D1 (migrations applied) plus the URL round-trip helpers the
 * page uses to re-apply a saved filter set.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import {
  countSavedQueries,
  deleteSavedQuery,
  listSavedQueries,
  paramsForSave,
  savedQueryToSearchParams,
  upsertSavedQuery,
  validateSavedQueryName,
  MAX_SAVED_QUERY_NAME_LENGTH,
} from '../src/lib/portal/ai-employee/audit-saved-queries'
import {
  DEFAULT_AUDIT_PAGE_SIZE,
  parseAuditListParams,
  type AuditListParams,
} from '../src/lib/portal/ai-employee/audit'
import { ORG_ID } from '../src/lib/constants'

const migrationsDir = resolve(process.cwd(), 'migrations')

const ENTITY_ID = 'ent-saved-queries-test'
const USER_ID = 'usr-saved-queries-test'
const OTHER_USER_ID = 'usr-other'

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  return db
}

async function seedEntityAndUser(db: D1Database, userId: string = USER_ID): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
    .bind(ENTITY_ID, ORG_ID, 'Saved-Queries Test Firm', `saved-queries-${ENTITY_ID}`)
    .run()
  await db
    .prepare(
      `INSERT OR IGNORE INTO users (id, org_id, email, name, role, entity_id, clerk_user_id)
       VALUES (?, ?, ?, ?, 'client', ?, ?)`
    )
    .bind(userId, ORG_ID, `${userId}@firm.com`, userId, ENTITY_ID, `clerk_${userId}`)
    .run()
}

function paramsFromUrl(qs: string): AuditListParams {
  return parseAuditListParams(new URLSearchParams(qs))
}

describe('validateSavedQueryName', () => {
  it('accepts a trimmed non-empty name', () => {
    const r = validateSavedQueryName('  My saved query  ')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.name).toBe('My saved query')
  })

  it('rejects empty / whitespace-only names', () => {
    expect(validateSavedQueryName('')).toEqual({ ok: false, error: 'empty' })
    expect(validateSavedQueryName('   ')).toEqual({ ok: false, error: 'empty' })
    expect(validateSavedQueryName(null)).toEqual({ ok: false, error: 'empty' })
    expect(validateSavedQueryName(undefined)).toEqual({ ok: false, error: 'empty' })
  })

  it('rejects names exceeding the max length', () => {
    const long = 'a'.repeat(MAX_SAVED_QUERY_NAME_LENGTH + 1)
    expect(validateSavedQueryName(long)).toEqual({ ok: false, error: 'too_long' })
  })
})

describe('paramsForSave', () => {
  it('strips the page field from AuditListParams', () => {
    const params = paramsFromUrl('skill=intake&page=4')
    const stored = paramsForSave({ ...params, page: 4 })
    expect('page' in stored).toBe(false)
    expect(stored.skills).toEqual(['intake'])
    expect(stored.pageSize).toBe(DEFAULT_AUDIT_PAGE_SIZE)
  })
})

describe('savedQueryToSearchParams — round-trip', () => {
  it('reconstructs a URL string the parser accepts', () => {
    const params = paramsFromUrl(
      'skill=intake&action=DRAFT_CREATED&actor=agent&decision=allow&from=2026-01-01&to=2026-01-31&matter=smith&q=privileged&sort=ts_asc&pageSize=50'
    )
    const stored = paramsForSave({ ...params, page: 1 })
    const sp = savedQueryToSearchParams({
      id: 'x',
      name: 'n',
      params: stored,
      createdAt: '2026-05-21T00:00:00Z',
      updatedAt: '2026-05-21T00:00:00Z',
    })
    const reparsed = parseAuditListParams(sp)
    expect(reparsed.skills).toEqual(['intake'])
    expect(reparsed.actions).toEqual(['DRAFT_CREATED'])
    expect(reparsed.actors).toEqual(['agent'])
    expect(reparsed.decisions).toEqual(['allow'])
    expect(reparsed.from).toBe('2026-01-01')
    expect(reparsed.to).toBe('2026-01-31')
    expect(reparsed.matter).toBe('smith')
    expect(reparsed.q).toBe('privileged')
    expect(reparsed.sort).toBe('ts_asc')
    expect(reparsed.pageSize).toBe(50)
  })

  it('omits defaults (sort=ts_desc, pageSize=default) to keep the URL clean', () => {
    const params = paramsForSave({ ...paramsFromUrl(''), page: 1 })
    const sp = savedQueryToSearchParams({
      id: 'x',
      name: 'n',
      params,
      createdAt: '2026-05-21T00:00:00Z',
      updatedAt: '2026-05-21T00:00:00Z',
    })
    expect(sp.has('sort')).toBe(false)
    expect(sp.has('pageSize')).toBe(false)
  })
})

describe('saved-queries persistence', () => {
  let db: D1Database

  beforeEach(async () => {
    db = await freshDb()
    await seedEntityAndUser(db)
  })

  it('inserts a new saved query and lists it back', async () => {
    const params = paramsFromUrl('skill=intake&q=privileged')
    const id = await upsertSavedQuery(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      entityId: ENTITY_ID,
      name: 'Privileged intake',
      params: paramsForSave({ ...params, page: 1 }),
    })
    expect(typeof id).toBe('string')
    const list = await listSavedQueries(db, USER_ID, ENTITY_ID)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(id)
    expect(list[0].name).toBe('Privileged intake')
    expect(list[0].params.skills).toEqual(['intake'])
    expect(list[0].params.q).toBe('privileged')
  })

  it('upserts on (user_id, entity_id, name) — re-save overwrites', async () => {
    const id1 = await upsertSavedQuery(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      entityId: ENTITY_ID,
      name: 'Same name',
      params: paramsForSave({ ...paramsFromUrl('skill=intake'), page: 1 }),
    })
    const id2 = await upsertSavedQuery(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      entityId: ENTITY_ID,
      name: 'Same name',
      params: paramsForSave({ ...paramsFromUrl('skill=deadline'), page: 1 }),
    })
    expect(id1).toBe(id2)
    const list = await listSavedQueries(db, USER_ID, ENTITY_ID)
    expect(list).toHaveLength(1)
    expect(list[0].params.skills).toEqual(['deadline'])
  })

  it('countSavedQueries returns the current count per (user, entity)', async () => {
    expect(await countSavedQueries(db, USER_ID, ENTITY_ID)).toBe(0)
    await upsertSavedQuery(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      entityId: ENTITY_ID,
      name: 'one',
      params: paramsForSave({ ...paramsFromUrl(''), page: 1 }),
    })
    await upsertSavedQuery(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      entityId: ENTITY_ID,
      name: 'two',
      params: paramsForSave({ ...paramsFromUrl(''), page: 1 }),
    })
    expect(await countSavedQueries(db, USER_ID, ENTITY_ID)).toBe(2)
  })

  it('listSavedQueries scopes to (user_id, entity_id)', async () => {
    await seedEntityAndUser(db, OTHER_USER_ID)
    await upsertSavedQuery(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      entityId: ENTITY_ID,
      name: 'mine',
      params: paramsForSave({ ...paramsFromUrl(''), page: 1 }),
    })
    await upsertSavedQuery(db, {
      orgId: ORG_ID,
      userId: OTHER_USER_ID,
      entityId: ENTITY_ID,
      name: 'theirs',
      params: paramsForSave({ ...paramsFromUrl(''), page: 1 }),
    })
    const mine = await listSavedQueries(db, USER_ID, ENTITY_ID)
    const theirs = await listSavedQueries(db, OTHER_USER_ID, ENTITY_ID)
    expect(mine.map((q) => q.name)).toEqual(['mine'])
    expect(theirs.map((q) => q.name)).toEqual(['theirs'])
  })

  it('deleteSavedQuery removes the row when (id, user, entity) match', async () => {
    const id = await upsertSavedQuery(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      entityId: ENTITY_ID,
      name: 'drop me',
      params: paramsForSave({ ...paramsFromUrl(''), page: 1 }),
    })
    const changed = await deleteSavedQuery(db, { userId: USER_ID, entityId: ENTITY_ID, id })
    expect(changed).toBe(1)
    const list = await listSavedQueries(db, USER_ID, ENTITY_ID)
    expect(list).toHaveLength(0)
  })

  it("deleteSavedQuery is a no-op for another user's row id", async () => {
    await seedEntityAndUser(db, OTHER_USER_ID)
    const otherId = await upsertSavedQuery(db, {
      orgId: ORG_ID,
      userId: OTHER_USER_ID,
      entityId: ENTITY_ID,
      name: 'theirs',
      params: paramsForSave({ ...paramsFromUrl(''), page: 1 }),
    })
    const changed = await deleteSavedQuery(db, {
      userId: USER_ID,
      entityId: ENTITY_ID,
      id: otherId,
    })
    expect(changed).toBe(0)
    const stillThere = await listSavedQueries(db, OTHER_USER_ID, ENTITY_ID)
    expect(stillThere).toHaveLength(1)
  })

  it('drops malformed query_json rows from the listing rather than throwing', async () => {
    await db
      .prepare(
        `INSERT INTO audit_saved_queries
          (id, org_id, user_id, entity_id, name, query_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        'malformed-row',
        ORG_ID,
        USER_ID,
        ENTITY_ID,
        'broken',
        'not even json',
        '2026-05-21T00:00:00Z',
        '2026-05-21T00:00:00Z'
      )
      .run()
    await upsertSavedQuery(db, {
      orgId: ORG_ID,
      userId: USER_ID,
      entityId: ENTITY_ID,
      name: 'good',
      params: paramsForSave({ ...paramsFromUrl('skill=intake'), page: 1 }),
    })
    const list = await listSavedQueries(db, USER_ID, ENTITY_ID)
    expect(list.map((q) => q.name)).toEqual(['good'])
  })
})
