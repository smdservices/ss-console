/**
 * Auth module — re-exports for convenience.
 *
 * The legacy admin password path (hashPassword/verifyPassword) and the
 * D1-session destroy/clear helpers were removed in the 2026-05-25 Clerk-
 * unified auth migration. Admin sessions are now synthesized from Clerk
 * identity via lib/auth/admin-session-shim.ts; logout is handled by
 * Clerk's <SignOutButton />.
 *
 * What remains: createSession/buildSessionCookie + parseSessionToken /
 * validateSession / renewSession — still used by the magic-link client
 * portal invitation flow (/auth/verify) and by the middleware's
 * legacy-portal-session fallback.
 */

export {
  createSession,
  validateSession,
  renewSession,
  buildSessionCookie,
  parseSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_DURATION_MS,
} from './session'
export type { SessionData, UserRole } from './session'
export { asUserRole } from './session'
export { createMagicLink, verifyMagicLink, MAGIC_LINK_EXPIRY_MS } from './magic-link'
