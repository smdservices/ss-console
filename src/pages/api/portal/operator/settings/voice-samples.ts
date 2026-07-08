import type { APIRoute } from 'astro'
import { resolveOperatorAccess } from '../../../../../lib/portal/operator-access'
import { env } from 'cloudflare:workers'
import { errorResponse } from '../../../../../lib/api/helpers'

/**
 * POST /api/portal/operator/settings/voice-samples
 *
 * Add / remove a voice sample on the customer's voice library.
 *
 * Form fields (add):
 *   action       — 'add'
 *   sample       — uploaded file (multipart/form-data)
 *
 * Form fields (remove):
 *   action       — 'remove'
 *   sampleId     — id of the sample to delete
 *
 * Auth: principal on the active Operator subscription. Voice
 * samples can carry private content; only the principal role
 * touches them per ADR 0011 / dashboard-roles.md.
 *
 * Today this endpoint logs intent. The real propagation lives in
 * the voice pipeline (PR #951) and lands once the portal-bound
 * ingestion endpoint ships. The page renders the working contract
 * (Add / Remove buttons, status banner) so a principal sees the
 * shape of the surface even before the pipeline is wired.
 *
 * Privacy: this handler must never echo sample bytes to logs.
 * Only metadata (length, mime type) is logged.
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

  const action = formData.get('action')

  if (action === 'add') {
    const sample = formData.get('sample')
    if (!(sample instanceof File) || sample.size === 0) {
      return redirectWithStatus(instance, 'invalid_sample')
    }
    // Privacy: log size/type only. Never the body.
    console.info('settings.voice_sample.add_intent', {
      entity_id: access.client.id,
      user_id: access.user.id,
      size_bytes: sample.size,
      mime_type: sample.type,
    })
    return redirectWithStatus(instance, 'voice_added')
  }

  if (action === 'remove') {
    const sampleId = formData.get('sampleId')
    if (typeof sampleId !== 'string' || sampleId === '') {
      return redirectWithStatus(instance, 'invalid_sample')
    }
    console.info('settings.voice_sample.remove_intent', {
      entity_id: access.client.id,
      user_id: access.user.id,
      sample_id: sampleId,
    })
    return redirectWithStatus(instance, 'voice_removed')
  }

  return redirectWithStatus(instance, 'invalid_action')
}
