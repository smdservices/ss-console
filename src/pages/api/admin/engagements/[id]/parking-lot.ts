import type { APIRoute } from 'astro'
import { getEngagement } from '../../../../../lib/db/engagements'
import {
  createParkingLotItem,
  dispositionParkingLotItem,
  deleteParkingLotItem,
  getParkingLotItem,
  DISPOSITIONS,
} from '../../../../../lib/db/parking-lot'
import type { Disposition } from '../../../../../lib/db/parking-lot'
import { appendContext } from '../../../../../lib/db/context'
import { env } from 'cloudflare:workers'

/**
 * POST /api/admin/engagements/:id/parking-lot
 *
 * Manages parking lot items on an engagement (Decision Stack #11). Single
 * endpoint with action dispatcher, mirroring the milestones pattern.
 *
 * Protected by auth middleware (requires admin role).
 *
 * Form fields for create:
 *   - description (required)
 *   - requested_by (optional)
 *
 * Form fields for disposition:
 *   - action: "disposition"
 *   - item_id (required)
 *   - disposition (required, one of: fold_in | follow_on | dropped)
 *   - disposition_note (required, non-empty)
 *
 * Form fields for delete:
 *   - _method: "DELETE"
 *   - item_id (required)
 *
 * Note: disposition_note is required at click time per Decision #11 — the
 * methodology demands a rationale at the moment of disposition, not as a
 * pencil-edit later.
 */
export const POST: APIRoute = async ({ request, locals, redirect, params }) => {
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
    const engagement = await getEngagement(env.DB, session.orgId, engagementId)
    if (!engagement) {
      return redirect('/admin/entities?error=not_found', 302)
    }

    const formData = await request.formData()
    const method = formData.get('_method')
    const action = formData.get('action')

    const detailUrl = `/admin/engagements/${engagementId}`

    // Handle DELETE
    if (method === 'DELETE') {
      const itemId = formData.get('item_id')
      if (!itemId || typeof itemId !== 'string') {
        return redirect(`${detailUrl}?error=missing`, 302)
      }

      const item = await getParkingLotItem(env.DB, session.orgId, itemId.trim())
      if (!item || item.engagement_id !== engagementId) {
        return redirect(`${detailUrl}?error=not_found`, 302)
      }

      const result = await deleteParkingLotItem(env.DB, session.orgId, itemId.trim())
      if (result === 'dispositioned') {
        return redirect(`${detailUrl}?error=cannot_delete_dispositioned`, 302)
      }
      if (result !== 'ok') {
        return redirect(`${detailUrl}?error=not_found`, 302)
      }

      // Audit trail: capture the original description so the timeline shows
      // what was logged, not just that something was deleted.
      await appendContext(env.DB, session.orgId, {
        entity_id: engagement.entity_id,
        type: 'parking_lot',
        content: `Deleted parking lot item: ${item.description}`,
        source: 'admin',
        source_ref: `parking_lot:${item.id}:deleted`,
        metadata: { item_id: item.id },
        engagement_id: engagementId,
      })

      return redirect(`${detailUrl}?parking_lot_deleted=1`, 302)
    }

    // Handle disposition
    if (action === 'disposition') {
      const itemId = formData.get('item_id')
      const disposition = formData.get('disposition')
      const note = formData.get('disposition_note')

      if (!itemId || typeof itemId !== 'string') {
        return redirect(`${detailUrl}?error=missing`, 302)
      }

      if (
        !disposition ||
        typeof disposition !== 'string' ||
        !DISPOSITIONS.includes(disposition as Disposition)
      ) {
        return redirect(`${detailUrl}?error=invalid_disposition`, 302)
      }

      if (!note || typeof note !== 'string' || !note.trim()) {
        return redirect(`${detailUrl}?error=missing_note`, 302)
      }

      const item = await getParkingLotItem(env.DB, session.orgId, itemId.trim())
      if (!item || item.engagement_id !== engagementId) {
        return redirect(`${detailUrl}?error=not_found`, 302)
      }

      const updated = await dispositionParkingLotItem(
        env.DB,
        session.orgId,
        itemId.trim(),
        disposition as Disposition,
        note.trim()
      )

      if (!updated) {
        return redirect(`${detailUrl}?error=not_found`, 302)
      }

      await appendContext(env.DB, session.orgId, {
        entity_id: engagement.entity_id,
        type: 'parking_lot',
        content: `Dispositioned as ${disposition}: ${note.trim()}`,
        source: 'admin',
        source_ref: `parking_lot:${updated.id}:dispositioned`,
        metadata: { disposition, item_id: updated.id },
        engagement_id: engagementId,
      })

      return redirect(`${detailUrl}?parking_lot_dispositioned=1`, 302)
    }

    // Handle create (default)
    const description = formData.get('description')
    if (!description || typeof description !== 'string' || !description.trim()) {
      return redirect(`${detailUrl}?error=missing`, 302)
    }

    const requestedBy = formData.get('requested_by')

    const item = await createParkingLotItem(env.DB, session.orgId, engagementId, {
      description: description.trim(),
      requested_by:
        requestedBy && typeof requestedBy === 'string' && requestedBy.trim()
          ? requestedBy.trim()
          : null,
    })

    await appendContext(env.DB, session.orgId, {
      entity_id: engagement.entity_id,
      type: 'parking_lot',
      content: item.description,
      source: 'admin',
      source_ref: `parking_lot:${item.id}:created`,
      metadata: { requested_by: item.requested_by, item_id: item.id },
      engagement_id: engagementId,
    })

    return redirect(`${detailUrl}?parking_lot_added=1`, 302)
  } catch (err) {
    console.error('[api/admin/engagements/[id]/parking-lot] Error:', err)
    return redirect('/admin/entities?error=server', 302)
  }
}
