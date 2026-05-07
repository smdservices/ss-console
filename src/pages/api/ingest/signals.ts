import type { APIContext, APIRoute } from 'astro'
import { validateApiKey } from '../../../lib/auth/api-key'
import { findOrCreateEntity } from '../../../lib/db/entities'
import { appendContext } from '../../../lib/db/context'
import { dispatchEnrichmentWorkflow } from '../../../lib/enrichment/dispatch'
import { ORG_ID } from '../../../lib/constants'
import { env } from 'cloudflare:workers'

/**
 * POST /api/ingest/signals
 *
 * Ingest endpoint for lead generation pipelines.
 * Finds or creates an entity by slug, then appends a context entry.
 *
 * Auth: Bearer token (LEAD_INGEST_API_KEY), not session cookies.
 *
 * Dedup: Entity dedup via UNIQUE(org_id, slug). Same business from
 * multiple pipelines = one entity with multiple signal context entries.
 */
const MAX_BODY_SIZE = 10 * 1024 // 10KB

const ALLOWED_PIPELINES = ['review_mining', 'job_monitor', 'new_business', 'social_listening']

interface ValidatedSignal {
  businessName: string
  sourcePipeline: string
  dateFound: string
  content: string
  metadata: Record<string, unknown>
  area: string | null
  phone: string | null
  website: string | null
}

function buildSignalMetadata(
  body: Record<string, unknown>,
  outreachAngle: string | null,
  dateFound: string
): Record<string, unknown> {
  const painScore =
    typeof body.pain_score === 'number' && body.pain_score >= 1 && body.pain_score <= 10
      ? body.pain_score
      : null
  const topProblems = Array.isArray(body.top_problems)
    ? body.top_problems.filter((p): p is string => typeof p === 'string')
    : null
  const sourceMetadata =
    body.source_metadata && typeof body.source_metadata === 'object'
      ? (body.source_metadata as Record<string, unknown>)
      : {}
  return {
    ...sourceMetadata,
    ...(painScore != null && { pain_score: painScore }),
    ...(topProblems && { top_problems: topProblems }),
    ...(outreachAngle && { outreach_angle: outreachAngle }),
    date_found: dateFound,
  }
}

function validateAndBuildSignal(body: Record<string, unknown>): ValidatedSignal | Response {
  const errors: string[] = []
  const businessName = typeof body.business_name === 'string' ? body.business_name.trim() : ''
  if (!businessName) errors.push('business_name is required')

  const sourcePipeline = typeof body.source_pipeline === 'string' ? body.source_pipeline : ''
  if (!sourcePipeline) errors.push('source_pipeline is required')
  else if (!ALLOWED_PIPELINES.includes(sourcePipeline))
    errors.push(`source_pipeline must be one of: ${ALLOWED_PIPELINES.join(', ')}`)

  const dateFound = typeof body.date_found === 'string' ? body.date_found : ''
  if (!dateFound) errors.push('date_found is required')

  if (errors.length > 0) return jsonResponse(400, { error: 'Validation failed', details: errors })

  const evidenceSummary = stringOrNull(body.evidence_summary)
  const outreachAngle = stringOrNull(body.outreach_angle)
  const contentParts: string[] = []
  if (evidenceSummary) contentParts.push(evidenceSummary)
  if (outreachAngle) contentParts.push(`**Outreach angle:** ${outreachAngle}`)
  const content = contentParts.join('\n\n') || `Signal from ${sourcePipeline} on ${dateFound}.`

  return {
    businessName,
    sourcePipeline,
    dateFound,
    content,
    metadata: buildSignalMetadata(body, outreachAngle, dateFound),
    area: stringOrNull(body.area),
    phone: stringOrNull(body.phone),
    website: stringOrNull(body.website),
  }
}

async function handlePost({ request, locals }: APIContext): Promise<Response> {
  const contentLength = request.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
    return jsonResponse(413, { error: 'Payload too large' })
  }

  if (!validateApiKey(request, env.LEAD_INGEST_API_KEY)) {
    return jsonResponse(401, { error: 'Unauthorized' })
  }

  let body: Record<string, unknown>
  try {
    const text = await request.text()
    if (text.length > MAX_BODY_SIZE) return jsonResponse(413, { error: 'Payload too large' })
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' })
  }

  const validated = validateAndBuildSignal(body)
  if (validated instanceof Response) return validated

  try {
    const result = await findOrCreateEntity(env.DB, ORG_ID, {
      name: validated.businessName,
      area: validated.area,
      phone: validated.phone,
      website: validated.website,
      source_pipeline: validated.sourcePipeline,
    })

    const contextEntry = await appendContext(env.DB, ORG_ID, {
      entity_id: result.entity.id,
      type: 'signal',
      content: validated.content,
      source: validated.sourcePipeline,
      metadata: validated.metadata,
    })

    // At-ingest enrichment for new entities via EnrichmentWorkflow (#631).
    if (result.status === 'created') {
      const dispatchPromise = dispatchEnrichmentWorkflow(env, {
        entityId: result.entity.id,
        orgId: ORG_ID,
        mode: 'full',
        triggered_by: 'ingest:signals',
      }).catch((err: unknown) => {
        console.error('[api/ingest/signals] enrichment dispatch failed', { error: err })
      })
      if (locals.cfContext?.waitUntil) locals.cfContext.waitUntil(dispatchPromise)
    }

    return jsonResponse(result.status === 'created' ? 201 : 200, {
      status: result.status === 'created' ? 'created' : 'appended',
      entity_id: result.entity.id,
      context_id: contextEntry.id,
      entity_name: result.entity.name,
      is_new_entity: result.status === 'created',
    })
  } catch (err) {
    console.error('[api/ingest/signals] Error:', err)
    return jsonResponse(500, { error: 'Internal server error' })
  }
}

export const POST: APIRoute = (ctx) => handlePost(ctx)

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
