import type { APIRoute } from 'astro'
import { resolveOperatorAccess } from '../../../../../lib/portal/operator-access'
import { getCustomerConfig, getActivePersona } from '../../../../../lib/portal/customer-config'
import {
  applyCeilingChange,
  isCeiling,
  type Ceiling,
} from '../../../../../lib/portal/operator/config-governance'
import {
  ACCEPTED_ACTION_CLASSES,
  type ActionClass,
} from '../../../../../lib/operator/customer-yaml/types'
import { env } from 'cloudflare:workers'

/**
 * POST /api/portal/operator/settings/trust-ceiling
 *
 * Changes a skill's trust ceiling on the active persona (ADR 0026 / ADR 0030 §4).
 *
 * Form fields:
 *   skillName     — slug of the skill being edited
 *   personaSlug   — slug of the persona owning the skill (optional)
 *   level         — one of 'autonomous' | 'draft_for_review' | 'refused'
 *   actionClass   — optional. When present (e.g. 'external_send'), this is an
 *                   exposure (action-class) change and is floor-checked against
 *                   the customer's vertical floor (ADR 0025). Absent = a skill
 *                   scalar change (governs internal_write; no floor applies).
 *
 * Auth: principal only (ADR 0011). The agent can never reach this surface.
 *
 * This endpoint records the governance ACTION + its floor decision to the
 * immutable `config_change_audit` ledger. It does NOT mutate the live config
 * replica (read-only on principle, ADR 0012 §2); the value reaches the runtime
 * via the deferred git write-back path (ADR 0025 step 7). Status banner:
 *   ?status=saved         — accepted (recorded; applies on next sync)
 *   ?status=floor_blocked — rejected by the vertical compliance floor
 *   ?status=invalid_*     — malformed request
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

function optionalString(raw: FormDataEntryValue | null): string | null {
  return typeof raw === 'string' && raw !== '' ? raw : null
}

function currentSkillCeiling(
  persona: { skills: { name: string; trust_ceiling: string }[] } | null,
  skillName: string
): Ceiling {
  const skill = persona?.skills.find((s) => s.name === skillName)
  return skill && isCeiling(skill.trust_ceiling) ? skill.trust_ceiling : 'draft_for_review'
}

interface ParsedRequest {
  skillName: string
  level: Ceiling
  personaSlug: string | null
  actionClass: ActionClass | null
}

/** Validate the form. Returns an error status string, or the parsed inputs. */
function parseRequest(formData: FormData): { error: string } | { parsed: ParsedRequest } {
  const skillName = formData.get('skillName')
  if (typeof skillName !== 'string' || skillName === '') return { error: 'invalid_skill' }

  const level = formData.get('level')
  if (typeof level !== 'string' || !isCeiling(level)) return { error: 'invalid_level' }

  // A present-but-unrecognized actionClass is malformed — fail rather than
  // silently treating it as a skill-scalar change.
  const rawActionClass = optionalString(formData.get('actionClass'))
  let actionClass: ActionClass | null = null
  if (rawActionClass !== null) {
    if (!(ACCEPTED_ACTION_CLASSES as readonly string[]).includes(rawActionClass)) {
      return { error: 'invalid_action_class' }
    }
    actionClass = rawActionClass as ActionClass
  }

  return {
    parsed: {
      skillName,
      level,
      personaSlug: optionalString(formData.get('personaSlug')),
      actionClass,
    },
  }
}

export const POST: APIRoute = async ({ locals, request }) => {
  const access = await resolveOperatorAccess(env.DB, locals, { allowedRoles: ['principal'] })
  if (access.kind === 'redirect') {
    return jsonError(403, 'Forbidden')
  }

  const result = parseRequest(await request.formData())
  if ('error' in result) return redirectWithStatus(result.error)
  const { skillName, level, personaSlug, actionClass } = result.parsed

  const config = await getCustomerConfig(env.DB, access.client.id)
  const persona = await getActivePersona(env.DB, access.client.id)

  const applied = await applyCeilingChange(env.DB, {
    customer_slug: config?.customer_slug ?? access.client.id,
    entity_id: access.client.id,
    actor: { user_id: access.user.id, email: access.user.email, role: 'principal' },
    persona_slug: personaSlug,
    skill_name: skillName,
    action_class: actionClass,
    vertical: config?.vertical ?? null,
    old_value: currentSkillCeiling(persona, skillName),
    new_value: level,
  })

  return redirectWithStatus(applied.outcome === 'accepted' ? 'saved' : 'floor_blocked')
}
