import type { APIRoute } from 'astro'
import { resolveAiEmployeeAccess } from '../../../../../lib/portal/ai-employee-access'
import { env } from 'cloudflare:workers'

/**
 * POST /api/portal/ai-employee/settings/skill-toggle
 *
 * Enables or disables a single skill on the active persona.
 *
 * Form fields:
 *   skillName     — slug of the skill being toggled
 *   personaSlug   — slug of the persona owning the skill (optional)
 *   nextEnabled   — 'true' or 'false' (the target state). Sent by
 *                   the form, not derived server-side, so a slow
 *                   reviewer cannot double-click and flip past
 *                   their intent.
 *
 * Auth: principal on the active AI Employee subscription.
 *
 * Today this endpoint logs intent. The write back to
 * customer.yaml's `personas[].skills[].trust_ceiling` (where
 * disabling maps to `refused` and enabling maps back to
 * `draft_for_review`) lands once the configs-repo write path
 * ships. The page renders an info banner via the `?status=ack`
 * query param so a principal does not assume their click has
 * propagated.
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
  const nextEnabled = formData.get('nextEnabled')
  if (typeof skillName !== 'string' || skillName === '') {
    return redirectWithStatus('invalid_skill')
  }
  if (nextEnabled !== 'true' && nextEnabled !== 'false') {
    return redirectWithStatus('invalid_state')
  }

  console.info('settings.skill_toggle.intent', {
    entity_id: access.client.id,
    user_id: access.user.id,
    skill: skillName,
    next_enabled: nextEnabled === 'true',
  })

  return redirectWithStatus('ack')
}
