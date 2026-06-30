import { defineMiddleware, sequence } from 'astro:middleware'
import type { APIContext, MiddlewareNext } from 'astro'
import { clerkMiddleware } from '@clerk/astro/server'
import { resolveAdminSessionFromClerk } from './lib/auth/admin-session-shim'
import { parseSessionToken, validateSession, renewSession } from './lib/auth/session'
import { withSentryRequestHandler } from './lib/observability/sentry'
import { env } from 'cloudflare:workers'

/**
 * Astro middleware — handles auth for protected routes.
 *
 * Host → path mapping (three custom domains on one Worker):
 *   admin.smd.services/*   → rewritten to /admin/* (Clerk auth, role=admin gated)
 *   portal.smd.services/*  → rewritten to /portal/* (Clerk auth)
 *   smd.services/*         → marketing (public) and unified /auth/sign-in;
 *                            /admin/* 301s to admin.smd.services for
 *                            backwards compat. /auth/login 301s to
 *                            /auth/sign-in (handled by legacy-redirect path).
 *
 * Auth model (unified 2026-05-25):
 *   - Clerk owns identity for both admin and portal. clerkMiddleware
 *     (composed before ssMiddleware via sequence()) populates
 *     locals.auth() and locals.currentUser() for downstream handlers.
 *   - On admin paths, resolveAdminSessionFromClerk maps the Clerk user_id
 *     to the local users row (role='admin' gated) and synthesizes the
 *     legacy SessionData shape into locals.session so the 73 existing
 *     call sites (entity queries, OAuth CSRF, email display, etc.) keep
 *     working without per-site refactor. See admin-session-shim.ts.
 *   - On portal paths, Clerk is the primary path. Legacy magic-link
 *     sessions (created by /auth/verify via createSession) are still
 *     accepted as a fallback so client onboarding via invitation email
 *     keeps working. New client onboarding will migrate to Clerk
 *     invitations in a follow-up; the legacy path remains active until
 *     all in-flight invitations have expired.
 */

type NextFn = MiddlewareNext

async function resolveAdminSession(context: APIContext, pathname: string): Promise<void> {
  const isAdminRoute = pathname.startsWith('/admin') || pathname.startsWith('/api/admin')
  if (!isAdminRoute) return

  const auth = context.locals.auth()
  if (!auth.userId) return

  const sessionData = await resolveAdminSessionFromClerk(auth.userId, env.DB, env.SESSIONS)
  if (sessionData) {
    context.locals.session = sessionData
  }
}

/**
 * Resolve legacy magic-link sessions for client portal access. Returns
 * the session token if validated (so callers can renew + extend the
 * cookie sliding-window). Clerk is the primary auth path for portal;
 * this fallback exists only to keep in-flight invitation links working
 * during the Clerk transition.
 */
async function resolveLegacyPortalSession(
  context: APIContext,
  pathname: string
): Promise<string | null> {
  const isPortalRoute = pathname.startsWith('/portal') || pathname.startsWith('/api/portal')
  if (!isPortalRoute) return null

  const cookieHeader = context.request.headers.get('cookie')
  const token = parseSessionToken(cookieHeader)
  if (!token) return null

  const sessionData = await validateSession(env.DB, env.SESSIONS, token)
  if (sessionData && sessionData.role === 'client') {
    context.locals.session = sessionData
    // Fire-and-forget sliding-window renewal: a KV/D1 write failure here must
    // not fail an otherwise-authenticated request. The session stays valid off
    // its existing expiry; the next request retries the renewal.
    renewSession(env.DB, env.SESSIONS, token, sessionData).catch(() => {})
    return token
  }
  return null
}

function handleSubdomainRewrite(
  context: APIContext,
  hostname: string,
  pathname: string
): Promise<Response> | null {
  const isPortalSubdomain = hostname.startsWith('portal.')
  if (
    isPortalSubdomain &&
    !pathname.startsWith('/portal') &&
    !pathname.startsWith('/api/portal') &&
    !pathname.startsWith('/auth') &&
    !pathname.startsWith('/api/auth')
  ) {
    const portalPath = pathname === '/' ? '/portal' : `/portal${pathname}`
    return context.rewrite(new Request(new URL(portalPath, context.url), context.request))
  }

  const isAdminSubdomain = hostname.startsWith('admin.')
  if (
    isAdminSubdomain &&
    !pathname.startsWith('/admin') &&
    !pathname.startsWith('/api/admin') &&
    !pathname.startsWith('/auth') &&
    !pathname.startsWith('/api/auth') &&
    !pathname.startsWith('/api/oauth')
  ) {
    const adminPath = pathname === '/' ? '/admin' : `/admin${pathname}`
    return context.rewrite(new Request(new URL(adminPath, context.url), context.request))
  }

  return null
}

function redirectToAdminHost(
  context: APIContext,
  hostname: string,
  pathname: string
): Response | null {
  if (hostname !== 'smd.services') return null
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const newUrl = new URL(context.url)
    newUrl.hostname = 'admin.smd.services'
    return context.redirect(newUrl.toString(), 301)
  }
  return null
}

/**
 * Legacy auth-path 301 redirects. Old URLs from the dual-auth era keep
 * working so external links (Clerk invitation emails, bookmarks, prior
 * code review docs) don't break.
 */
function redirectLegacyAuthPaths(context: APIContext, pathname: string): Response | null {
  const target = legacyAuthRedirectTarget(pathname)
  if (!target) return null
  const newUrl = new URL(context.url)
  newUrl.pathname = target
  // Preserve query string (status=signed_out, etc.)
  return context.redirect(newUrl.toString(), 301)
}

function legacyAuthRedirectTarget(pathname: string): string | null {
  if (pathname === '/auth/login') return '/auth/sign-in'
  if (pathname === '/auth/portal-sign-in') return '/auth/sign-in'
  if (pathname === '/auth/portal-sign-up') return '/auth/sign-up'
  if (pathname === '/auth/portal-login') return '/auth/sign-in'
  return null
}

/**
 * Product renamed "AI Employee" → "Operator" (ADR 0034). Permanent (301)
 * redirects from the pre-rename `/ai-employee` URLs to `/operator` so old
 * bookmarks and indexed links keep working. Runs before the subdomain rewrite,
 * so it must handle both the canonical paths and the subdomain-relative forms
 * the rewrite would prepend. The SOURCES are the legacy `/ai-employee` paths —
 * do not rename them to `/operator` (that would self-redirect into a loop).
 */
function redirectLegacyOperatorPaths(
  context: APIContext,
  hostname: string,
  pathname: string
): Response | null {
  // Marketing product page: smd.services/ai-employee → /operator.
  // Also covers admin.smd.services/ai-employee (rewrites to /admin/operator
  // after the redirect lands on the operator path).
  if (pathname === '/ai-employee' || pathname.startsWith('/ai-employee/'))
    return context.redirect(pathname.replace('/ai-employee', '/operator'), 301)

  // Portal product surface: canonical (/portal/products/ai-employee) and the
  // portal-subdomain-relative form (/products/ai-employee).
  for (const oldPath of ['/portal/products/ai-employee', '/products/ai-employee']) {
    if (pathname === oldPath || pathname.startsWith(`${oldPath}/`))
      return context.redirect(pathname.replace('/ai-employee', '/operator'), 301)
  }

  // Admin surface: canonical /admin/ai-employee (the admin-subdomain-relative
  // /ai-employee form is already handled by the marketing rule above).
  if (pathname === '/admin/ai-employee' || pathname.startsWith('/admin/ai-employee/'))
    return context.redirect(pathname.replace('/ai-employee', '/operator'), 301)

  return null
}

// Retired marketing routes → 301 to the surviving surface that absorbed them.
// Marketing consolidated 2026-06-29 (firm-with-flagship structure, 5 page types):
// the comparison argument moved onto /operator; firm breadth onto the home + the
// assessment; the /ai toe-dip page is retired now that the firm is all-in on AI.
// Also folds the older lead-magnet retirements (/scan, /scorecard, /outside-view,
// the cold /get-started). The SOURCES here are the retired paths — do not rename
// them (that would self-redirect).
//
// NOTE: /contact is NOT retired. Captain decision 2026-06-30 restored it as the
// quiet general-inquiry channel (a real form, not a published email). See
// docs/marketing/positioning-spine.md change-control log.
function redirectRetiredMarketingPaths(context: APIContext, pathname: string): Response | null {
  const exactToHome = new Set(['/scan', '/consulting', '/ai'])
  if (exactToHome.has(pathname)) return context.redirect('/', 301)

  const prefixToHome = ['/scorecard', '/outside-view', '/consulting/', '/ai/']
  if (prefixToHome.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p)))
    return context.redirect('/', 301)

  if (pathname === '/why' || pathname.startsWith('/why/'))
    return context.redirect('/operator#compare', 301)
  if (pathname === '/get-started' && !context.url.searchParams.has('booked'))
    return context.redirect('/', 301)
  return null
}

function handleLegacyRedirects(
  context: APIContext,
  hostname: string,
  pathname: string
): Response | null {
  const adminRedirect = redirectToAdminHost(context, hostname, pathname)
  if (adminRedirect) return adminRedirect
  const authRedirect = redirectLegacyAuthPaths(context, pathname)
  if (authRedirect) return authRedirect
  if (pathname === '/book/thanks' || pathname.startsWith('/book/thanks/'))
    return context.redirect('/get-started?booked=1', 301)
  return redirectRetiredMarketingPaths(context, pathname)
}

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function enforceAdminAuth(context: APIContext, isAdminApiRoute: boolean): Response | null {
  const auth = context.locals.auth()
  if (!auth.userId) {
    return isAdminApiRoute
      ? jsonResponse({ error: 'Unauthorized' }, 401)
      : context.redirect('/auth/sign-in')
  }
  // Clerk user signed in but no admin row in D1 (or role != 'admin').
  // Treat as forbidden — they're authenticated but lack admin clearance.
  if (!context.locals.session || context.locals.session.role !== 'admin') {
    return isAdminApiRoute ? jsonResponse({ error: 'Forbidden' }, 403) : context.redirect('/portal')
  }
  return null
}

function enforcePortalAuth(context: APIContext, isPortalApiRoute: boolean): Response | null {
  // Clerk is the primary portal auth path. clerkMiddleware (composed
  // before ssMiddleware via sequence()) populates locals.auth() with
  // the current request's Clerk session state. The bridge from Clerk
  // identity to local user/entity runs lazily in getPortalClient()
  // per-route.
  //
  // Legacy magic-link sessions (set by /auth/verify, populated into
  // locals.session by resolveLegacyPortalSession) are accepted as a
  // fallback so in-flight invitation emails continue to work during
  // the Clerk transition.
  const auth = context.locals.auth()
  if (auth.userId) return null
  if (context.locals.session?.role === 'client') return null

  return isPortalApiRoute
    ? jsonResponse({ error: 'Unauthorized' }, 401)
    : context.redirect('/auth/sign-in')
}

function enforceAuth(context: APIContext, pathname: string): Response | null {
  const isAdminRoute = pathname.startsWith('/admin')
  const isAdminApiRoute = pathname.startsWith('/api/admin')
  const isPortalRoute = pathname.startsWith('/portal')
  const isPortalApiRoute = pathname.startsWith('/api/portal')

  if (isAdminRoute || isAdminApiRoute) {
    return enforceAdminAuth(context, isAdminApiRoute)
  }
  if (isPortalRoute || isPortalApiRoute) {
    return enforcePortalAuth(context, isPortalApiRoute)
  }
  return null
}

async function handleRequest(context: APIContext, next: NextFn): Promise<Response> {
  const { pathname } = context.url
  const hostname = context.url.hostname

  // Product renamed "Operator" → "Operator" (ADR 0034). 301 old paths
  // before the subdomain rewrite, since the rewrite terminates the chain.
  const operatorRename = redirectLegacyOperatorPaths(context, hostname, pathname)
  if (operatorRename) return operatorRename

  const subdomainRewrite = handleSubdomainRewrite(context, hostname, pathname)
  if (subdomainRewrite) return subdomainRewrite

  const legacyRedirect = handleLegacyRedirects(context, hostname, pathname)
  if (legacyRedirect) return legacyRedirect

  context.locals.session = null
  await resolveAdminSession(context, pathname)
  await resolveLegacyPortalSession(context, pathname)

  const authDenial = enforceAuth(context, pathname)
  if (authDenial) return authDenial

  return await next()
}

// Composed middleware pipeline:
//   1. clerkMiddleware  — parses Clerk session, populates locals.auth()
//                         and locals.currentUser() for downstream handlers.
//                         Does NOT enforce auth on any route.
//   2. ssMiddleware     — SS-owned: subdomain rewrites, legacy redirects,
//                         admin session shim, and auth enforcement
//                         (Clerk for both portal and admin; admin gated
//                         on role='admin' via the shim).
const ssMiddleware = defineMiddleware(async (context: APIContext, next: NextFn) => {
  return withSentryRequestHandler(context, () => handleRequest(context, next))
})

export const onRequest = sequence(clerkMiddleware(), ssMiddleware)
