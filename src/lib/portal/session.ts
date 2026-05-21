/**
 * Portal session helpers.
 *
 * Resolves the local user + entity for an authenticated portal request.
 * Identity is owned by Clerk (see src/lib/auth/clerk-bridge.ts); SS
 * stores shadow rows keyed by clerk_user_id / clerk_org_id and JIT-
 * creates the local users row on first login. The local entity is NOT
 * JIT-created — a Clerk Organization without a matching
 * `entities.clerk_org_id` returns `client: null`, and the caller renders
 * the "no portal access yet" state.
 *
 * Magic-link auth on src/lib/auth/session.ts is retained for the admin
 * console only. Portal auth runs through Clerk.
 */

import type { Entity } from '../db/entities'
import {
  ensureLocalUser,
  resolveClerkEntity,
  type PortalUserRow,
} from '../auth/clerk-bridge'

export interface PortalContext {
  user: PortalUserRow
  client: Entity | null
}

/**
 * Resolve the portal context for the current Astro request.
 *
 * Reads Clerk auth state and user profile from `Astro.locals` (populated
 * by `clerkMiddleware()` in src/middleware.ts). Returns:
 *   - null                              — no Clerk session (redirect to sign-in)
 *   - { user, client: null }            — signed in, no entity provisioned yet
 *   - { user, client: <Entity> }        — fully provisioned, render portal
 */
export async function getPortalClient(
  db: D1Database,
  locals: App.Locals
): Promise<PortalContext | null> {
  const auth = locals.auth()
  if (!auth.userId) return null

  const clerkUser = await locals.currentUser()
  if (!clerkUser) return null

  const email = clerkUser.primaryEmailAddress?.emailAddress ?? clerkUser.emailAddresses[0]?.emailAddress ?? ''
  const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim() ||
    clerkUser.username ||
    email

  const user = await ensureLocalUser(db, auth.userId, { email, name })

  if (!auth.orgId) return { user, client: null }

  const client = await resolveClerkEntity(db, auth.orgId)
  return { user, client }
}
