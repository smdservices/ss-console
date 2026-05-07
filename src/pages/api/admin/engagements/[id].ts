import type { APIContext, APIRoute } from 'astro'
import {
  getEngagement,
  updateEngagement,
  updateEngagementStatus,
} from '../../../../lib/db/engagements'
import type { EngagementStatus } from '../../../../lib/db/engagements'
import { getSignalById } from '../../../../lib/db/signal-attribution'
import { env } from 'cloudflare:workers'

/**
 * POST /api/admin/engagements/:id
 *
 * Updates an existing engagement from form data.
 * Handles field updates and status transitions.
 *
 * Protected by auth middleware (requires admin role).
 */

function trimOrNull(v: FormDataEntryValue | null): string | null {
  return v && typeof v === 'string' && v.trim() ? v.trim() : null
}

function parseFloat2(v: FormDataEntryValue | null): number | null | undefined {
  if (!v || typeof v !== 'string' || !v.trim()) return null
  return parseFloat(v) || null
}

type EngagementUpdate = Parameters<typeof updateEngagement>[3]

function buildEngagementUpdate(
  formData: FormData,
  originatingSignalId: string | null | undefined
): EngagementUpdate {
  const scopeRaw = formData.get('scope_summary')
  const update: EngagementUpdate = {
    scope_summary: scopeRaw && typeof scopeRaw === 'string' ? scopeRaw.trim() || null : undefined,
    start_date: trimOrNull(formData.get('start_date')),
    estimated_end: trimOrNull(formData.get('estimated_end')),
    estimated_hours: parseFloat2(formData.get('estimated_hours')),
    actual_hours: parseFloat2(formData.get('actual_hours')),
  }
  if (originatingSignalId !== undefined) {
    update.originating_signal_id = originatingSignalId
  }
  return update
}

async function resolveSignalEdit(
  orgId: string,
  entityId: string,
  signalRaw: FormDataEntryValue | null
): Promise<string | null | undefined> {
  if (typeof signalRaw !== 'string') return undefined
  const v = signalRaw.trim()
  if (v === '__none__') return null
  if (v === '') return undefined
  const signal = await getSignalById(env.DB, orgId, v)
  return signal && signal.entity_id === entityId ? signal.id : undefined
}

async function handlePost({ request, locals, redirect, params }: APIContext): Promise<Response> {
  const session = locals.session
  if (!session || session.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const engagementId = params.id
  if (!engagementId) {
    return new Response(JSON.stringify({ error: 'Engagement ID required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const existing = await getEngagement(env.DB, session.orgId, engagementId)
    if (!existing) return redirect('/admin/entities?error=not_found', 302)

    const formData = await request.formData()
    const action = formData.get('action')

    if (action === 'transition_status') {
      const newStatus = formData.get('new_status')
      if (!newStatus || typeof newStatus !== 'string') {
        return redirect(`/admin/engagements/${engagementId}?error=invalid_status`, 302)
      }
      try {
        await updateEngagementStatus(
          env.DB,
          session.orgId,
          engagementId,
          newStatus as EngagementStatus
        )
      } catch (err) {
        console.error('[api/admin/engagements/[id]] Status transition error:', err)
        return redirect(`/admin/engagements/${engagementId}?error=invalid_transition`, 302)
      }
      return redirect(`/admin/engagements/${engagementId}?saved=1`, 302)
    }

    const originatingSignalId = await resolveSignalEdit(
      session.orgId,
      existing.entity_id,
      formData.get('originating_signal_id')
    )

    const updateFields = buildEngagementUpdate(formData, originatingSignalId)
    await updateEngagement(env.DB, session.orgId, engagementId, updateFields)

    return redirect(`/admin/engagements/${engagementId}?saved=1`, 302)
  } catch (err) {
    console.error('[api/admin/engagements/[id]] Update error:', err)
    return redirect('/admin/entities?error=server', 302)
  }
}

export const POST: APIRoute = (ctx) => handlePost(ctx)
