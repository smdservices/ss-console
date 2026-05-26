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

describe('middleware: legacy apex redirects', () => {
  const source = () => readFileSync(resolve('src/middleware.ts'), 'utf-8')

  it('uses strict hostname inequality guard for the apex admin redirect', () => {
    // CRITICAL: startsWith/endsWith would also match admin.smd.services and loop.
    // The guard uses `if (hostname !== 'smd.services') return null` form.
    const code = source()
    expect(code).toContain("hostname !== 'smd.services'")
  })

  it('redirects apex /admin/* to admin subdomain', () => {
    const code = source()
    expect(code).toMatch(
      /hostname\s*!==\s*'smd\.services'[\s\S]*?pathname\.startsWith\('\/admin\/'\)/
    )
    expect(code).toContain("newUrl.hostname = 'admin.smd.services'")
  })

  it('301s legacy auth paths to unified /auth/sign-in', () => {
    const code = source()
    // The unified-auth migration replaced the old /auth/login admin host
    // redirect with same-host 301s that funnel all legacy auth URLs to
    // the new /auth/sign-in entry point.
    expect(code).toMatch(/pathname\s*===\s*'\/auth\/login'\s*\)\s*return\s*'\/auth\/sign-in'/)
    expect(code).toMatch(
      /pathname\s*===\s*'\/auth\/portal-sign-in'\s*\)\s*return\s*'\/auth\/sign-in'/
    )
    expect(code).toMatch(
      /pathname\s*===\s*'\/auth\/portal-sign-up'\s*\)\s*return\s*'\/auth\/sign-up'/
    )
    expect(code).toMatch(
      /pathname\s*===\s*'\/auth\/portal-login'\s*\)\s*return\s*'\/auth\/sign-in'/
    )
  })

  it('uses 301 for backwards-compat redirects', () => {
    const code = source()
    expect(code).toMatch(/context\.redirect\(newUrl\.toString\(\),\s*301\)/)
  })

  it('does NOT redirect admin.smd.services to itself (no loop)', () => {
    // The guard hostname !== 'smd.services' is strict inequality, not endsWith.
    const code = source()
    expect(code).not.toContain("hostname.endsWith('smd.services')")
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
  const source = () => readFileSync(resolve('src/middleware.ts'), 'utf-8')

  it('admin session shim runs only on admin paths', () => {
    // Marketing pages are prerendered; the admin shim must not fire on
    // them (no DB hit for non-admin routes; no leakage of admin context).
    const code = source()
    expect(code).toMatch(
      /resolveAdminSession[\s\S]*?startsWith\('\/admin'\)[\s\S]*?startsWith\('\/api\/admin'\)/
    )
  })

  it('legacy portal session resolution runs only on portal paths', () => {
    // The magic-link fallback must not fire on admin or marketing paths.
    const code = source()
    expect(code).toMatch(
      /resolveLegacyPortalSession[\s\S]*?startsWith\('\/portal'\)[\s\S]*?startsWith\('\/api\/portal'\)/
    )
  })
})

// Legacy `admin login host guard` and `login page shows wrong_host error`
// suites were removed in PR #1059 (Clerk-unified auth decommission). The
// guarded files — src/pages/api/auth/login.ts and src/pages/auth/login.astro
// — no longer exist. The functional protection they enforced (admins must
// authenticate on the admin subdomain) is now provided by Clerk's session
// being scoped to *.smd.services + enforceAdminAuth requiring role='admin'
// from the local users row.
