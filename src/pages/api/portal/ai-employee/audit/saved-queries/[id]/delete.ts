import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resolveAiEmployeeAccess } from '../../../../../../../lib/portal/ai-employee-access'
import { deleteSavedQuery } from '../../../../../../../lib/portal/ai-employee/audit-saved-queries'

/**
 * POST /api/portal/ai-employee/audit/saved-queries/:id/delete
 *
 * Delete a single saved query. Driven by an HTML <form method="POST">
 * "Delete" button in the audit page's saved-queries panel.
 *
 * Authorization:
 *   - Active AI Employee subscription
 *   - Caller holds principal OR compliance role
 *   - The delete query is scoped to (user_id, entity_id, id) so an id
 *     belonging to a different user is a no-op (returns 0 changes)
 *     rather than leaking the existence of cross-user rows.
 *
 * Returns 303 to the audit page (or `returnTo` when supplied).
 */
const AUDIT_PAGE = '/portal/products/ai-employee/audit'

function resolveReturnTarget(raw: FormDataEntryValue | null): string {
  if (typeof raw !== 'string') return AUDIT_PAGE
  const trimmed = raw.trim()
  if (trimmed.length === 0) return AUDIT_PAGE
  if (!trimmed.startsWith('/portal/products/ai-employee')) return AUDIT_PAGE
  if (trimmed.startsWith('//')) return AUDIT_PAGE
  if (trimmed.includes(':')) return AUDIT_PAGE
  return trimmed
}

function withDeletedParam(target: string, deleted: number): string {
  const url = new URL(target, 'https://placeholder.invalid')
  url.searchParams.set('deleted', String(deleted))
  return `${url.pathname}${url.search}`
}

export const POST: APIRoute = async ({ request, params, locals }) => {
  const access = await resolveAiEmployeeAccess(env.DB, locals, {
    allowedRoles: ['principal', 'compliance'],
  })
  if (access.kind === 'redirect') {
    return new Response(null, { status: 303, headers: { Location: access.to } })
  }
  const { user, client } = access

  const id = typeof params.id === 'string' ? params.id : ''
  if (id.length === 0) {
    return new Response(null, { status: 303, headers: { Location: AUDIT_PAGE } })
  }

  const formData = await request.formData()
  const returnTarget = resolveReturnTarget(formData.get('returnTo'))

  const deleted = await deleteSavedQuery(env.DB, {
    userId: user.id,
    entityId: client.id,
    id,
  })

  return new Response(null, {
    status: 303,
    headers: { Location: withDeletedParam(returnTarget, deleted) },
  })
}
