import type { APIRoute } from 'astro'
import { createAssessment } from '../../../../lib/db/assessments'
import { env } from 'cloudflare:workers'
import { requireAdminSession } from '../../../../lib/auth/admin-session'

/**
 * POST /api/admin/assessments
 *
 * Creates a new assessment from form data and redirects to the assessment detail page.
 *
 * Protected by auth middleware (requires admin role).
 *
 * Form fields:
 *   - client_id (required)
 *   - scheduled_at
 */
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const auth = requireAdminSession(locals)
  if (!auth.ok) return auth.response
  const { session } = auth

  try {
    const formData = await request.formData()
    const clientId = formData.get('client_id')

    if (!clientId || typeof clientId !== 'string' || !clientId.trim()) {
      return redirect('/admin/entities?error=missing', 302)
    }

    const scheduledAt = formData.get('scheduled_at')

    const assessment = await createAssessment(env.DB, session.orgId, clientId.trim(), {
      scheduled_at:
        scheduledAt && typeof scheduledAt === 'string' && scheduledAt.trim()
          ? new Date(scheduledAt.trim()).toISOString()
          : null,
    })

    return redirect(`/admin/entities/${clientId.trim()}/meetings/${assessment.id}`, 302)
  } catch (err) {
    console.error('[api/admin/assessments] Create error:', err)
    const formData = await request
      .clone()
      .formData()
      .catch(() => null)
    const clientId = formData?.get('client_id')
    if (clientId && typeof clientId === 'string') {
      return redirect(`/admin/entities/${clientId}/meetings/new?error=server`, 302)
    }
    return redirect('/admin/entities?error=server', 302)
  }
}
