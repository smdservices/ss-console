import { defineMiddleware, sequence } from 'astro:middleware'
import type { APIContext, MiddlewareNext } from 'astro'
import { clerkMiddleware } from '@clerk/astro/server'
import {
  parseSessionToken,
  validateSession,
  renewSession,
  buildSessionCookie,
  buildClearSessionCookie,
} from './lib/auth/session'
import { withSentryRequestHandler } from './lib/observability/sentry'
import { env } from 'cloudflare:workers'

/**
 * Astro middleware — handles auth for protected routes.
 *
 * Host → path mapping (three custom domains on one Worker):
 *   admin.smd.services/*   → rewritten to /admin/* (magic-link auth, role=admin)
 *   portal.smd.services/*  → rewritten to /portal/* (Clerk auth)
 *   smd.services/*         → marketing (public); /admin/* and /auth/login 301
 *                            to admin.smd.services for backwards compat
 *
 * Auth model:
 *   - Portal (portal.smd.services) — Clerk owns identity. clerkMiddleware
 *     (composed before ssMiddleware via sequence()) populates locals.auth()
 *     and locals.currentUser(). enforcePortalAuth gates routes on
 *     locals.auth().userId; the bridge from Clerk identity to local
 *     users/entities runs in getPortalClient (src/lib/portal/session.ts).
 *   - Admin (admin.smd.services) — legacy magic-link auth. Sessions stored
 *     in D1 + KV. resolveSession reads the session_token cookie;
 *     enforceAdminAuth gates routes on locals.session.role === 'admin'.
 */

type NextFn = MiddlewareNext

async function resolveSession(context: APIContext, pathname: string): Promise<string | null> {
  const isProtectedRoute =
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api/admin') ||
    pathname.startsWith('/portal') ||
    pathname.startsWith('/api/portal')
  const needsSession =
    isProtectedRoute || pathname.startsWith('/auth') || pathname.startsWith('/api/')

  if (!needsSession) return null

  const cookieHeader = context.request.headers.get('cookie')
  const token = parseSessionToken(cookieHeader)
  if (!token) return null

  const sessionData = await validateSession(env.DB, env.SESSIONS, token)
  if (sessionData) {
    context.locals.session = sessionData
    renewSession(env.DB, env.SESSIONS, token, sessionData).catch(() => {})
  }
  return token
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
    !pathname.startsWith('/api/auth')
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
  if (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/auth/login' ||
    pathname.startsWith('/auth/login')
  ) {
    const newUrl = new URL(context.url)
    newUrl.hostname = 'admin.smd.services'
    return context.redirect(newUrl.toString(), 301)
  }
  return null
}

function handleLegacyRedirects(
  context: APIContext,
  hostname: string,
  pathname: string
): Response | null {
  const adminRedirect = redirectToAdminHost(context, hostname, pathname)
  if (adminRedirect) return adminRedirect
  if (pathname === '/book/thanks' || pathname.startsWith('/book/thanks/'))
    return context.redirect('/get-started?booked=1', 301)
  if (pathname === '/scan') return context.redirect('/', 301)
  if (pathname === '/scorecard' || pathname.startsWith('/scorecard/'))
    return context.redirect('/', 301)
  if (pathname === '/get-started' && !context.url.searchParams.has('booked'))
    return context.redirect('/', 301)
  if (pathname === '/outside-view' || pathname.startsWith('/outside-view/'))
    return context.redirect('/', 301)
  return null
}

function jsonResponse(body: object, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function enforceAdminAuth(
  context: APIContext,
  isAdminRoute: boolean,
  isAdminApiRoute: boolean
): Response | null {
  if (!context.locals.session) {
    return isAdminApiRoute
      ? jsonResponse({ error: 'Unauthorized' }, 401)
      : context.redirect('/auth/login')
  }
  if (context.locals.session.role !== 'admin') {
    return isAdminApiRoute
      ? jsonResponse({ error: 'Forbidden' }, 403)
      : context.redirect('/auth/login')
  }
  return null
}

function enforcePortalAuth(context: APIContext, isPortalApiRoute: boolean): Response | null {
  // Portal auth is owned by Clerk. clerkMiddleware (composed before
  // ssMiddleware via sequence()) populates locals.auth() with the
  // current request's Clerk session state. We only check userId
  // presence here — bridge from Clerk identity to local user/entity
  // happens lazily in getPortalClient() per-route.
  const auth = context.locals.auth()
  if (!auth.userId) {
    return isPortalApiRoute
      ? jsonResponse({ error: 'Unauthorized' }, 401)
      : context.redirect('/auth/portal-sign-in')
  }
  return null
}

function enforceAuth(context: APIContext, pathname: string): Response | null {
  const isAdminRoute = pathname.startsWith('/admin')
  const isAdminApiRoute = pathname.startsWith('/api/admin')
  const isPortalRoute = pathname.startsWith('/portal')
  const isPortalApiRoute = pathname.startsWith('/api/portal')

  if (isAdminRoute || isAdminApiRoute) {
    return enforceAdminAuth(context, isAdminRoute, isAdminApiRoute)
  }
  if (isPortalRoute || isPortalApiRoute) {
    return enforcePortalAuth(context, isPortalApiRoute)
  }
  return null
}

function applySessionCookie(
  response: Response,
  context: APIContext,
  token: string,
  hostname: string
): void {
  // SS-side magic-link cookies only apply to the admin console. Portal
  // sessions are owned by Clerk (cookie management handled by
  // clerkMiddleware on the auth.smd.services subdomain).
  const session = context.locals.session
  if (!session || session.role !== 'admin') return
  const isAdminHost = hostname.startsWith('admin.')
  if (isAdminHost) {
    response.headers.append('Set-Cookie', buildSessionCookie(token, session.role))
  } else if (hostname === 'smd.services') {
    response.headers.append('Set-Cookie', buildClearSessionCookie())
  }
}

async function handleRequest(context: APIContext, next: NextFn): Promise<Response> {
  const { pathname } = context.url
  const hostname = context.url.hostname

  const subdomainRewrite = handleSubdomainRewrite(context, hostname, pathname)
  if (subdomainRewrite) return subdomainRewrite

  const legacyRedirect = handleLegacyRedirects(context, hostname, pathname)
  if (legacyRedirect) return legacyRedirect

  context.locals.session = null
  const token = await resolveSession(context, pathname)

  const authDenial = enforceAuth(context, pathname)
  if (authDenial) return authDenial

  const response = await next()
  if (token) applySessionCookie(response, context, token, hostname)
  return response
}

// Composed middleware pipeline:
//   1. clerkMiddleware  — parses Clerk session, populates locals.auth()
//                         and locals.currentUser() for downstream handlers.
//                         Does NOT enforce auth on any route.
//   2. ssMiddleware     — SS-owned: subdomain rewrites, legacy redirects,
//                         magic-link session validation (admin only), and
//                         auth enforcement (Clerk for portal, magic-link
//                         for admin).
//
// The bridge from Clerk identity to local users/entities runs lazily in
// getPortalClient() per portal page, not in middleware.
const ssMiddleware = defineMiddleware(async (context: APIContext, next: NextFn) => {
  return withSentryRequestHandler(context, () => handleRequest(context, next))
})

export const onRequest = sequence(clerkMiddleware(), ssMiddleware)
