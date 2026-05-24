import type { APIRoute } from 'astro'
import { getPortalClient } from '../../../../../lib/portal/session'
import { getProductSubscription, listProductRoles } from '../../../../../lib/portal/product-access'
import {
  parseNotificationPrefsForm,
  replaceNotificationPrefs,
} from '../../../../../lib/portal/ai-employee/notification-prefs'
import {
  buildNotificationPrefsAuditEvent,
  recordRbacAuditEvent,
} from '../../../../../lib/portal/ai-employee/rbac-audit'
import type { PortalUserRow } from '../../../../../lib/auth/clerk-bridge'
import type { Entity } from '../../../../../lib/db/entities'
import { env } from 'cloudflare:workers'

/**
 * POST /api/portal/products/ai-employee/notification-prefs
 *
 * Replace the caller's notification preference set in one shot (per
 * #882).  Driven by an HTML form on the Settings → Notifications page;
 * the form sends one hidden checkbox per (event_type, scope) pair as
 * `pref:<event_type>:<scope>=1` when checked.
 *
 * Self-service only at v1.  A principal editing another user's
 * preferences is out of scope — added later if the multi-paralegal
 * workflows reveal a need.  The caller can only mutate their own
 * preferences.
 *
 * Authorization:
 *   - Clerk session required
 *   - Active AI Employee subscription on this entity
 *   - Caller has any role on (entity, 'ai-employee')
 *
 * Audit: every successful update emits a single `audit:rbac_event` log
 * line with subAction='notification_prefs_updated' carrying the
 * post-write preference snapshot.  We always emit on form submit, even
 * when the snapshot equals the prior — the act of touching the
 * preferences page is itself worth recording on a multi-paralegal firm
 * where "who silenced this notification" is the audit question.
 */

const PRODUCT_SLUG = 'ai-employee'
const PREFS_PAGE_URL = '/portal/products/ai-employee/settings/notifications'

function redirectWithStatus(status: string): Response {
  const target = `${PREFS_PAGE_URL}?status=${encodeURIComponent(status)}`
  return new Response(null, {
    status: 303,
    headers: { Location: target },
  })
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface AuthorizedContext {
  user: PortalUserRow
  client: Entity
  orgId: string
}

async function authorize(locals: App.Locals): Promise<Response | AuthorizedContext> {
  const portalData = await getPortalClient(env.DB, locals)
  if (!portalData) return jsonError(401, 'Unauthorized')
  if (!portalData.client) return jsonError(403, 'Forbidden')

  const { user, client } = portalData
  const roles = await listProductRoles(env.DB, user.id, client.id, PRODUCT_SLUG)
  if (roles.length === 0) return jsonError(403, 'Forbidden')

  const subscription = await getProductSubscription(env.DB, client.id, PRODUCT_SLUG)
  if (!subscription) return jsonError(404, 'No active subscription')

  return { user, client, orgId: user.org_id }
}

export const POST: APIRoute = async ({ request, locals }) => {
  const ctxOrResponse = await authorize(locals)
  if (ctxOrResponse instanceof Response) return ctxOrResponse
  const ctx = ctxOrResponse

  const formData = await request.formData()
  const prefs = parseNotificationPrefsForm(formData)

  const snapshot = await replaceNotificationPrefs(env.DB, {
    orgId: ctx.orgId,
    entityId: ctx.client.id,
    userId: ctx.user.id,
    prefs,
  })

  await recordRbacAuditEvent(
    buildNotificationPrefsAuditEvent({
      customer_id: ctx.client.id,
      product_slug: PRODUCT_SLUG,
      actorUserId: ctx.user.id,
      actorClerkUserId: ctx.user.clerk_user_id,
      actorEmail: ctx.user.email,
      targetUserId: ctx.user.id,
      targetEmail: ctx.user.email,
      prefsSnapshot: snapshot.map((p) => ({ event_type: p.eventType, scope: p.scope })),
    })
  )

  return redirectWithStatus('prefs_saved')
}
