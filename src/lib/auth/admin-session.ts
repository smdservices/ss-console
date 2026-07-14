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

export function adminUnauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}
