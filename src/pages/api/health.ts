import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { constantTimeEqual } from '../../lib/auth/constant-time'

/**
 * Health check endpoint. GET /api/health
 *
 * The public response is intentionally bare — `{ status: 'ok' }` (200) on
 * success, or `{ status: 'error' }` (503) when the database probe fails — so it
 * discloses nothing about which bindings are present (code review 2026-07-02
 * §2.4). It runs a real `SELECT 1` against D1 rather than merely checking that
 * the binding object exists, so a wedged database fails the check instead of
 * reporting a false-green (Golden Path uptime, §7). The query also serves as the
 * D1 pre-warm route (PRD Risk 9 mitigation).
 *
 * Binding-level detail is returned only to an internal caller presenting a
 * bearer token matching `HEALTH_DETAIL_TOKEN`, compared in constant time. The
 * token is optional; when it is unset the detail path is fail-closed.
 */
function hasDetailToken(request: Request, expected: string | undefined): boolean {
  if (!expected) return false
  const auth = request.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return false
  return constantTimeEqual(auth.slice('Bearer '.length), expected)
}

export const GET: APIRoute = async ({ request }) => {
  let dbOk = false
  try {
    if (typeof env.DB !== 'undefined') {
      await env.DB.prepare('SELECT 1').first()
      dbOk = true
    }
  } catch {
    dbOk = false
  }

  const body: Record<string, unknown> = { status: dbOk ? 'ok' : 'error' }

  if (hasDetailToken(request, env.HEALTH_DETAIL_TOKEN)) {
    body.bindings = {
      db: typeof env.DB !== 'undefined',
      storage: typeof env.STORAGE !== 'undefined',
      sessions: typeof env.SESSIONS !== 'undefined',
    }
    body.timestamp = new Date().toISOString()
  }

  return new Response(JSON.stringify(body), {
    status: dbOk ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
  })
}
