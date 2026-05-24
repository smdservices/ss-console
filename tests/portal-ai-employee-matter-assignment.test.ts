/**
 * Tests for the matter assignment resolver + mutations
 * (src/lib/portal/ai-employee/matter-assignment.ts).
 *
 * Backs the per-#882 multi-paralegal assignment surface. Covers:
 *
 *   - assignMatter: idempotency on active grant, fresh-grant after
 *     soft-clear, both branches return the right boolean
 *   - unassignMatter: idempotency on cleared/missing rows, returns
 *     true exactly when a row flipped from active to cleared
 *   - listMatterAssignments: returns only the currently-active set;
 *     stitches in the assignee email + name via JOIN; respects ordering
 *   - listAssignedMatterIdsForUser: returns a Set of opaque matter ids
 *     for the caller; honors entity scoping
 *   - parseMatterScope: defensive parsing — unknown values fall back to
 *     'all' so a stale bookmark cannot silently scope a partner's list
 *     to empty
 */

import { describe, it, expect } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import { ORG_ID } from '../src/lib/constants'
import {
  assignMatter,
  listAssignedMatterIdsForUser,
  listMatterAssignments,
  parseMatterScope,
  unassignMatter,
} from '../src/lib/portal/ai-employee/matter-assignment'

const migrationsDir = resolve(process.cwd(), 'migrations')

const ENTITY_A = 'entity-a'
const ENTITY_B = 'entity-b'
const USER_PAT = 'user-pat'
const USER_ALEX = 'user-alex'
const MATTER_SMITH = 'matter-smith'
const MATTER_JONES = 'matter-jones'

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  await db
    .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
    .bind(ENTITY_A, ORG_ID, 'Entity A', 'entity-a')
    .run()
  await db
    .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
    .bind(ENTITY_B, ORG_ID, 'Entity B', 'entity-b')
    .run()
  await db
    .prepare(
      `INSERT INTO users (id, org_id, email, name, role, entity_id)
       VALUES (?, ?, ?, ?, 'client', ?)`
    )
    .bind(USER_PAT, ORG_ID, 'pat@firm.com', 'Pat Owner', ENTITY_A)
    .run()
  await db
    .prepare(
      `INSERT INTO users (id, org_id, email, name, role, entity_id)
       VALUES (?, ?, ?, ?, 'client', ?)`
    )
    .bind(USER_ALEX, ORG_ID, 'alex@firm.com', 'Alex Paralegal', ENTITY_A)
    .run()
  return db
}

describe('assignMatter', () => {
  it('inserts a fresh active assignment and returns true', async () => {
    const db = await freshDb()
    const ok = await assignMatter(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      assignedBy: USER_PAT,
    })
    expect(ok).toBe(true)
    const rows = await listMatterAssignments(db, ENTITY_A, MATTER_SMITH)
    expect(rows).toHaveLength(1)
    expect(rows[0].assigneeUserId).toBe(USER_ALEX)
    expect(rows[0].assigneeEmail).toBe('alex@firm.com')
    expect(rows[0].assigneeName).toBe('Alex Paralegal')
    expect(rows[0].assignedBy).toBe(USER_PAT)
  })

  it('is idempotent: re-grant of an active assignment is a no-op', async () => {
    const db = await freshDb()
    await assignMatter(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      assignedBy: USER_PAT,
    })
    const second = await assignMatter(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      assignedBy: USER_PAT,
    })
    expect(second).toBe(false)
    const rows = await listMatterAssignments(db, ENTITY_A, MATTER_SMITH)
    expect(rows).toHaveLength(1)
  })

  it('re-assigns after an unassign by inserting a new row', async () => {
    const db = await freshDb()
    await assignMatter(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      assignedBy: USER_PAT,
    })
    await unassignMatter(db, {
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      unassignedBy: USER_PAT,
    })
    const ok = await assignMatter(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      assignedBy: USER_PAT,
    })
    expect(ok).toBe(true)
    const rows = await listMatterAssignments(db, ENTITY_A, MATTER_SMITH)
    expect(rows).toHaveLength(1)
  })
})

describe('unassignMatter', () => {
  it('returns true when a row flipped from active to cleared', async () => {
    const db = await freshDb()
    await assignMatter(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      assignedBy: USER_PAT,
    })
    const ok = await unassignMatter(db, {
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      unassignedBy: USER_PAT,
    })
    expect(ok).toBe(true)
    const rows = await listMatterAssignments(db, ENTITY_A, MATTER_SMITH)
    expect(rows).toHaveLength(0)
  })

  it('returns false when no active row exists', async () => {
    const db = await freshDb()
    const ok = await unassignMatter(db, {
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      unassignedBy: USER_PAT,
    })
    expect(ok).toBe(false)
  })

  it('is idempotent: double-unassign returns false the second time', async () => {
    const db = await freshDb()
    await assignMatter(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      assignedBy: USER_PAT,
    })
    const first = await unassignMatter(db, {
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      unassignedBy: USER_PAT,
    })
    const second = await unassignMatter(db, {
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      unassignedBy: USER_PAT,
    })
    expect(first).toBe(true)
    expect(second).toBe(false)
  })
})

describe('listMatterAssignments', () => {
  it('returns multiple active assignments for a co-counsel matter', async () => {
    const db = await freshDb()
    await assignMatter(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      assignedBy: USER_PAT,
    })
    await assignMatter(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_PAT,
      assignedBy: USER_PAT,
    })
    const rows = await listMatterAssignments(db, ENTITY_A, MATTER_SMITH)
    expect(rows).toHaveLength(2)
    const ids = new Set(rows.map((r) => r.assigneeUserId))
    expect(ids).toEqual(new Set([USER_ALEX, USER_PAT]))
  })

  it('does not surface cleared assignments', async () => {
    const db = await freshDb()
    await assignMatter(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      assignedBy: USER_PAT,
    })
    await unassignMatter(db, {
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      unassignedBy: USER_PAT,
    })
    const rows = await listMatterAssignments(db, ENTITY_A, MATTER_SMITH)
    expect(rows).toHaveLength(0)
  })
})

describe('listAssignedMatterIdsForUser', () => {
  it('returns the active matter id set for a user', async () => {
    const db = await freshDb()
    await assignMatter(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      assignedBy: USER_PAT,
    })
    await assignMatter(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      matterId: MATTER_JONES,
      assigneeUserId: USER_ALEX,
      assignedBy: USER_PAT,
    })
    const ids = await listAssignedMatterIdsForUser(db, ENTITY_A, USER_ALEX)
    expect(ids).toEqual(new Set([MATTER_SMITH, MATTER_JONES]))
  })

  it('does not leak assignments across entities', async () => {
    const db = await freshDb()
    await assignMatter(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      matterId: MATTER_SMITH,
      assigneeUserId: USER_ALEX,
      assignedBy: USER_PAT,
    })
    const idsA = await listAssignedMatterIdsForUser(db, ENTITY_A, USER_ALEX)
    const idsB = await listAssignedMatterIdsForUser(db, ENTITY_B, USER_ALEX)
    expect(idsA.has(MATTER_SMITH)).toBe(true)
    expect(idsB.size).toBe(0)
  })

  it('returns empty Set when user has no active assignments', async () => {
    const db = await freshDb()
    const ids = await listAssignedMatterIdsForUser(db, ENTITY_A, USER_ALEX)
    expect(ids.size).toBe(0)
  })
})

describe('parseMatterScope', () => {
  it('returns "mine" for the canonical value', () => {
    expect(parseMatterScope('mine')).toBe('mine')
  })

  it('returns "all" for the canonical value', () => {
    expect(parseMatterScope('all')).toBe('all')
  })

  it('falls back to "all" for null / missing input', () => {
    expect(parseMatterScope(null)).toBe('all')
    expect(parseMatterScope(undefined)).toBe('all')
  })

  it('falls back to "all" for unknown / stale values', () => {
    expect(parseMatterScope('assigned')).toBe('all')
    expect(parseMatterScope('MINE')).toBe('all')
    expect(parseMatterScope('')).toBe('all')
  })
})
