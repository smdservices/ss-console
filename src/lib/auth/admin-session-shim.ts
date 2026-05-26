/**
 * Admin session shim — Clerk identity → legacy SessionData shape.
 *
 * Background. Admin auth used to be custom PBKDF2 + a D1 `sessions` table.
 * 73 call sites across src/ read `locals.session.{userId, orgId, role, email}`
 * — entity queries, OAuth callback CSRF checks, follow-up tenant scoping,
 * email display in the admin chrome. Switching admin to Clerk means we
 * either rewrite 73 call sites or build an adapter. We chose the adapter.
 *
 * This shim resolves a Clerk user_id to the local `users` row and returns
 * the same `SessionData` shape the call sites already read. The middleware
 * populates `locals.session` from this helper on admin paths.
 *
 * Cache. Per-Clerk-user lookups go through KV with a 120s TTL. Role changes
 * propagate within 2 minutes via natural TTL expiry; explicit invalidation
 * is not needed for the single-admin venture posture (one admin, role
 * doesn't churn), but the TTL bounds drift.
 *
 * Failure modes. Returns null when no matching admin row exists — caller
 * (middleware) redirects to /auth/sign-in. Returns null when the row exists
 * but `role !== 'admin'` — same redirect path, prevents privilege confusion.
 */

import type { SessionData } from './session'

const ADMIN_SESSION_CACHE_TTL_SECONDS = 120

interface AdminUserRow {
  id: string
  org_id: string
  email: string
  role: string
}

/**
 * Resolve a Clerk user_id to the legacy SessionData shape, gated to
 * `role === 'admin'`. Reads from KV first; falls back to D1; repopulates KV.
 */
export async function resolveAdminSessionFromClerk(
  clerkUserId: string,
  db: D1Database,
  kv: KVNamespace
): Promise<SessionData | null> {
  const cacheKey = `admin-session:${clerkUserId}`

  const cached = await kv.get(cacheKey)
  if (cached) {
    return JSON.parse(cached) as SessionData
  }

  const row = await db
    .prepare(
      `SELECT id, org_id, email, role
         FROM users
        WHERE clerk_user_id = ? AND role = 'admin'
        LIMIT 1`
    )
    .bind(clerkUserId)
    .first<AdminUserRow>()

  if (!row) return null
  if (row.role !== 'admin') return null

  // expiresAt is part of the SessionData contract for legacy session.ts
  // consumers (renewSession), but the shim is stateless — Clerk owns
  // expiration. Synthesize a forward-dated value matching the cache TTL
  // so any consumer that inspects it sees a "valid" window.
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_CACHE_TTL_SECONDS * 1000).toISOString()

  const sessionData: SessionData = {
    userId: row.id,
    orgId: row.org_id,
    role: 'admin',
    email: row.email,
    expiresAt,
  }

  await kv.put(cacheKey, JSON.stringify(sessionData), {
    expirationTtl: ADMIN_SESSION_CACHE_TTL_SECONDS,
  })

  return sessionData
}

/**
 * Invalidate the cached admin session for a Clerk user_id. Call after any
 * mutation that changes the user's role or email (admin tools, future
 * settings flows). Optional — natural TTL expiry resolves stale state
 * within 120s either way.
 */
export async function invalidateAdminSessionCache(
  clerkUserId: string,
  kv: KVNamespace
): Promise<void> {
  await kv.delete(`admin-session:${clerkUserId}`)
}
