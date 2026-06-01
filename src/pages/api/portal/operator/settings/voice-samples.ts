import type { APIRoute } from 'astro'
import { resolveOperatorAccess } from '../../../../../lib/portal/operator-access'
import { env } from 'cloudflare:workers'

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
  const action = formData.get('action')

  if (action === 'add') {
    const sample = formData.get('sample')
    if (!(sample instanceof File) || sample.size === 0) {
      return redirectWithStatus('invalid_sample')
    }
    // Privacy: log size/type only. Never the body.
    console.info('settings.voice_sample.add_intent', {
      entity_id: access.client.id,
      user_id: access.user.id,
      size_bytes: sample.size,
      mime_type: sample.type,
    })
    return redirectWithStatus('voice_added')
  }

  if (action === 'remove') {
    const sampleId = formData.get('sampleId')
    if (typeof sampleId !== 'string' || sampleId === '') {
      return redirectWithStatus('invalid_sample')
    }
    console.info('settings.voice_sample.remove_intent', {
      entity_id: access.client.id,
      user_id: access.user.id,
      sample_id: sampleId,
    })
    return redirectWithStatus('voice_removed')
  }

  return redirectWithStatus('invalid_action')
}
