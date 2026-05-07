import { defineMiddleware } from 'astro:middleware'
import type { APIContext, MiddlewareNext } from 'astro'
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
 * Host → path mapping (three custom domains on one Pages project):
 *   admin.smd.services/*   → rewritten to /admin/* (admin console, role=admin)
 *   portal.smd.services/*  → rewritten to /portal/* (client portal, role=client)
 *   smd.services/*         → marketing (public); /admin/* and /auth/login 301
 *                            to admin.smd.services for backwards compat
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

function enforceRoleGate(
  context: APIContext,
  isAdminRoute: boolean,
  isAdminApiRoute: boolean,
  isPortalRoute: boolean,
  isPortalApiRoute: boolean
): Response | null {
  const sessionRole = context.locals.session?.role
  const isAdminAccess = (isAdminRoute || isAdminApiRoute) && sessionRole === 'admin'
  const isPortalAccess = (isPortalRoute || isPortalApiRoute) && sessionRole === 'client'
  if (isAdminAccess || isPortalAccess) return null
  if (isAdminApiRoute || isPortalApiRoute) return jsonResponse({ error: 'Forbidden' }, 403)
  return context.redirect(isPortalRoute ? '/auth/portal-login' : '/auth/login')
}

function enforceAuth(context: APIContext, pathname: string): Response | null {
  const isAdminRoute = pathname.startsWith('/admin')
  const isAdminApiRoute = pathname.startsWith('/api/admin')
  const isPortalRoute = pathname.startsWith('/portal')
  const isPortalApiRoute = pathname.startsWith('/api/portal')
  const isProtectedRoute = isAdminRoute || isAdminApiRoute || isPortalRoute || isPortalApiRoute

  if (!isProtectedRoute) return null
  if (!context.locals.session) {
    if (isAdminApiRoute || isPortalApiRoute) return jsonResponse({ error: 'Unauthorized' }, 401)
    return context.redirect(isPortalRoute ? '/auth/portal-login' : '/auth/login')
  }
  return enforceRoleGate(context, isAdminRoute, isAdminApiRoute, isPortalRoute, isPortalApiRoute)
}

function applySessionCookie(
  response: Response,
  context: APIContext,
  token: string,
  hostname: string
): void {
  const session = context.locals.session
  if (!session) return
  const isPortalHost = hostname.startsWith('portal.')
  const isAdminHost = hostname.startsWith('admin.')
  const isPortalSession = session.role === 'client'
  const isAdminSession = session.role === 'admin'
  const hostMatches = (isPortalSession && isPortalHost) || (isAdminSession && isAdminHost)
  if (hostMatches) {
    response.headers.append('Set-Cookie', buildSessionCookie(token, session.role))
  } else if (hostname === 'smd.services' && isAdminSession) {
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

export const onRequest = defineMiddleware(async (context: APIContext, next: NextFn) => {
  return withSentryRequestHandler(context, () => handleRequest(context, next))
})
