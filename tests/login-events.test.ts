import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'

import { recordClerkLogin, stampLoginIfNewSession } from '../src/lib/auth/login-events'
import { ORG_ID } from '../src/lib/constants'

const migrationsDir = resolve(process.cwd(), 'migrations')

const USER_ID = 'user-login-events'
const EMAIL = 'principal@firm.example'
const CLERK_USER = 'user_clerk_abc'
const ENTITY_ID = 'entity-login-events'

async function countLoginEvents(db: D1Database): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM portal_login_events')
    .first<{ n: number }>()
  return row?.n ?? 0
}

async function userStamp(
  db: D1Database
): Promise<{ last_login_at: string | null; last_clerk_session_id: string | null }> {
  const row = await db
    .prepare('SELECT last_login_at, last_clerk_session_id FROM users WHERE id = ?')
    .bind(USER_ID)
    .first<{ last_login_at: string | null; last_clerk_session_id: string | null }>()
  if (!row) throw new Error('user row missing')
  return row
}

describe('recordClerkLogin', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await db
      .prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .bind(ORG_ID, 'SMD Services', 'smd-services')
      .run()
    await db
      .prepare(
        `INSERT INTO users (id, org_id, email, name, role, clerk_user_id)
         VALUES (?, ?, ?, 'Principal', 'client', ?)`
      )
      .bind(USER_ID, ORG_ID, EMAIL, CLERK_USER)
      .run()
  })

  const input = (sessionId: string) => ({
    userId: USER_ID,
    entityId: ENTITY_ID,
    email: EMAIL,
    clerkUserId: CLERK_USER,
    clerkSessionId: sessionId,
  })

  it('first sighting of a session inserts one history row and stamps the user', async () => {
    const recorded = await recordClerkLogin(db, input('sess_1'))
    expect(recorded).toBe(true)
    expect(await countLoginEvents(db)).toBe(1)
    const stamp = await userStamp(db)
    expect(stamp.last_login_at).not.toBeNull()
    expect(stamp.last_clerk_session_id).toBe('sess_1')
  })

  it('repeat of the same session id is a no-op (INSERT OR IGNORE guard)', async () => {
    await recordClerkLogin(db, input('sess_1'))
    const firstStamp = await userStamp(db)
    const recorded = await recordClerkLogin(db, input('sess_1'))
    expect(recorded).toBe(false)
    expect(await countLoginEvents(db)).toBe(1)
    // The stamp is untouched — no churn on repeat requests.
    expect(await userStamp(db)).toEqual(firstStamp)
  })

  it('multi-device alternation (A, B, A) records exactly two logins', async () => {
    expect(await recordClerkLogin(db, input('sess_A'))).toBe(true)
    expect(await recordClerkLogin(db, input('sess_B'))).toBe(true)
    // Device A's next request: its session already has a history row, so the
    // stale skip cache (now sess_B) must NOT cause a phantom third login.
    expect(await recordClerkLogin(db, input('sess_A'))).toBe(false)
    expect(await countLoginEvents(db)).toBe(2)
  })

  it('coexists with magic-link rows (NULL session ids do not collide)', async () => {
    for (let i = 0; i < 2; i++) {
      await db
        .prepare(
          `INSERT INTO portal_login_events
             (id, user_id, entity_id, email, clerk_user_id, clerk_session_id, method, created_at)
           VALUES (?, ?, ?, ?, NULL, NULL, 'magic_link', ?)`
        )
        .bind(crypto.randomUUID(), USER_ID, ENTITY_ID, EMAIL, new Date().toISOString())
        .run()
    }
    await recordClerkLogin(db, input('sess_1'))
    expect(await countLoginEvents(db)).toBe(3)
  })
})

describe('stampLoginIfNewSession', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await db
      .prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .bind(ORG_ID, 'SMD Services', 'smd-services')
      .run()
    await db
      .prepare(
        `INSERT INTO users (id, org_id, email, name, role, clerk_user_id)
         VALUES (?, ?, ?, 'Principal', 'client', ?)`
      )
      .bind(USER_ID, ORG_ID, EMAIL, CLERK_USER)
      .run()
  })

  const userRow = (lastSession: string | null) => ({
    id: USER_ID,
    email: EMAIL,
    clerk_user_id: CLERK_USER,
    last_clerk_session_id: lastSession,
  })

  it('records a login for a new session', async () => {
    await stampLoginIfNewSession(db, userRow(null), 'sess_1', ENTITY_ID)
    expect(await countLoginEvents(db)).toBe(1)
  })

  it('skip cache: same session id does nothing (no DB writes attempted)', async () => {
    const throwingDb = {
      prepare() {
        throw new Error('must not touch the DB on the cached path')
      },
    } as unknown as D1Database
    await stampLoginIfNewSession(throwingDb, userRow('sess_1'), 'sess_1', ENTITY_ID)
  })

  it('missing session id does nothing', async () => {
    await stampLoginIfNewSession(db, userRow(null), null, ENTITY_ID)
    await stampLoginIfNewSession(db, userRow(null), undefined, ENTITY_ID)
    expect(await countLoginEvents(db)).toBe(0)
  })

  it('never throws when the DB write fails (auth must not break)', async () => {
    const throwingDb = {
      prepare() {
        throw new Error('boom')
      },
    } as unknown as D1Database
    await expect(
      stampLoginIfNewSession(throwingDb, userRow(null), 'sess_1', ENTITY_ID)
    ).resolves.toBeUndefined()
  })

  it('routes the write through waitUntil when provided', async () => {
    const waitUntil = vi.fn()
    await stampLoginIfNewSession(db, userRow(null), 'sess_1', ENTITY_ID, waitUntil)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    await waitUntil.mock.calls[0][0]
    expect(await countLoginEvents(db)).toBe(1)
  })
})
