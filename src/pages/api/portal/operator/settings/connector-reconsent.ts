import type { APIRoute } from 'astro'
import { resolveOperatorAccess } from '../../../../../lib/portal/operator-access'
import { env } from 'cloudflare:workers'

/**
 * POST /api/portal/operator/settings/connector-reconsent
 *
 * Trigger the re-consent flow for a connector whose token has
 * expired or been revoked.
 *
 * Form fields:
 *   capabilityName  — closed-union CapabilityName from
 *                     customer.yaml (e.g. Email, Calendar,
 *                     PracticeManagement)
 *
 * Auth: principal on the active Operator subscription.
 *
 * Today this endpoint logs intent. The real OAuth bounce for each
 * connector lives behind its adapter (PR #949 Filevine, #822
 * Microsoft Graph). When those adapters expose a portal-bound
 * re-consent URL, replace the log with a 303 to that URL. The
 * page renders the affordance only when
 * `reconsentRequired: true`, so this endpoint is unreachable
 * until the harness flags the connector — adding a real bounce
 * later is one line.
 */

const SETTINGS_PAGE_URL = '/portal/products/operator/settings'

function redirectWithStatus(status: string): Response {
  const target = `${SETTINGS_PAGE_URL}?status=${encodeURIComponent(status)}`
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

export const POST: APIRoute = async ({ locals, request }) => {
  const access = await resolveOperatorAccess(env.DB, locals, {
    allowedRoles: ['principal'],
  })
  if (access.kind === 'redirect') {
    return jsonError(403, 'Forbidden')
  }

  const formData = await request.formData()
  const capabilityName = formData.get('capabilityName')
  if (typeof capabilityName !== 'string' || capabilityName === '') {
    return redirectWithStatus('invalid_capability')
  }

  console.info('settings.connector_reconsent.intent', {
    entity_id: access.client.id,
    user_id: access.user.id,
    capability: capabilityName,
  })

  return redirectWithStatus('reconsent_started')
}
