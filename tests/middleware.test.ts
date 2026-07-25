import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level guards for src/middleware.ts.
 *
 * The middleware runs against D1/KV bindings at request time. Integration
 * tests would need a full runtime harness. These tests enforce the
 * architectural invariants at the source level: the three-subdomain
 * routing, strict hostname equality on the legacy redirect, and the
 * cookie-refresh guard that keeps admin cookies off the apex.
 */
describe('middleware: admin subdomain rewrite', () => {
  const source = () => readFileSync(resolve('src/middleware.ts'), 'utf-8')

  it('detects admin subdomain with startsWith("admin.")', () => {
    expect(source()).toContain("hostname.startsWith('admin.')")
  })

  it('admin rewrite exempts paths already under /admin', () => {
    const code = source()
    expect(code).toMatch(/isAdminSubdomain[\s\S]*!pathname\.startsWith\('\/admin'\)/)
  })

  it('admin rewrite exempts /api/admin', () => {
    const code = source()
    expect(code).toMatch(/isAdminSubdomain[\s\S]*!pathname\.startsWith\('\/api\/admin'\)/)
  })

  it('admin rewrite exempts /auth and /api/auth', () => {
    const code = source()
    expect(code).toMatch(/isAdminSubdomain[\s\S]*!pathname\.startsWith\('\/auth'\)/)
    expect(code).toMatch(/isAdminSubdomain[\s\S]*!pathname\.startsWith\('\/api\/auth'\)/)
  })

  it('admin rewrite prepends /admin to non-admin paths', () => {
    const code = source()
    expect(code).toMatch(
      /adminPath\s*=\s*pathname\s*===\s*'\/'\s*\?\s*'\/admin'\s*:\s*`\/admin\$\{pathname\}`/
    )
  })

  it('admin rewrite uses context.rewrite, not redirect', () => {
    const code = source()
    // Rewrite is transparent — user stays on admin.smd.services in the URL bar.
    const adminBlock = code.slice(code.indexOf('isAdminSubdomain'))
    expect(adminBlock).toContain('context.rewrite(')
  })
})

describe('legacy redirects: apex + auth rules (src/lib/routing/legacy-redirects.ts)', () => {
  // The redirect rule table was extracted from middleware.ts (code review
  // 2026-07-02 §1.3). These source guards follow the logic to its new home and
  // keep asserting the invariants that matter (loop safety, apex admin
  // canonicalization, legacy auth targets, permanent status).
  const source = () => readFileSync(resolve('src/lib/routing/legacy-redirects.ts'), 'utf-8')

  it('uses strict hostname equality for the apex admin redirect (no endsWith/startsWith loop)', () => {
    // CRITICAL: startsWith/endsWith on the host would also match
    // admin.smd.services and loop. The rule matches on strict equality.
    const code = source()
    expect(code).toContain("hostname === 'smd.services'")
    expect(code).not.toContain("hostname.endsWith('smd.services')")
    expect(code).not.toContain("hostname.startsWith('smd.services')")
  })

  it('redirects apex /admin/* to admin subdomain', () => {
    const code = source()
    expect(code).toMatch(/pathname\.startsWith\('\/admin\/'\)/)
    expect(code).toContain("next.hostname = 'admin.smd.services'")
  })

  it('301s legacy auth paths to unified /auth/sign-in|sign-up', () => {
    const code = source()
    // The unified-auth migration funnels all legacy auth URLs to the new
    // /auth/sign-in (and /auth/sign-up) entry points.
    expect(code).toMatch(/'\/auth\/login':\s*'\/auth\/sign-in'/)
    expect(code).toMatch(/'\/auth\/portal-sign-in':\s*'\/auth\/sign-in'/)
    expect(code).toMatch(/'\/auth\/portal-sign-up':\s*'\/auth\/sign-up'/)
    expect(code).toMatch(/'\/auth\/portal-login':\s*'\/auth\/sign-in'/)
  })

  it('every legacy redirect is permanent (301, never 302/307)', () => {
    const code = source()
    expect(code).toMatch(/status:\s*301/)
    expect(code).not.toMatch(/status:\s*30[27]/)
  })

  it('the middleware issues the redirect through context.redirect with the rule status', () => {
    const mw = readFileSync(resolve('src/middleware.ts'), 'utf-8')
    expect(mw).toMatch(/context\.redirect\(\s*\w+\.location,\s*\w+\.status\s*\)/)
  })
})

describe('middleware: unified Clerk auth invariants', () => {
  const source = () => readFileSync(resolve('src/middleware.ts'), 'utf-8')

  it('admin session resolution is admin-paths-only', () => {
    // The shim must not fire on portal/marketing paths — admin role lookups
    // on a portal-only request would be wasted DB work and leak admin
    // session data into wrong contexts.
    const code = source()
    expect(code).toMatch(/resolveAdminSession[\s\S]*?startsWith\('\/admin'\)/)
  })

  it('admin auth enforcement requires Clerk userId + admin role', () => {
    // Two-stage check: must be Clerk-authenticated AND have role='admin'
    // in the local users row resolved via the shim.
    const code = source()
    expect(code).toContain('locals.auth()')
    expect(code).toMatch(/session\.role\s*!==\s*'admin'/)
  })

  it('portal accepts legacy magic-link sessions as a Clerk fallback', () => {
    // In-flight invitation emails still produce session_token cookies via
    // /auth/verify. The portal must keep accepting those until they expire.
    const code = source()
    expect(code).toContain('resolveLegacyPortalSession')
    expect(code).toMatch(/session\?\.role\s*===\s*'client'/)
  })

  it('Clerk middleware is composed before SS middleware', () => {
    // Clerk must populate locals.auth() before SS middleware reads it.
    const code = source()
    expect(code).toMatch(/sequence\(\s*clerkMiddleware\(\),\s*ssMiddleware\s*\)/)
  })
})

describe('middleware: portal rewrite preserved (regression)', () => {
  const source = () => readFileSync(resolve('src/middleware.ts'), 'utf-8')

  it('still detects portal subdomain', () => {
    expect(source()).toContain("hostname.startsWith('portal.')")
  })

  it('still rewrites non-portal paths on the portal subdomain', () => {
    const code = source()
    expect(code).toMatch(
      /portalPath\s*=\s*pathname\s*===\s*'\/'\s*\?\s*'\/portal'\s*:\s*`\/portal\$\{pathname\}`/
    )
  })
})

describe('middleware: 404 route must be SSR (regression lock-in)', () => {
  // If 404.astro is prerendered, Astro's renderError fallback serves the
  // static dist/client/404.html via the ASSETS binding and BYPASSES
  // middleware. That breaks subdomain rewrite for every path that doesn't
  // match a concrete Astro route (admin.smd.services/analytics etc.) and
  // users see the marketing-layout 404 instead of the intended admin
  // redirect. Keep 404 server-rendered — middleware must always run.
  const source = () => readFileSync(resolve('src/pages/404.astro'), 'utf-8')

  it('404.astro must have prerender = false', () => {
    const code = source()
    expect(code).toMatch(/export\s+const\s+prerender\s*=\s*false/)
    expect(code).not.toMatch(/export\s+const\s+prerender\s*=\s*true/)
  })
})

describe('middleware: session resolution gating', () => {
  // The admin-shim / legacy-portal gating invariants used to be asserted here by
  // matching the middleware SOURCE TEXT. That coupled the test to a specific
  // literal condition — and a source-regex "guard" like that locks in whatever
  // condition is written, so it would have blocked (not caught) the fleet-health
  // carve-out fix. These invariants are now covered BEHAVIORALLY in
  // tests/middleware-behavior.test.ts, which drives the real `onRequest`:
  //   - admin shim only populates locals.session on admin paths
  //   - legacy portal session only resolves on portal paths
  //   - every /api/admin path is Clerk-gated (the fleet/health carve-out was ripped 2026-07-24)
  // Runtime assertions verify the consequence, not the phrasing of the source.

  it('still has both session resolvers wired into the pipeline', () => {
    // A minimal structural smoke check: the resolvers exist and are referenced.
    // Behavior (which paths they fire on) is asserted at runtime elsewhere.
    const code = readFileSync(resolve('src/middleware.ts'), 'utf-8')
    expect(code).toContain('resolveAdminSession')
    expect(code).toContain('resolveLegacyPortalSession')
  })
})

// Legacy `admin login host guard` and `login page shows wrong_host error`
// suites were removed in PR #1059 (Clerk-unified auth decommission). The
// guarded files — src/pages/api/auth/login.ts and src/pages/auth/login.astro
// — no longer exist. The functional protection they enforced (admins must
// authenticate on the admin subdomain) is now provided by Clerk's session
// being scoped to *.smd.services + enforceAdminAuth requiring role='admin'
// from the local users row.
