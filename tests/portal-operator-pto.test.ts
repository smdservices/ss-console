/**
 * Tests for the user PTO / OOO resolver + mutations
 * (src/lib/portal/operator/pto.ts).
 *
 * Backs the per-#882 self-service away-state surface.  Covers:
 *
 *   - getActivePto: returns the active row (with backup-user JOIN
 *     fields) or null when none is active
 *   - listActivePto: firm-wide active set, ordered by most-recently-set
 *   - setPto: backup validation (self / unknown_user / no_product_role),
 *     idempotency on already-active row
 *   - clearPto: idempotency, returns true exactly when a row flipped
 *     from active to cleared
 *   - updatePtoBackup: validates the new backup the same way as setPto,
 *     reports not_away when there is no active row
 *
 * The principal-or-self authorization gate is enforced in the API
 * endpoint, not the lib — the lib accepts a setBy parameter so the test
 * suite does not need to wire Clerk session state.
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
  clearPto,
  getActivePto,
  listActivePto,
  setPto,
  updatePtoBackup,
} from '../src/lib/portal/operator/pto'

const migrationsDir = resolve(process.cwd(), 'migrations')

const ENTITY_A = 'entity-a'
const USER_PAT = 'user-pat'
const USER_ALEX = 'user-alex'
const USER_JAMIE = 'user-jamie'
const PRODUCT_SLUG = 'operator'

async function freshDb(): Promise<D1Database> {
  const db = createTestD1()
  await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
  await db
    .prepare('INSERT INTO entities (id, org_id, name, slug) VALUES (?, ?, ?, ?)')
    .bind(ENTITY_A, ORG_ID, 'Entity A', 'entity-a')
    .run()
  for (const [id, email, name] of [
    [USER_PAT, 'pat@firm.com', 'Pat Owner'],
    [USER_ALEX, 'alex@firm.com', 'Alex Paralegal'],
    [USER_JAMIE, 'jamie@firm.com', 'Jamie Paralegal'],
  ]) {
    await db
      .prepare(
        `INSERT INTO users (id, org_id, email, name, role, entity_id)
         VALUES (?, ?, ?, ?, 'client', ?)`
      )
      .bind(id, ORG_ID, email, name, ENTITY_A)
      .run()
  }
  return db
}

async function grantRole(db: D1Database, userId: string, role: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO product_roles (id, org_id, user_id, entity_id, product_slug, role)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(`pr-${userId}-${role}`, ORG_ID, userId, ENTITY_A, PRODUCT_SLUG, role)
    .run()
}

describe('setPto', () => {
  it('inserts a fresh PTO row when no active one exists', async () => {
    const db = await freshDb()
    await grantRole(db, USER_ALEX, 'staff')
    await grantRole(db, USER_JAMIE, 'staff')
    const result = await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: USER_JAMIE,
      setBy: USER_ALEX,
    })
    expect(result.kind).toBe('created')
    if (result.kind !== 'created') throw new Error('expected created')
    expect(result.row.userId).toBe(USER_ALEX)
    expect(result.row.backupUserId).toBe(USER_JAMIE)
    expect(result.row.backupEmail).toBe('jamie@firm.com')
  })

  it('accepts a null backup (queue for principal handoff)', async () => {
    const db = await freshDb()
    await grantRole(db, USER_ALEX, 'staff')
    const result = await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: null,
      setBy: USER_ALEX,
    })
    expect(result.kind).toBe('created')
    if (result.kind !== 'created') throw new Error('expected created')
    expect(result.row.backupUserId).toBeNull()
    expect(result.row.backupEmail).toBeNull()
  })

  it('rejects a backup who is the same as the away user (self loop)', async () => {
    const db = await freshDb()
    await grantRole(db, USER_ALEX, 'staff')
    const result = await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: USER_ALEX,
      setBy: USER_ALEX,
    })
    expect(result.kind).toBe('backup_invalid')
    if (result.kind !== 'backup_invalid') throw new Error('expected backup_invalid')
    expect(result.reason).toBe('self')
  })

  it('rejects a backup with no Operator product role', async () => {
    const db = await freshDb()
    await grantRole(db, USER_ALEX, 'staff')
    const result = await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: USER_JAMIE,
      setBy: USER_ALEX,
    })
    expect(result.kind).toBe('backup_invalid')
    if (result.kind !== 'backup_invalid') throw new Error('expected backup_invalid')
    expect(result.reason).toBe('no_product_role')
  })

  it('rejects an unknown backup user id', async () => {
    const db = await freshDb()
    await grantRole(db, USER_ALEX, 'staff')
    const result = await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: 'user-ghost',
      setBy: USER_ALEX,
    })
    expect(result.kind).toBe('backup_invalid')
    if (result.kind !== 'backup_invalid') throw new Error('expected backup_invalid')
    expect(result.reason).toBe('unknown_user')
  })

  it('returns already_active when a PTO row exists for the user', async () => {
    const db = await freshDb()
    await grantRole(db, USER_ALEX, 'staff')
    await grantRole(db, USER_JAMIE, 'staff')
    await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: USER_JAMIE,
      setBy: USER_ALEX,
    })
    const second = await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: USER_PAT,
      setBy: USER_ALEX,
    })
    expect(second.kind).toBe('already_active')
    if (second.kind !== 'already_active') throw new Error('expected already_active')
    expect(second.row.backupUserId).toBe(USER_JAMIE) // backup unchanged
  })
})

describe('clearPto', () => {
  it('returns true when an active row flips to cleared', async () => {
    const db = await freshDb()
    await grantRole(db, USER_ALEX, 'staff')
    await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: null,
      setBy: USER_ALEX,
    })
    const ok = await clearPto(db, {
      entityId: ENTITY_A,
      userId: USER_ALEX,
      clearedBy: USER_ALEX,
    })
    expect(ok).toBe(true)
    expect(await getActivePto(db, ENTITY_A, USER_ALEX)).toBeNull()
  })

  it('returns false when no active row exists', async () => {
    const db = await freshDb()
    const ok = await clearPto(db, {
      entityId: ENTITY_A,
      userId: USER_ALEX,
      clearedBy: USER_ALEX,
    })
    expect(ok).toBe(false)
  })

  it('allows a fresh setPto after a clear', async () => {
    const db = await freshDb()
    await grantRole(db, USER_ALEX, 'staff')
    await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: null,
      setBy: USER_ALEX,
    })
    await clearPto(db, {
      entityId: ENTITY_A,
      userId: USER_ALEX,
      clearedBy: USER_ALEX,
    })
    const result = await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: null,
      setBy: USER_ALEX,
    })
    expect(result.kind).toBe('created')
  })
})

describe('updatePtoBackup', () => {
  it('updates the backup on an active row', async () => {
    const db = await freshDb()
    await grantRole(db, USER_ALEX, 'staff')
    await grantRole(db, USER_JAMIE, 'staff')
    await grantRole(db, USER_PAT, 'principal')
    await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: USER_JAMIE,
      setBy: USER_ALEX,
    })
    const result = await updatePtoBackup(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: USER_PAT,
    })
    expect(result.kind).toBe('updated')
    if (result.kind !== 'updated') throw new Error('expected updated')
    expect(result.row.backupUserId).toBe(USER_PAT)
  })

  it('returns not_away when no active PTO row exists', async () => {
    const db = await freshDb()
    const result = await updatePtoBackup(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: USER_JAMIE,
    })
    expect(result.kind).toBe('not_away')
  })

  it('returns backup_invalid when the new backup has no role', async () => {
    const db = await freshDb()
    await grantRole(db, USER_ALEX, 'staff')
    await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: null,
      setBy: USER_ALEX,
    })
    const result = await updatePtoBackup(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: USER_JAMIE,
    })
    expect(result.kind).toBe('backup_invalid')
  })
})

describe('listActivePto', () => {
  it('returns every active away user for the entity', async () => {
    const db = await freshDb()
    await grantRole(db, USER_ALEX, 'staff')
    await grantRole(db, USER_JAMIE, 'staff')
    await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: null,
      setBy: USER_ALEX,
    })
    await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_JAMIE,
      backupUserId: null,
      setBy: USER_JAMIE,
    })
    const rows = await listActivePto(db, ENTITY_A)
    expect(rows).toHaveLength(2)
  })

  it('omits cleared rows', async () => {
    const db = await freshDb()
    await grantRole(db, USER_ALEX, 'staff')
    await setPto(db, {
      orgId: ORG_ID,
      entityId: ENTITY_A,
      userId: USER_ALEX,
      backupUserId: null,
      setBy: USER_ALEX,
    })
    await clearPto(db, {
      entityId: ENTITY_A,
      userId: USER_ALEX,
      clearedBy: USER_ALEX,
    })
    const rows = await listActivePto(db, ENTITY_A)
    expect(rows).toHaveLength(0)
  })
})
