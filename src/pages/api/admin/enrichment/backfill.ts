import type { APIContext, APIRoute } from 'astro'
import { dispatchEnrichmentWorkflow } from '../../../../lib/enrichment/dispatch'
import { env } from 'cloudflare:workers'

/**
 * POST /api/admin/enrichment/backfill (#631)
 *
 * One-time (and re-runnable) operation to dispatch enrichment Workflows
 * for entities that lack a successful `intelligence_brief` row.
 *
 * Body shape:
 *   { limit?: number; dry_run?: boolean }
 */

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500
const THROTTLE_MS = 200 // ~5 dispatches/second
const PER_DOSSIER_COST_USD = 0.18

interface BackfillBody {
  limit?: unknown
  dry_run?: unknown
}

interface BackfillResponse {
  enqueued: number
  total_remaining: number
  dry_run: boolean
  estimated_cost_usd?: number
  errors?: string[]
}

async function fetchUnenrichedCount(): Promise<number> {
  const countRow = await env.DB.prepare(
    `SELECT COUNT(*) AS n
       FROM entities
      WHERE id NOT IN (
        SELECT DISTINCT entity_id FROM enrichment_runs
         WHERE module = 'intelligence_brief' AND status = 'succeeded'
      )`
  ).first<{ n: number }>()
  return countRow?.n ?? 0
}

async function dispatchSlice(
  orgId: string,
  limit: number
): Promise<{ enqueued: number; errors: string[] }> {
  const slice = await env.DB.prepare(
    `SELECT id, org_id FROM entities
      WHERE id NOT IN (
        SELECT DISTINCT entity_id FROM enrichment_runs
         WHERE module = 'intelligence_brief' AND status = 'succeeded'
      )
      LIMIT ?`
  )
    .bind(limit)
    .all<{ id: string; org_id: string }>()

  const rows = slice.results ?? []
  const errors: string[] = []
  let enqueued = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const result = await dispatchEnrichmentWorkflow(env, {
        entityId: row.id,
        orgId: row.org_id ?? orgId,
        mode: 'full',
        triggered_by: 'admin:backfill',
      })
      if (result.dispatched) enqueued++
    } catch (err) {
      errors.push(`${row.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (i < rows.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, THROTTLE_MS))
    }
  }
  return { enqueued, errors }
}

async function handlePost({ request, locals }: APIContext): Promise<Response> {
  const session = locals.session
  if (!session || session.role !== 'admin') {
    return jsonResponse(401, { error: 'Unauthorized' })
  }

  let body: BackfillBody
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const dryRun = body.dry_run === true
  const limitInput = typeof body.limit === 'number' ? body.limit : DEFAULT_LIMIT
  const limit = Math.min(Math.max(1, Math.floor(limitInput)), MAX_LIMIT)
  const totalUnenriched = await fetchUnenrichedCount()

  if (dryRun) {
    return jsonResponse(200, {
      enqueued: 0,
      total_remaining: totalUnenriched,
      dry_run: true,
      estimated_cost_usd: Number((totalUnenriched * PER_DOSSIER_COST_USD).toFixed(2)),
    } satisfies BackfillResponse)
  }

  const { enqueued, errors } = await dispatchSlice(session.orgId, limit)
  const response: BackfillResponse = {
    enqueued,
    total_remaining: Math.max(0, totalUnenriched - enqueued),
    dry_run: false,
  }
  if (errors.length > 0) response.errors = errors
  return jsonResponse(200, response)
}

export const POST: APIRoute = (ctx) => handlePost(ctx)

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
