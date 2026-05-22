import type { APIRoute } from 'astro'
import { resolveAiEmployeeAccess } from '../../../../../lib/portal/ai-employee-access'
import { isTrustCeilingLevel } from '../../../../../lib/portal/ai-employee/settings'
import { env } from 'cloudflare:workers'

/**
 * POST /api/portal/ai-employee/settings/trust-ceiling
 *
 * Updates a single skill's trust ceiling on the active persona.
 *
 * Form fields:
 *   skillName     — slug of the skill being edited
 *   personaSlug   — slug of the persona owning the skill (optional;
 *                   single-persona customers omit it)
 *   level         — one of TRUST_CEILING_LEVELS
 *                   (`autonomous` / `draft_for_review` / `refused`)
 *
 * Auth: principal on the active AI Employee subscription. Operators
 * and compliance are forbidden — trust ceiling is a principal-only
 * configuration surface per ADR 0011.
 *
 * Today this endpoint logs the intent and returns. The write back
 * to customer.yaml (and therefore the projection in
 * `customer_configs`) lands once the configs-repo write path
 * ships. Until then the dropdown contract is locked but the value
 * is not yet persisted. The page renders an info banner via the
 * `?status=ack` query param so a principal does not assume their
 * click has propagated.
 */

const SETTINGS_PAGE_URL = '/portal/products/ai-employee/settings'

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
  const access = await resolveAiEmployeeAccess(env.DB, locals, {
    allowedRoles: ['principal'],
  })
  if (access.kind === 'redirect') {
    return jsonError(403, 'Forbidden')
  }

  const formData = await request.formData()
  const skillName = formData.get('skillName')
  const level = formData.get('level')
  if (typeof skillName !== 'string' || skillName === '') {
    return redirectWithStatus('invalid_skill')
  }
  if (typeof level !== 'string' || !isTrustCeilingLevel(level)) {
    return redirectWithStatus('invalid_level')
  }

  // Intent log only. Real write lands when the configs-repo write
  // path ships; see src/lib/portal/customer-config.ts header.
  console.info('settings.trust_ceiling.intent', {
    entity_id: access.client.id,
    user_id: access.user.id,
    skill: skillName,
    level,
  })

  return redirectWithStatus('ack')
}
