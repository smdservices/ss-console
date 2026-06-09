/**
 * Tests for the people & access view-model (src/lib/admin/people-view.ts) —
 * admin Operator console §5.7.
 *
 * Seeds product_roles + users in a test D1 and asserts: roles group per user in
 * canonical order, revoked roles are excluded, non-operator product roles are
 * ignored, unknown role strings are dropped (not guessed), and principalCount
 * reflects the onboarding invariant.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import { ORG_ID } from '../src/lib/constants'
import { listOperatorUsers, principalCount, roleBadge } from '../src/lib/admin/people-view'

const migrationsDir = resolve(process.cwd(), 'migrations')
const ENTITY_ID = 'ent-people'

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  // ORG_ID (the SMD org) is seeded by migrations — do not re-insert it.
  await db
    .prepare(`INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, 'Acme', 'acme')`)
    .bind(ENTITY_ID, ORG_ID)
    .run()
  return db
}

async function addUser(db: D1Database, id: string, email: string, name: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO users (id, org_id, email, name, role, created_at)
       VALUES (?, ?, ?, ?, 'client', datetime('now'))`
    )
    .bind(id, ORG_ID, email, name)
    .run()
}

async function grant(
  db: D1Database,
  id: string,
  userId: string,
  role: string,
  opts: { product?: string; revoked?: boolean } = {}
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO product_roles
         (id, org_id, user_id, entity_id, product_slug, role, granted_by, granted_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, datetime('now'), ?)`
    )
    .bind(
      id,
      ORG_ID,
      userId,
      ENTITY_ID,
      opts.product ?? 'operator',
      role,
      opts.revoked ? '2026-06-01T00:00:00Z' : null
    )
    .run()
}

describe('listOperatorUsers', () => {
  let db: D1Database
  beforeEach(async () => {
    db = await freshDb()
  })

  it('returns [] when no users hold operator roles', async () => {
    expect(await listOperatorUsers(db, ENTITY_ID)).toEqual([])
  })

  it('groups multiple roles per user in canonical order', async () => {
    await addUser(db, 'u1', 'owner@acme.test', 'Owner')
    await grant(db, 'r1', 'u1', 'compliance')
    await grant(db, 'r2', 'u1', 'principal')
    const users = await listOperatorUsers(db, ENTITY_ID)
    expect(users).toHaveLength(1)
    expect(users[0].roles).toEqual(['principal', 'compliance']) // canonical order
    expect(users[0].email).toBe('owner@acme.test')
  })

  it('excludes revoked roles and non-operator product roles', async () => {
    await addUser(db, 'u1', 'a@acme.test', 'A')
    await grant(db, 'r1', 'u1', 'staff', { revoked: true })
    await grant(db, 'r2', 'u1', 'principal', { product: 'some-other-product' })
    // u1 has only a revoked operator role and a different-product role → not listed.
    expect(await listOperatorUsers(db, ENTITY_ID)).toEqual([])
  })

  it('drops unknown role strings rather than guessing', async () => {
    await addUser(db, 'u1', 'a@acme.test', 'A')
    await grant(db, 'r1', 'u1', 'staff')
    await grant(db, 'r2', 'u1', 'superuser') // not a client role
    const users = await listOperatorUsers(db, ENTITY_ID)
    expect(users[0].roles).toEqual(['staff'])
  })

  it('lists multiple users ordered by email', async () => {
    await addUser(db, 'u2', 'zed@acme.test', 'Zed')
    await addUser(db, 'u1', 'amy@acme.test', 'Amy')
    await grant(db, 'r1', 'u2', 'staff')
    await grant(db, 'r2', 'u1', 'principal')
    const users = await listOperatorUsers(db, ENTITY_ID)
    expect(users.map((u) => u.email)).toEqual(['amy@acme.test', 'zed@acme.test'])
  })
})

describe('principalCount', () => {
  it('counts users holding the principal role', () => {
    expect(
      principalCount([
        { user_id: 'a', email: 'a', name: null, roles: ['principal'] },
        { user_id: 'b', email: 'b', name: null, roles: ['staff', 'compliance'] },
        { user_id: 'c', email: 'c', name: null, roles: ['principal', 'staff'] },
      ])
    ).toBe(2)
    expect(principalCount([])).toBe(0)
  })
})

describe('roleBadge', () => {
  it('maps every client role to a token-based badge', () => {
    expect(roleBadge('principal').label).toBe('Principal')
    expect(roleBadge('staff').classes).toContain('--ss-color-complete')
    expect(roleBadge('compliance').label).toBe('Compliance')
  })
})
