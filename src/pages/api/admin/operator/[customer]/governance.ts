/**
 * POST /api/admin/operator/[customer]/governance
 *
 * SMD sets a skill's ceiling on the action-class model (design §5.3, ADR 0025 /
 * ADR 0035). Form fields:
 *
 *   persona_slug — the persona owning the skill
 *   skill_name   — the skill
 *   action_class — optional; present for a per-action-class ceiling (e.g.
 *                  'external_send'). Absent = the skill scalar (governs
 *                  internal_write).
 *   level        — 'autonomous' | 'draft_for_review' | 'refused'
 *
 * Routes through the frozen applyCeilingChange: floor-checked against the
 * vertical floor (a raise above the floor is rejected) and recorded to the
 * immutable config_change_audit ledger with the SMD actor. It does NOT mutate
 * the live customer_configs replica (ADR 0012); the value reaches the runtime
 * via deferred git write-back. Status banner:
 *   ?status=saved          — recorded; applies on next sync
 *   ?status=floor_blocked  — rejected by the vertical floor
 *   ?status=invalid_*      — malformed
 *   ?status=not_found      — no operator / skill
 *
 * Admin-only (middleware on /api/admin/* + explicit re-check).
 */

import type { APIContext, APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resolveEntityIdBySlug } from '../../../../../lib/admin/operator-overview'
import { readGovernanceConfig, resolveCell } from '../../../../../lib/admin/governance'
import {
  applyCeilingChange,
  isCeiling,
  type Ceiling,
} from '../../../../../lib/portal/operator/config-governance'
import {
  ACCEPTED_ACTION_CLASSES,
  type ActionClass,
} from '../../../../../lib/operator/customer-yaml/types'

function redirectWithStatus(slug: string, status: string): Response {
  const target = `/admin/operator/${encodeURIComponent(slug)}/governance?status=${encodeURIComponent(status)}`
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

interface ParsedForm {
  personaSlug: string | null
  skillName: string
  actionClass: ActionClass | null
  level: Ceiling
}

/** Parse + validate the form without casting. Returns a status string on error. */
function parseForm(form: FormData): { error: string } | { parsed: ParsedForm } {
  const skillName = optionalString(form.get('skill_name'))
  const level = form.get('level')
  if (!skillName || typeof level !== 'string' || !isCeiling(level)) {
    return { error: 'invalid_level' }
  }
  const rawActionClass = optionalString(form.get('action_class'))
  let actionClass: ActionClass | null = null
  if (rawActionClass !== null) {
    // A present-but-unrecognized action_class is malformed, not a silent scalar.
    if (!(ACCEPTED_ACTION_CLASSES as readonly string[]).includes(rawActionClass)) {
      return { error: 'invalid_action_class' }
    }
    actionClass = rawActionClass as ActionClass
  }
  return {
    parsed: {
      personaSlug: optionalString(form.get('persona_slug')),
      skillName,
      actionClass,
      level,
    },
  }
}

async function handlePost(ctx: APIContext): Promise<Response> {
  const session = ctx.locals.session
  if (!session || session.role !== 'admin') return jsonError(401, 'Unauthorized')

  const slug = ctx.params.customer ?? ''
  const entityId = await resolveEntityIdBySlug(env.DB, slug)
  if (!entityId) return redirectWithStatus(slug, 'not_found')

  const result = parseForm(await ctx.request.formData())
  if ('error' in result) return redirectWithStatus(slug, result.error)
  const { personaSlug, skillName, actionClass, level } = result.parsed

  const config = await readGovernanceConfig(env.DB, slug)
  if (!config.ok) {
    return redirectWithStatus(slug, config.error === 'not_found' ? 'not_found' : 'malformed')
  }

  const persona = config.personas.find((p) => p.slug === personaSlug) ?? config.personas[0]
  const skill = persona?.skills.find((s) => s.name === skillName)
  if (!skill) return redirectWithStatus(slug, 'not_found')

  // The old value is the currently-authored ceiling for this cell. An unauthored
  // class resolves to 'refused' (fail-closed) — authoring it is an honest raise.
  const cell = resolveCell(skill, actionClass ?? 'internal_write', config.vertical)
  const applied = await applyCeilingChange(env.DB, {
    customer_slug: slug,
    entity_id: entityId,
    actor: { user_id: session.userId, email: session.email, role: session.role },
    persona_slug: personaSlug,
    skill_name: skillName,
    action_class: actionClass,
    vertical: config.vertical,
    old_value: cell.authored ?? 'refused',
    new_value: level,
  })

  return redirectWithStatus(slug, applied.outcome === 'accepted' ? 'saved' : 'floor_blocked')
}

export const POST: APIRoute = (ctx) => handlePost(ctx)
