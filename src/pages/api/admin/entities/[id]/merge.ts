import type { APIRoute } from 'astro'
import { mergeEntities } from '../../../../../lib/db/entities-extra'
import { env } from 'cloudflare:workers'
import { requireAdminSession } from '../../../../../lib/auth/admin-session'

/**
 * POST /api/admin/entities/[id]/merge
 *
 * Merge another entity into this one. All context from source moves to target.
 * Source entity is deleted after merge.
 *
 * Form field: source_id — the entity to merge FROM (will be deleted).
 * URL param: [id] — the entity to merge INTO (will be kept).
 */
export const POST: APIRoute = async ({ params, request, locals, redirect }) => {
  const auth = requireAdminSession(locals)
  if (!auth.ok) return auth.response
  const { session } = auth

  const targetId = params.id
  if (!targetId) {
    return redirect('/admin/entities?error=missing', 302)
  }

  try {
    const formData = await request.formData()
    const sourceId = formData.get('source_id')

    if (!sourceId || typeof sourceId !== 'string') {
      return redirect(`/admin/entities/${targetId}?error=missing_source`, 302)
    }

    await mergeEntities(env.DB, session.orgId, targetId, sourceId)

    return redirect(`/admin/entities/${targetId}?merged=1`, 302)
  } catch (err) {
    console.error('[api/admin/entities/merge] Error:', err)
    return redirect(`/admin/entities/${targetId}?error=server`, 302)
  }
}
