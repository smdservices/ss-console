import type { APIContext, APIRoute } from 'astro'
import { getEngagement } from '../../../../lib/db/engagements'
import { createTimeEntry } from '../../../../lib/db/time-entries'
import { env } from 'cloudflare:workers'

/**
 * POST /api/admin/time-entries
 *
 * Creates a new time entry for an engagement.
 *
 * Protected by auth middleware (requires admin role).
 *
 * Form fields:
 *   - engagement_id (required)
 *   - client_id (required, for redirect)
 *   - date (required)
 *   - hours (required)
 *   - description
 *   - category
 */

function strOrNull(v: FormDataEntryValue | null): string | null {
  return v && typeof v === 'string' && v.trim() ? v.trim() : null
}

function validateTimeForm(
  formData: FormData
): { engagementId: string; clientId: string; date: string; hours: number } | null {
  const engagementId = formData.get('engagement_id')
  const clientId = formData.get('client_id')
  const date = formData.get('date')
  const hours = formData.get('hours')

  if (
    !engagementId ||
    typeof engagementId !== 'string' ||
    !clientId ||
    typeof clientId !== 'string' ||
    !date ||
    typeof date !== 'string' ||
    !date.trim() ||
    !hours ||
    typeof hours !== 'string' ||
    !hours.trim()
  ) {
    return null
  }

  const parsedHours = parseFloat(hours)
  if (isNaN(parsedHours) || parsedHours <= 0) return null

  return {
    engagementId: engagementId.trim(),
    clientId: clientId.trim(),
    date: date.trim(),
    hours: parsedHours,
  }
}

async function handlePost({ request, locals, redirect }: APIContext): Promise<Response> {
  const session = locals.session
  if (!session || session.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const formData = await request.formData()
    const validated = validateTimeForm(formData)

    if (!validated) {
      return redirect('/admin/entities?error=missing', 302)
    }

    const { engagementId, clientId, date, hours } = validated

    const engagement = await getEngagement(env.DB, session.orgId, engagementId)
    if (!engagement) {
      return redirect('/admin/entities?error=not_found', 302)
    }

    const timeUrl = `/admin/entities/${clientId}/engagements/${engagementId}/time`

    const description = strOrNull(formData.get('description'))
    const category = strOrNull(formData.get('category'))

    await createTimeEntry(env.DB, session.orgId, engagementId, {
      date,
      hours,
      description,
      category,
    })

    return redirect(`${timeUrl}?saved=1`, 302)
  } catch (err) {
    console.error('[api/admin/time-entries] Create error:', err)
    return redirect('/admin/entities?error=server', 302)
  }
}

export const POST: APIRoute = (ctx) => handlePost(ctx)
