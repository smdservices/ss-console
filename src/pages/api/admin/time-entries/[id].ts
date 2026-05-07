import type { APIContext, APIRoute } from 'astro'
import { getTimeEntry, updateTimeEntry, deleteTimeEntry } from '../../../../lib/db/time-entries'
import { getEngagement } from '../../../../lib/db/engagements'
import { env } from 'cloudflare:workers'

/**
 * POST /api/admin/time-entries/:id
 *
 * Updates or deletes a time entry (via _method=DELETE).
 *
 * Protected by auth middleware (requires admin role).
 *
 * Form fields for update:
 *   - client_id (required, for redirect)
 *   - date
 *   - hours
 *   - description
 *   - category
 *
 * Form fields for delete:
 *   - _method: "DELETE"
 *   - client_id (required, for redirect)
 */

function parseOptionalStr(v: FormDataEntryValue | null): string | null | undefined {
  if (v === null) return undefined
  if (typeof v !== 'string') return undefined
  return v.trim() || null
}

function parseOptionalFloat(v: FormDataEntryValue | null): number | undefined {
  if (!v || typeof v !== 'string' || !v.trim()) return undefined
  return parseFloat(v) || undefined
}

function buildUpdateFields(formData: FormData) {
  const date = formData.get('date')
  const hours = formData.get('hours')
  return {
    date: date && typeof date === 'string' && date.trim() ? date.trim() : undefined,
    hours: parseOptionalFloat(hours),
    description: parseOptionalStr(formData.get('description')),
    category: parseOptionalStr(formData.get('category')),
  }
}

async function handlePost({ request, locals, redirect, params }: APIContext): Promise<Response> {
  const session = locals.session
  if (!session || session.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const entryId = params.id
  if (!entryId) {
    return new Response(JSON.stringify({ error: 'Time entry ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const entry = await getTimeEntry(env.DB, session.orgId, entryId)
    if (!entry) {
      return redirect('/admin/entities?error=not_found', 302)
    }

    // Engagement lookup still runs for the redirect path resolution; scoping
    // is already enforced by getTimeEntry above.
    const engagement = await getEngagement(env.DB, session.orgId, entry.engagement_id)
    if (!engagement) {
      return redirect('/admin/entities?error=not_found', 302)
    }

    const formData = await request.formData()
    const clientId = formData.get('client_id')
    const clientIdStr =
      clientId && typeof clientId === 'string' ? clientId.trim() : engagement.entity_id

    const timeUrl = `/admin/entities/${clientIdStr}/engagements/${entry.engagement_id}/time`
    const method = formData.get('_method')

    if (method === 'DELETE') {
      await deleteTimeEntry(env.DB, session.orgId, entryId)
      return redirect(`${timeUrl}?deleted=1`, 302)
    }

    await updateTimeEntry(env.DB, session.orgId, entryId, buildUpdateFields(formData))
    return redirect(`${timeUrl}?saved=1`, 302)
  } catch (err) {
    console.error('[api/admin/time-entries/[id]] Error:', err)
    return redirect('/admin/entities?error=server', 302)
  }
}

export const POST: APIRoute = (ctx) => handlePost(ctx)
