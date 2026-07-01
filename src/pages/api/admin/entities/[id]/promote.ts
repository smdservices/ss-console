import type { APIRoute } from 'astro'
import { getEntity, transitionStage } from '../../../../../lib/db/entities'
import { scheduleProspectCadence } from '../../../../../lib/follow-ups/scheduler'
import { env } from 'cloudflare:workers'

/**
 * POST /api/admin/entities/[id]/promote
 *
 * Transport for the "Promote" button on a manual worklist row — it handles
 * the signal → prospect stage transition and schedules the prospect
 * follow-up cadence.
 */
export const POST: APIRoute = async ({ params, locals, redirect }) => {
  const session = locals.session
  if (!session || session.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const entityId = params.id
  if (!entityId) {
    return redirect('/admin/entities?error=missing', 302)
  }

  try {
    await transitionStage(env.DB, session.orgId, entityId, 'prospect', 'Promoted from signal.')

    const entity = await getEntity(env.DB, session.orgId, entityId)
    if (!entity) {
      return redirect('/admin/entities?error=not_found', 302)
    }

    try {
      await scheduleProspectCadence(env.DB, session.orgId, entityId, new Date().toISOString())
    } catch (err) {
      console.error('[promote] Follow-up cadence scheduling failed (non-blocking):', err)
    }

    return redirect(`/admin/entities/${entityId}?promoted=1`, 302)
  } catch (err) {
    console.error('[api/admin/entities/promote] Error:', err)
    const message = err instanceof Error ? err.message : 'server'
    return redirect(`/admin/entities?error=${encodeURIComponent(message)}`, 302)
  }
}
