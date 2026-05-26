import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level guards for the auth subsystem.
 *
 * Post 2026-05-25 Clerk-unified migration, this file covers:
 *   - session.ts (the magic-link path that survived for client invites)
 *   - middleware.ts (admin shim + portal Clerk + legacy fallback)
 *   - AdminLayout.astro (Clerk SignOutButton chrome)
 *   - admin-session-shim.ts (Clerk userId → SessionData adapter)
 *
 * Removed legacy suites (covered the PBKDF2 admin path that PR 3 deleted):
 *   - auth: password module
 *   - auth: login page
 *   - auth: API endpoints (logout/login)
 *   - auth: login endpoint rate limiting
 */

describe('auth: session module', () => {
  it('session.ts exports the core helpers still used by /auth/verify', () => {
    const source = readFileSync(resolve('src/lib/auth/session.ts'), 'utf-8')
    expect(source).toContain('export async function createSession')
    expect(source).toContain('export async function validateSession')
    expect(source).toContain('export async function renewSession')
    expect(source).toContain('export function buildSessionCookie')
    expect(source).toContain('export function parseSessionToken')
  })

  it('admin session duration is 7 days', () => {
    const source = readFileSync(resolve('src/lib/auth/session.ts'), 'utf-8')
    expect(source).toContain('7 * 24 * 60 * 60 * 1000')
  })

  it('uses cryptographically random session tokens', () => {
    const source = readFileSync(resolve('src/lib/auth/session.ts'), 'utf-8')
    expect(source).toContain('crypto.randomUUID()')
  })

  it('cookie is HttpOnly, Secure, SameSite=Lax', () => {
    const source = readFileSync(resolve('src/lib/auth/session.ts'), 'utf-8')
    expect(source).toContain('HttpOnly')
    expect(source).toContain('Secure')
    expect(source).toContain('SameSite=Lax')
  })

  it('validates via KV first then falls back to D1', () => {
    const source = readFileSync(resolve('src/lib/auth/session.ts'), 'utf-8')
    expect(source).toContain('kv.get')
    expect(source).toContain('SELECT * FROM sessions WHERE token')
  })

  it('client session duration is 30 days', () => {
    const source = readFileSync(resolve('src/lib/auth/session.ts'), 'utf-8')
    expect(source).toContain('30 * 24 * 60 * 60 * 1000')
  })

  it('exports getSessionDurationMs helper', () => {
    const source = readFileSync(resolve('src/lib/auth/session.ts'), 'utf-8')
    expect(source).toContain('export function getSessionDurationMs')
  })
})

describe('auth: buildSessionCookie behavior', () => {
  it('sets 30-day Max-Age for client role', async () => {
    const { buildSessionCookie } = await import('../src/lib/auth/session')
    const cookie = buildSessionCookie('test-token', 'client')
    expect(cookie).toContain('Max-Age=2592000')
  })

  it('sets 7-day Max-Age for admin role', async () => {
    const { buildSessionCookie } = await import('../src/lib/auth/session')
    const cookie = buildSessionCookie('test-token', 'admin')
    expect(cookie).toContain('Max-Age=604800')
  })

  it('defaults to admin duration when role omitted', async () => {
    const { buildSessionCookie } = await import('../src/lib/auth/session')
    const cookie = buildSessionCookie('test-token')
    expect(cookie).toContain('Max-Age=604800')
  })
})

describe('auth: admin session shim', () => {
  it('shim file exists', () => {
    expect(existsSync(resolve('src/lib/auth/admin-session-shim.ts'))).toBe(true)
  })

  it('exports resolveAdminSessionFromClerk', () => {
    const source = readFileSync(resolve('src/lib/auth/admin-session-shim.ts'), 'utf-8')
    expect(source).toContain('export async function resolveAdminSessionFromClerk')
  })

  it('gates resolution to role=admin in the SQL', () => {
    const source = readFileSync(resolve('src/lib/auth/admin-session-shim.ts'), 'utf-8')
    expect(source).toContain("WHERE clerk_user_id = ? AND role = 'admin'")
  })

  it('returns SessionData shape matching legacy locals.session', () => {
    const source = readFileSync(resolve('src/lib/auth/admin-session-shim.ts'), 'utf-8')
    expect(source).toContain('userId:')
    expect(source).toContain('orgId:')
    expect(source).toContain('email:')
    expect(source).toContain("role: 'admin'")
  })

  it('caches resolved sessions in KV with a bounded TTL', () => {
    const source = readFileSync(resolve('src/lib/auth/admin-session-shim.ts'), 'utf-8')
    expect(source).toContain('admin-session:')
    expect(source).toContain('expirationTtl')
  })
})

describe('auth: middleware', () => {
  it('middleware.ts exists', () => {
    expect(existsSync(resolve('src/middleware.ts'))).toBe(true)
  })

  it('protects /admin routes', () => {
    const source = readFileSync(resolve('src/middleware.ts'), 'utf-8')
    expect(source).toContain('/admin')
    expect(source).toContain("pathname.startsWith('/admin')")
  })

  it('redirects unauthenticated requests to the unified sign-in', () => {
    const source = readFileSync(resolve('src/middleware.ts'), 'utf-8')
    expect(source).toContain("'/auth/sign-in'")
  })

  it('attaches session to locals', () => {
    const source = readFileSync(resolve('src/middleware.ts'), 'utf-8')
    expect(source).toContain('context.locals.session = sessionData')
  })

  it('renews session on each authenticated request', () => {
    const source = readFileSync(resolve('src/middleware.ts'), 'utf-8')
    expect(source).toContain('renewSession')
  })

  it('populates locals.session for admin paths via the Clerk shim', () => {
    const source = readFileSync(resolve('src/middleware.ts'), 'utf-8')
    expect(source).toContain('resolveAdminSessionFromClerk')
  })
})

describe('auth: unified sign-in pages', () => {
  it('sign-in page exists', () => {
    expect(existsSync(resolve('src/pages/auth/sign-in.astro'))).toBe(true)
  })

  it('sign-up page exists', () => {
    expect(existsSync(resolve('src/pages/auth/sign-up.astro'))).toBe(true)
  })

  it('after-sign-in dispatcher exists', () => {
    expect(existsSync(resolve('src/pages/auth/after-sign-in.ts'))).toBe(true)
  })

  it('sign-in page forces redirect through /auth/after-sign-in', () => {
    const source = readFileSync(resolve('src/pages/auth/sign-in.astro'), 'utf-8')
    expect(source).toContain('forceRedirectUrl="/auth/after-sign-in"')
  })

  it('after-sign-in dispatcher routes by users.role', () => {
    const source = readFileSync(resolve('src/pages/auth/after-sign-in.ts'), 'utf-8')
    expect(source).toContain('resolveAdminSessionFromClerk')
    expect(source).toContain('SELECT role, entity_id FROM users WHERE clerk_user_id = ?')
  })
})

describe('auth: admin dashboard', () => {
  it('admin index page exists', () => {
    expect(existsSync(resolve('src/pages/admin/index.astro'))).toBe(true)
  })

  it('admin page uses session data', () => {
    const source = readFileSync(resolve('src/pages/admin/index.astro'), 'utf-8')
    expect(source).toContain('Astro.locals.session')
  })

  it('admin layout includes Clerk sign-out button', () => {
    const source = readFileSync(resolve('src/layouts/AdminLayout.astro'), 'utf-8')
    expect(source).toContain('SignOutButton')
    expect(source).toContain('/auth/sign-in?status=signed_out')
  })

  it('admin layout is not indexed by search engines', () => {
    const source = readFileSync(resolve('src/layouts/AdminLayout.astro'), 'utf-8')
    expect(source).toContain('noindex')
  })
})

describe('auth: migrations (historical)', () => {
  it('password_hash migration still exists in history', () => {
    // We don't drop the migration even though the column is no longer
    // written to; D1 migrations are append-only and the schema column
    // still exists in the users table (NULL for the post-cutover admin
    // row). Removing the migration would diverge prod from local.
    expect(existsSync(resolve('migrations/0004_add_password_hash.sql'))).toBe(true)
  })

  it('admin seed migration still exists in history', () => {
    expect(existsSync(resolve('migrations/0005_seed_admin_user.sql'))).toBe(true)
  })

  it('sessions table migration still exists', () => {
    expect(existsSync(resolve('migrations/0006_create_sessions_table.sql'))).toBe(true)
  })
})

describe('auth: env.d.ts types', () => {
  it('declares AuthSession interface', () => {
    const source = readFileSync(resolve('src/env.d.ts'), 'utf-8')
    expect(source).toContain('interface AuthSession')
  })

  it('adds session to App.Locals', () => {
    const source = readFileSync(resolve('src/env.d.ts'), 'utf-8')
    expect(source).toContain('session: AuthSession | null')
  })
})
