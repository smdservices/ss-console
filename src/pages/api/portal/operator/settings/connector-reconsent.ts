import type { APIRoute } from 'astro'
import { resolveOperatorAccess } from '../../../../../lib/portal/operator-access'
import { env } from 'cloudflare:workers'
import { errorResponse } from '../../../../../lib/api/helpers'

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

const OPERATOR_LANDING = '/portal/products/operator'

// The settings page is now instance-addressed. Redirect back to the addressed
// instance's settings; fall back to the bare chooser when the instance can't be
// determined from the form.
function settingsUrl(instance: string | null): string {
  return instance ? `${OPERATOR_LANDING}/${instance}/settings` : OPERATOR_LANDING
}

function redirectWithStatus(instance: string | null, status: string): Response {
  const base = settingsUrl(instance)
  const sep = base.includes('?') ? '&' : '?'
  return new Response(null, {
    status: 303,
    headers: { Location: `${base}${sep}status=${encodeURIComponent(status)}` },
  })
}

function jsonError(status: number, message: string): Response {
  return errorResponse(status, message)
}

export const POST: APIRoute = async ({ locals, request }) => {
  const formData = await request.formData()
  const instanceRaw = formData.get('instance')
  const instance = typeof instanceRaw === 'string' && instanceRaw !== '' ? instanceRaw : null

  const access = await resolveOperatorAccess(env.DB, locals, {
    allowedRoles: ['principal'],
    customerSlug: instance ?? '',
  })
  if (access.kind === 'redirect') {
    return jsonError(403, 'Forbidden')
  }

  const capabilityName = formData.get('capabilityName')
  if (typeof capabilityName !== 'string' || capabilityName === '') {
    return redirectWithStatus(instance, 'invalid_capability')
  }

  console.info('settings.connector_reconsent.intent', {
    entity_id: access.client.id,
    user_id: access.user.id,
    capability: capabilityName,
  })

  return redirectWithStatus(instance, 'reconsent_started')
}
