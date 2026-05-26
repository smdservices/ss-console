import type { APIRoute } from 'astro'
import {
  parseSessionToken,
  validateSession,
  destroySession,
  buildClearSessionCookie,
} from '../../../lib/auth/session'
import { env } from 'cloudflare:workers'

/**
 * POST /api/auth/logout — legacy admin logout endpoint.
 *
 * As of the 2026-05-25 Clerk-unified auth migration, admin sign-out is
 * driven by Clerk's <SignOutButton /> in AdminLayout.astro. This endpoint
 * stays for one deploy as a backstop in case any cached form still POSTs
 * to it. It destroys any lingering legacy D1 session, clears the legacy
 * cookie, and redirects to the unified sign-in. PR 3 removes the file.
 */
export const POST: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie')
  const token = parseSessionToken(cookieHeader)

  if (token) {
    // Validate first to avoid spamming D1 with delete-by-nonexistent-token.
    const session = await validateSession(env.DB, env.SESSIONS, token)
    if (session) {
      await destroySession(env.DB, env.SESSIONS, token)
    }
  }

  const clearCookie = buildClearSessionCookie()
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/auth/sign-in?status=signed_out',
      'Set-Cookie': clearCookie,
    },
  })
}
