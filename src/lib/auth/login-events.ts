/**
 * Durable sign-in history + accurate users.last_login_at for Clerk logins.
 *
 * Clerk owns identity but nothing on the Clerk path ever wrote
 * users.last_login_at (only the legacy magic-link flow did), so portal
 * "Last signed in" displays went stale after the 2026-05-25 unification.
 *
 * Detection: a Clerk sessionId is stable across requests within a session
 * and changes on every real sign-in. The UNIQUE index on
 * portal_login_events.clerk_session_id (migration 0098) is the source of
 * truth for "have we seen this session" — INSERT OR IGNORE reporting
 * changes > 0 means a genuinely new sign-in, and only then is
 * users.last_login_at stamped. This is idempotent under same-session
 * request races AND multi-device session alternation; a last-seen-column
 * compare alone would misfire on the latter (phone + laptop alternating
 * session ids request-by-request).
 *
 * users.last_clerk_session_id is a best-effort skip cache so the common
 * path (same session as last time) does no writes at all. Stale cache =
 * one no-op INSERT, never a duplicate row.
 */

import type { PortalUserRow } from './clerk-bridge'

export interface RecordLoginInput {
  userId: string
  entityId: string | null
  email: string
  clerkUserId: string | null
  clerkSessionId: string
}

/**
 * Record a Clerk sign-in if this session has never been seen. Returns true
 * when a new login was recorded (history row inserted + users stamped).
 */
export async function recordClerkLogin(db: D1Database, input: RecordLoginInput): Promise<boolean> {
  const insert = await db
    .prepare(
      `INSERT OR IGNORE INTO portal_login_events
         (id, user_id, entity_id, email, clerk_user_id, clerk_session_id, method, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'clerk', ?)`
    )
    .bind(
      crypto.randomUUID(),
      input.userId,
      input.entityId,
      input.email,
      input.clerkUserId,
      input.clerkSessionId,
      new Date().toISOString()
    )
    .run()

  if (!insert.meta || insert.meta.changes === 0) return false

  await db
    .prepare(`UPDATE users SET last_login_at = ?, last_clerk_session_id = ? WHERE id = ?`)
    .bind(new Date().toISOString(), input.clerkSessionId, input.userId)
    .run()

  return true
}

/**
 * Stamp a login for the current request if its Clerk session is new.
 * Never throws — a ledger failure must not fail an authenticated request.
 * When `waitUntil` is provided (Workers request path) the write is
 * fire-and-forget; otherwise it is awaited (post-sign-in dispatcher, tests).
 */
export async function stampLoginIfNewSession(
  db: D1Database,
  user: Pick<PortalUserRow, 'id' | 'email' | 'clerk_user_id' | 'last_clerk_session_id'>,
  clerkSessionId: string | null | undefined,
  entityId: string | null,
  waitUntil?: (p: Promise<unknown>) => void
): Promise<void> {
  if (!clerkSessionId) return
  // Skip cache: same session as the last recorded login — nothing to do.
  if (user.last_clerk_session_id === clerkSessionId) return

  const write = recordClerkLogin(db, {
    userId: user.id,
    entityId,
    email: user.email,
    clerkUserId: user.clerk_user_id,
    clerkSessionId,
  }).catch((err) => {
    console.error('login-events: failed to record sign-in', err)
    return false
  })

  if (waitUntil) {
    waitUntil(write)
    return
  }
  await write
}
