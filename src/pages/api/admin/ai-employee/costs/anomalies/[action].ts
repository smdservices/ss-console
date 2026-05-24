/**
 * POST /api/admin/ai-employee/costs/anomalies/snooze
 * POST /api/admin/ai-employee/costs/anomalies/acknowledge
 *
 * Captain snooze/ack actions for cost anomaly alerts (#886). Both
 * accept the same JSON body identifying which alert to mutate:
 *
 *   { entity_id: string, alert_date: 'YYYY-MM-DD', driver: string }
 *
 * Snooze additionally accepts `snoozed_until` ('YYYY-MM-DDTHH:mm:ssZ').
 * A null `snoozed_until` clears an active snooze.
 *
 * Admin-only (enforced both by middleware on `/api/admin/*` and by an
 * explicit role check here for defense in depth).
 */

import type { APIContext, APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { acknowledgeAlert, snoozeAlert } from '../../../../../../lib/admin/cost-anomaly'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

interface AlertIdentity {
  entity_id: string
  alert_date: string
  driver: string
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function parseIdentity(body: unknown): AlertIdentity | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'body must be a JSON object' }
  }
  const obj = body as Record<string, unknown>
  const entity_id = obj.entity_id
  const alert_date = obj.alert_date
  const driver = obj.driver
  if (typeof entity_id !== 'string' || entity_id.length === 0) {
    return { error: 'entity_id is required and must be a non-empty string' }
  }
  if (typeof alert_date !== 'string' || !DATE_RE.test(alert_date)) {
    return { error: 'alert_date is required and must be YYYY-MM-DD' }
  }
  if (typeof driver !== 'string') {
    return { error: 'driver is required (empty string is the aggregate sentinel)' }
  }
  return { entity_id, alert_date, driver }
}

async function handlePost(ctx: APIContext): Promise<Response> {
  const session = ctx.locals.session
  if (!session || session.role !== 'admin') {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const action = ctx.params.action
  if (action !== 'snooze' && action !== 'acknowledge') {
    return jsonResponse({ error: `unknown action: ${action}` }, 404)
  }

  let body: unknown
  try {
    body = await ctx.request.json()
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, 400)
  }

  const parsed = parseIdentity(body)
  if ('error' in parsed) {
    return jsonResponse({ error: parsed.error }, 400)
  }

  if (action === 'snooze') {
    const snoozed_until = (body as Record<string, unknown>).snoozed_until
    let snoozedIso: string | null
    if (snoozed_until === null || snoozed_until === undefined) {
      snoozedIso = null
    } else if (typeof snoozed_until === 'string' && ISO_RE.test(snoozed_until)) {
      snoozedIso = snoozed_until
    } else {
      return jsonResponse(
        { error: 'snoozed_until must be ISO 8601 UTC (e.g. 2026-05-30T00:00:00Z) or null' },
        400
      )
    }
    await snoozeAlert(env.DB, parsed, snoozedIso)
    return jsonResponse({ ok: true, action: 'snooze', snoozed_until: snoozedIso }, 200)
  }

  await acknowledgeAlert(env.DB, parsed, session.userId)
  return jsonResponse({ ok: true, action: 'acknowledge' }, 200)
}

export const POST: APIRoute = (ctx) => handlePost(ctx)
