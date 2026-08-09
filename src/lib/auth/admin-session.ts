/**
 * Admin route guard: asserts `locals.session` carries role='admin'.
 *
 * Three modules share the word "session" and are easy to confuse:
 *   - admin-session.ts (this file): the guard. Reads what middleware put
 *     in locals.session. Mints nothing, touches no store.
 *   - admin-session-shim.ts: populates locals.session on admin paths by
 *     adapting Clerk identity into the legacy SessionData shape. This is
 *     the live admin path.
 *   - session.ts: the legacy magic-link D1 + KV session store, retained
 *     only as a portal fallback for in-flight client invitations.
 */
export interface AdminSession {
  userId: string
  orgId: string
  role: 'admin'
  email: string
  expiresAt: string
}

export type RequireAdminSessionResult =
  { ok: true; session: AdminSession } | { ok: false; response: Response }

export function requireAdminSession(
  locals: Pick<App.Locals, 'session'>
): RequireAdminSessionResult {
  const session = locals.session
  if (!session || session.role !== 'admin') {
    return { ok: false, response: adminUnauthorizedResponse() }
  }
  return { ok: true, session: { ...session, role: 'admin' } }
}

function adminUnauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}
