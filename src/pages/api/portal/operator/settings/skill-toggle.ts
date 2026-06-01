import type { APIRoute } from 'astro'
import { resolveOperatorAccess } from '../../../../../lib/portal/operator-access'
import { getCustomerConfig, getActivePersona } from '../../../../../lib/portal/customer-config'
import {
  applySkillToggle,
  isCeiling,
  type Ceiling,
} from '../../../../../lib/portal/operator/config-governance'
import { env } from 'cloudflare:workers'

/**
 * POST /api/portal/operator/settings/skill-toggle
 *
 * Enables or disables a single skill on the active persona (ADR 0026 / 0030 §4).
 *
 * Form fields:
 *   skillName     — slug of the skill being toggled
 *   personaSlug   — slug of the persona owning the skill (optional)
 *   nextEnabled   — 'true' or 'false' (the target state)
 *
 * Auth: principal only. Disabling maps to `refused` (a lower / more
 * restrictive change, always allowed); enabling maps to `draft_for_review`
 * (the safe default). Records the governance action to the immutable
 * `config_change_audit` ledger; does not mutate the live config replica
 * (ADR 0012 §2 — value applies on the next git sync). Status banner:
 *   ?status=saved      — recorded
 *   ?status=invalid_*  — malformed request
 */

const SETTINGS_PAGE_URL = '/portal/products/operator/settings'

function redirectWithStatus(status: string): Response {
  const target = `${SETTINGS_PAGE_URL}?status=${encodeURIComponent(status)}`
  return new Response(null, { status: 303, headers: { Location: target } })
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function currentSkillCeiling(
  persona: { skills: { name: string; trust_ceiling: string }[] } | null,
  skillName: string
): Ceiling {
  const skill = persona?.skills.find((s) => s.name === skillName)
  return skill && isCeiling(skill.trust_ceiling) ? skill.trust_ceiling : 'draft_for_review'
}

export const POST: APIRoute = async ({ locals, request }) => {
  const access = await resolveOperatorAccess(env.DB, locals, { allowedRoles: ['principal'] })
  if (access.kind === 'redirect') {
    return jsonError(403, 'Forbidden')
  }

  const formData = await request.formData()
  const skillName = formData.get('skillName')
  const nextEnabled = formData.get('nextEnabled')
  const personaSlug = formData.get('personaSlug')

  if (typeof skillName !== 'string' || skillName === '') {
    return redirectWithStatus('invalid_skill')
  }
  if (nextEnabled !== 'true' && nextEnabled !== 'false') {
    return redirectWithStatus('invalid_state')
  }

  const config = await getCustomerConfig(env.DB, access.client.id)
  const persona = await getActivePersona(env.DB, access.client.id)
  const oldValue = currentSkillCeiling(persona, skillName)

  await applySkillToggle(env.DB, {
    customer_slug: config?.customer_slug ?? access.client.id,
    entity_id: access.client.id,
    actor: { user_id: access.user.id, email: access.user.email, role: 'principal' },
    persona_slug: typeof personaSlug === 'string' && personaSlug !== '' ? personaSlug : null,
    skill_name: skillName,
    next_enabled: nextEnabled === 'true',
    old_value: oldValue,
  })

  return redirectWithStatus('saved')
}
