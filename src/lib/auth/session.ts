/**
 * Session management for the legacy magic-link client portal path.
 *
 * Sibling modules (this one is NOT the live admin path):
 * `admin-session-shim.ts` adapts Clerk identity into the SessionData
 * shape defined here and is what populates locals.session on admin
 * routes; `admin-session.ts` is the requireAdminSession guard over it.
 *
 * As of the 2026-05-25 Clerk-unified auth migration, Clerk owns both
 * admin and primary portal sessions. This module is retained ONLY for
 * the magic-link client invitation flow: /auth/verify consumes a
 * magic-link token, calls createSession() to mint a session_token
 * cookie, and the middleware's portal-session fallback accepts that
 * cookie until it expires. New client onboarding will migrate to
 * Clerk invitations in a follow-up.
 *
 * Sessions are stored in D1 (source of truth) with Workers KV as a fast
 * lookup cache. The session token is a cryptographically random UUID
 * stored in an HttpOnly cookie.
 *
 * Session lifecycle:
 *   1. createSession()  — writes to D1 + KV, returns token
 *   2. validateSession() — reads from KV (fast path) or D1 (fallback)
 *   3. renewSession()   — sliding-window refresh on each authenticated request
 *
 * Session expiration: 7 days admin (unused after migration), 30 days client.
 */

export const SESSION_COOKIE_NAME = 'session_token'
const ADMIN_SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const CLIENT_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/**
 * Closed set of user roles, mirroring the `users.role` CHECK constraint
 * restored in migration 0035. Defense-in-depth pairing: DB enforces at
 * write, TS enforces at read.
 */
export type UserRole = 'admin' | 'client'

/**
 * Narrow an unknown role string (e.g. from a raw D1 query) to UserRole.
 * Throws if the value is unexpected — should never happen with the CHECK
 * constraint in place, but the throw catches drift if the constraint is
 * dropped in a future migration without updating this union.
 */
export function asUserRole(role: string): UserRole {
  if (role === 'admin' || role === 'client') return role
  throw new Error(`Invalid user role: ${role}`)
}

/**
 * Return session duration based on role.
 *
 * Clients get 30 days — infrequent portal visitors who shouldn't be
 * re-authed every visit. Admins get 7 days.
 */
export function getSessionDurationMs(role?: string): number {
  return role === 'client' ? CLIENT_SESSION_DURATION_MS : ADMIN_SESSION_DURATION_MS
}

export interface SessionData {
  userId: string
  orgId: string
  role: UserRole
  email: string
  expiresAt: string
}

export interface SessionRow {
  id: string
  token: string
  user_id: string
  org_id: string
  role: UserRole
  email: string
  expires_at: string
  created_at: string
}

/**
 * Create a new session for the given user.
 * Writes to both D1 (source of truth) and KV (cache).
 */
export async function createSession(
  db: D1Database,
  kv: KVNamespace,
  user: { id: string; orgId: string; role: UserRole; email: string }
): Promise<string> {
  const token = crypto.randomUUID()
  const sessionId = crypto.randomUUID()
  const durationMs = getSessionDurationMs(user.role)
  const expiresAt = new Date(Date.now() + durationMs).toISOString()

  // Write to D1 (source of truth)
  await db
    .prepare(
      `INSERT INTO sessions (id, token, user_id, org_id, role, email, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(sessionId, token, user.id, user.orgId, user.role, user.email, expiresAt)
    .run()

  // Write to KV (cache) with TTL matching session expiration
  const sessionData: SessionData = {
    userId: user.id,
    orgId: user.orgId,
    role: user.role,
    email: user.email,
    expiresAt,
  }

  const kvTtlSeconds = Math.floor(durationMs / 1000)
  await kv.put(`session:${token}`, JSON.stringify(sessionData), {
    expirationTtl: kvTtlSeconds,
  })

  return token
}

/**
 * Parse a KV-cached session value into SessionData, or null when the entry
 * is corrupt (unparseable JSON or wrong shape). Issue #834: a corrupt KV
 * value used to throw out of validateSession and 500 an otherwise-valid
 * request; corrupt entries now fall through to the authoritative D1 path.
 */
function parseCachedSession(cached: string): SessionData | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(cached)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const candidate = parsed as Record<string, unknown>
  if (
    typeof candidate.userId !== 'string' ||
    typeof candidate.orgId !== 'string' ||
    typeof candidate.email !== 'string' ||
    typeof candidate.expiresAt !== 'string' ||
    (candidate.role !== 'admin' && candidate.role !== 'client')
  ) {
    return null
  }
  return candidate as unknown as SessionData
}

/**
 * Validate a session token. Returns session data if valid, null otherwise.
 *
 * Fast path: check KV cache first.
 * Fallback: check D1 if KV miss OR corrupt cache entry (repopulates KV on
 * success).
 */
export async function validateSession(
  db: D1Database,
  kv: KVNamespace,
  token: string
): Promise<SessionData | null> {
  // Fast path: KV lookup
  const cached = await kv.get(`session:${token}`)
  if (cached) {
    const data = parseCachedSession(cached)
    if (data === null) {
      // Corrupt cache entry — drop it and fall through to D1 (#834).
      await kv.delete(`session:${token}`)
    } else if (new Date(data.expiresAt) > new Date()) {
      return data
    } else {
      // Expired in cache — clean up
      await kv.delete(`session:${token}`)
      return null
    }
  }

  // Fallback: D1 lookup
  const row = await db
    .prepare(`SELECT * FROM sessions WHERE token = ? LIMIT 1`)
    .bind(token)
    .first<SessionRow>()

  if (!row) {
    return null
  }

  if (new Date(row.expires_at) <= new Date()) {
    // Expired — clean up
    await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(row.id).run()
    return null
  }

  // Repopulate KV cache
  const sessionData: SessionData = {
    userId: row.user_id,
    orgId: row.org_id,
    role: row.role,
    email: row.email,
    expiresAt: row.expires_at,
  }

  const remainingMs = new Date(row.expires_at).getTime() - Date.now()
  const kvTtlSeconds = Math.max(60, Math.floor(remainingMs / 1000))
  await kv.put(`session:${token}`, JSON.stringify(sessionData), {
    expirationTtl: kvTtlSeconds,
  })

  return sessionData
}

/**
 * Renew a session's expiration (sliding window).
 * Call this on each authenticated request to extend the session.
 */
export async function renewSession(
  db: D1Database,
  kv: KVNamespace,
  token: string,
  currentData: SessionData
): Promise<void> {
  // Role comes from KV-cached session data and may be stale if changed
  // mid-session by an admin. Self-heals on next KV expiry + D1 fallback.
  const durationMs = getSessionDurationMs(currentData.role)
  const newExpiresAt = new Date(Date.now() + durationMs).toISOString()

  // Update D1
  await db
    .prepare(`UPDATE sessions SET expires_at = ? WHERE token = ?`)
    .bind(newExpiresAt, token)
    .run()

  // Update KV cache
  const updatedData: SessionData = {
    ...currentData,
    expiresAt: newExpiresAt,
  }

  const kvTtlSeconds = Math.floor(durationMs / 1000)
  await kv.put(`session:${token}`, JSON.stringify(updatedData), {
    expirationTtl: kvTtlSeconds,
  })
}

/**
 * Build a Set-Cookie header for the session token. Used by the magic-link
 * client onboarding path (/auth/verify) to mint the session cookie.
 *
 * No Domain= attribute is set intentionally: client cookies are scoped to
 * portal.smd.services.
 */
export function buildSessionCookie(token: string, role?: string): string {
  const maxAge = Math.floor(getSessionDurationMs(role) / 1000)
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
}

/**
 * Parse the session token from a Cookie header string.
 */
export function parseSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null

  const cookies = cookieHeader.split(';')
  for (const cookie of cookies) {
    const [name, ...rest] = cookie.trim().split('=')
    if (name === SESSION_COOKIE_NAME) {
      const value = rest.join('=')
      return value || null
    }
  }

  return null
}
