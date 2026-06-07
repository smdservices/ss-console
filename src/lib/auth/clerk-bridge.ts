/**
 * Bridge between Clerk identity (the source of truth for portal users,
 * organizations, memberships, and sessions) and local SS business state
 * (entities, subscriptions, product_roles, engagements, invoices, etc.).
 *
 * Schema bridge columns:
 *   - users.clerk_user_id      (one local user per Clerk user)
 *   - entities.clerk_org_id    (one local entity per Clerk Organization)
 *
 * On every authenticated portal request the middleware reads Clerk's
 * `locals.auth()` state, then calls `resolveClerkPortalContext` to load
 * the matching local rows. If the Clerk user is new to SS we JIT-create
 * a local users row keyed by `clerk_user_id` so downstream code can
 * reference users.id in foreign keys (product_roles, audit log, etc.).
 *
 * The local entity is NOT JIT-created. A Clerk Organization without a
 * matching `entities.clerk_org_id` means the customer hasn't been
 * provisioned in SS yet — the portal renders a "no access yet" state
 * rather than fabricating an entity record.
 */

import { ORG_ID } from '../constants'
import type { Entity } from '../db/entities'

export interface ClerkAuthState {
  userId: string | null | undefined
  orgId: string | null | undefined
}

export interface PortalUserRow {
  id: string
  org_id: string
  email: string
  name: string
  role: string
  entity_id: string | null
  clerk_user_id: string | null
}

export interface ClerkUserProfile {
  email: string
  name: string
}

export interface PortalContext {
  user: PortalUserRow
  client: Entity | null
}

/**
 * Look up the local users row keyed by clerk_user_id, JIT-creating one
 * if absent. Caller must provide the Clerk profile (email + name) for
 * the JIT path — typically fetched from `clerkClient.users.getUser()`
 * inside the page or API handler.
 *
 * role is hardcoded to 'client' for portal users. Admin role is governed
 * by a separate path (magic-link auth on admin.smd.services).
 */
export async function ensureLocalUser(
  db: D1Database,
  clerkUserId: string,
  profile: ClerkUserProfile
): Promise<PortalUserRow> {
  const existing = await db
    .prepare('SELECT * FROM users WHERE clerk_user_id = ?')
    .bind(clerkUserId)
    .first<PortalUserRow>()

  if (existing) return existing

  // Auto-link path: a users row may already exist for this email from
  // before the Clerk migration (or from an admin-created client invite
  // that hasn't been redeemed via Clerk yet). UNIQUE(org_id, email) means
  // we cannot INSERT a duplicate row; we must bind the existing row to
  // this Clerk identity instead. Only links when clerk_user_id IS NULL
  // so we never overwrite an existing binding. Email comes from Clerk's
  // verified primary email, which is the trust anchor.
  const emailMatch = await db
    .prepare(
      `SELECT * FROM users
       WHERE org_id = ? AND email = ? AND clerk_user_id IS NULL
       LIMIT 1`
    )
    .bind(ORG_ID, profile.email)
    .first<PortalUserRow>()

  if (emailMatch) {
    await db
      .prepare('UPDATE users SET clerk_user_id = ? WHERE id = ?')
      .bind(clerkUserId, emailMatch.id)
      .run()
    return { ...emailMatch, clerk_user_id: clerkUserId }
  }

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO users (id, org_id, email, name, role, clerk_user_id, created_at)
       VALUES (?, ?, ?, ?, 'client', ?, datetime('now'))`
    )
    .bind(id, ORG_ID, profile.email, profile.name, clerkUserId)
    .run()

  const created = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(id)
    .first<PortalUserRow>()

  if (!created) {
    throw new Error(`Failed to load just-created user ${id} for clerk_user_id ${clerkUserId}`)
  }
  return created
}

/**
 * Resolve the active Clerk Organization to a local entities row via
 * entities.clerk_org_id. Returns null when the Clerk org has not been
 * provisioned in SS (no entity bound to it yet).
 *
 * Unlike users, entities are NOT JIT-created. A new Clerk Organization
 * without a matching SS entity reflects a customer who signed up or
 * was invited but hasn't been provisioned yet. The portal renders an
 * explicit "no access" state per docs/style/empty-state-pattern.md
 * (no fabrication).
 */
export async function resolveClerkEntity(
  db: D1Database,
  clerkOrgId: string
): Promise<Entity | null> {
  return await db
    .prepare(`SELECT * FROM entities WHERE clerk_org_id = ? AND org_id = ?`)
    .bind(clerkOrgId, ORG_ID)
    .first<Entity>()
}

/**
 * Resolve a local entity from a users.entity_id reference. Used when the
 * client is bound to an entity directly (without an intermediating Clerk
 * Organization). The Operator product flows still rely on Clerk Orgs
 * for invitation + member management, so resolveClerkEntity(orgId) stays
 * the fallback when entity_id is null.
 */
export async function resolveEntityByUserBinding(
  db: D1Database,
  entityId: string
): Promise<Entity | null> {
  return await db
    .prepare(`SELECT * FROM entities WHERE id = ? AND org_id = ?`)
    .bind(entityId, ORG_ID)
    .first<Entity>()
}

/**
 * Resolve the full portal context for an authenticated Clerk session.
 * Returns `null` when there is no Clerk session (caller should redirect
 * to sign-in). Returns `{ user, client: null }` when the user is
 * authenticated but isn't yet bound to a customer (no users.entity_id,
 * and no matching Clerk Organization → entities.clerk_org_id either).
 *
 * Resolution order:
 *   1. users.entity_id (explicit binding, set by admin tools)
 *   2. entities.clerk_org_id (Clerk Organization binding, used by
 *      Operator invitation flows)
 *
 * The two paths coexist because Operator features still need Clerk
 * Organizations for multi-user matter access; direct binding via
 * entity_id is the simpler path for single-user portal access.
 */
export async function resolveClerkPortalContext(
  db: D1Database,
  auth: ClerkAuthState,
  profile: ClerkUserProfile
): Promise<PortalContext | null> {
  if (!auth.userId) return null

  const user = await ensureLocalUser(db, auth.userId, profile)

  if (user.entity_id) {
    const client = await resolveEntityByUserBinding(db, user.entity_id)
    if (client) return { user, client }
  }

  if (!auth.orgId) return { user, client: null }

  const client = await resolveClerkEntity(db, auth.orgId)
  return { user, client }
}
