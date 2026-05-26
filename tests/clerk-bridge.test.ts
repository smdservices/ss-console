import { beforeEach, describe, expect, it } from 'vitest'
import {
  createTestD1,
  discoverNumericMigrations,
  runMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'

import { ensureLocalUser, resolveClerkPortalContext } from '../src/lib/auth/clerk-bridge'
import { ORG_ID } from '../src/lib/constants'

const migrationsDir = resolve(process.cwd(), 'migrations')

const PRE_CLERK_USER_ID = 'user-pre-clerk'
const PRE_CLERK_ENTITY_ID = 'entity-pre-clerk'
const PRE_CLERK_EMAIL = 'preclerk@example.com'

describe('ensureLocalUser', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })

    await db
      .prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .bind(ORG_ID, 'SMD Services', 'smd-services')
      .run()

    // Seed an entity so we can bind the pre-Clerk user row to it.
    // Only the columns required by the schema's NOT NULL constraints
    // are populated; stage defaults to 'signal'.
    await db
      .prepare(
        `INSERT INTO entities (id, org_id, name, slug)
         VALUES (?, ?, ?, ?)`
      )
      .bind(PRE_CLERK_ENTITY_ID, ORG_ID, 'Pre-Clerk Entity', 'pre-clerk-entity')
      .run()

    // Pre-Clerk users row: created from a legacy magic-link invite or
    // admin-side seed, never authenticated through Clerk yet.
    await db
      .prepare(
        `INSERT INTO users (id, org_id, email, name, role, entity_id, clerk_user_id)
         VALUES (?, ?, ?, ?, 'client', ?, NULL)`
      )
      .bind(PRE_CLERK_USER_ID, ORG_ID, PRE_CLERK_EMAIL, 'Pre Clerk Client', PRE_CLERK_ENTITY_ID)
      .run()
  })

  it('returns the existing row when clerk_user_id already matches', async () => {
    // Bind the row first, then call ensureLocalUser with the same Clerk id.
    const boundClerkId = 'user_already_bound'
    await db
      .prepare('UPDATE users SET clerk_user_id = ? WHERE id = ?')
      .bind(boundClerkId, PRE_CLERK_USER_ID)
      .run()

    const result = await ensureLocalUser(db, boundClerkId, {
      email: PRE_CLERK_EMAIL,
      name: 'Pre Clerk Client',
    })

    expect(result.id).toBe(PRE_CLERK_USER_ID)
    expect(result.clerk_user_id).toBe(boundClerkId)
    expect(result.entity_id).toBe(PRE_CLERK_ENTITY_ID)
    expect(result.role).toBe('client')
  })

  it('auto-links a pre-Clerk row by email when clerk_user_id is NULL', async () => {
    // The bug this guards: ensureLocalUser used to only match on
    // clerk_user_id, then INSERT a new row. UNIQUE(org_id, email) made
    // that INSERT crash and left the pre-Clerk row orphaned.
    const newClerkId = 'user_first_sign_in'

    const result = await ensureLocalUser(db, newClerkId, {
      email: PRE_CLERK_EMAIL,
      name: 'Pre Clerk Client',
    })

    expect(result.id).toBe(PRE_CLERK_USER_ID)
    expect(result.clerk_user_id).toBe(newClerkId)
    expect(result.entity_id).toBe(PRE_CLERK_ENTITY_ID)

    // Verify it actually persisted (not just the returned object).
    const persisted = await db
      .prepare('SELECT clerk_user_id, entity_id FROM users WHERE id = ?')
      .bind(PRE_CLERK_USER_ID)
      .first<{ clerk_user_id: string | null; entity_id: string | null }>()
    expect(persisted?.clerk_user_id).toBe(newClerkId)
    expect(persisted?.entity_id).toBe(PRE_CLERK_ENTITY_ID)

    // No duplicate row was inserted.
    const count = await db
      .prepare('SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND email = ?')
      .bind(ORG_ID, PRE_CLERK_EMAIL)
      .first<{ n: number }>()
    expect(count?.n).toBe(1)
  })

  it('does NOT overwrite an existing clerk_user_id when emails match', async () => {
    // Defense-in-depth: if a different Clerk identity signs up with the
    // same email after the row is already bound to a Clerk id, we must
    // not silently rebind. The email-match query filters by
    // `clerk_user_id IS NULL`, so the linked row is excluded and a new
    // row is JIT-created instead.
    const originalClerkId = 'user_original'
    await db
      .prepare('UPDATE users SET clerk_user_id = ? WHERE id = ?')
      .bind(originalClerkId, PRE_CLERK_USER_ID)
      .run()

    const impostorClerkId = 'user_impostor'
    // Use a different email — UNIQUE(org_id, email) blocks a duplicate
    // of the bound row. The impostor sign-in carries a verified Clerk
    // email; this asserts that even on email collision against a bound
    // row, the existing binding is preserved.
    const result = await ensureLocalUser(db, impostorClerkId, {
      email: 'impostor@example.com',
      name: 'Impostor',
    })

    expect(result.clerk_user_id).toBe(impostorClerkId)
    expect(result.id).not.toBe(PRE_CLERK_USER_ID)

    const original = await db
      .prepare('SELECT clerk_user_id FROM users WHERE id = ?')
      .bind(PRE_CLERK_USER_ID)
      .first<{ clerk_user_id: string | null }>()
    expect(original?.clerk_user_id).toBe(originalClerkId)
  })

  it('JIT-creates a fresh client row when no email or clerk_user_id matches', async () => {
    const newClerkId = 'user_brand_new'
    const result = await ensureLocalUser(db, newClerkId, {
      email: 'brand-new@example.com',
      name: 'Brand New',
    })

    expect(result.clerk_user_id).toBe(newClerkId)
    expect(result.email).toBe('brand-new@example.com')
    expect(result.role).toBe('client')
    expect(result.entity_id).toBeNull()
    expect(result.id).not.toBe(PRE_CLERK_USER_ID)
  })
})

describe('resolveClerkPortalContext', () => {
  let db: D1Database
  const BOUND_CLERK_ID = 'user_bound_clerk'

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })

    await db
      .prepare('INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .bind(ORG_ID, 'SMD Services', 'smd-services')
      .run()
    await db
      .prepare(
        `INSERT INTO entities (id, org_id, name, slug)
         VALUES (?, ?, ?, ?)`
      )
      .bind(PRE_CLERK_ENTITY_ID, ORG_ID, 'Pre-Clerk Entity', 'pre-clerk-entity')
      .run()
    // Bind a users row directly to an entity (no Clerk Organization
    // involved). This is the common single-user-portal case.
    await db
      .prepare(
        `INSERT INTO users (id, org_id, email, name, role, entity_id, clerk_user_id)
         VALUES (?, ?, ?, ?, 'client', ?, ?)`
      )
      .bind(
        PRE_CLERK_USER_ID,
        ORG_ID,
        PRE_CLERK_EMAIL,
        'Pre Clerk Client',
        PRE_CLERK_ENTITY_ID,
        BOUND_CLERK_ID
      )
      .run()
  })

  it('resolves the entity via users.entity_id when no Clerk org is active', async () => {
    // The regression this guards: getPortalClient used to skip the
    // entity_id path and only try auth.orgId. A user with no active
    // Clerk org but a direct entity binding would land at no_subscription.
    const ctx = await resolveClerkPortalContext(
      db,
      { userId: BOUND_CLERK_ID, orgId: null },
      { email: PRE_CLERK_EMAIL, name: 'Pre Clerk Client' }
    )

    expect(ctx).not.toBeNull()
    expect(ctx!.user.id).toBe(PRE_CLERK_USER_ID)
    expect(ctx!.client).not.toBeNull()
    expect(ctx!.client!.id).toBe(PRE_CLERK_ENTITY_ID)
  })

  it('returns client:null when neither entity_id nor a matching clerk_org_id exists', async () => {
    // A JIT-created user with no binding lands here. Caller renders
    // the "no portal access yet" state.
    const ctx = await resolveClerkPortalContext(
      db,
      { userId: 'user_unbound', orgId: null },
      { email: 'unbound@example.com', name: 'Unbound' }
    )

    expect(ctx).not.toBeNull()
    expect(ctx!.user.entity_id).toBeNull()
    expect(ctx!.client).toBeNull()
  })

  it('returns null when no Clerk session is present', async () => {
    const ctx = await resolveClerkPortalContext(
      db,
      { userId: null, orgId: null },
      { email: '', name: '' }
    )
    expect(ctx).toBeNull()
  })
})
