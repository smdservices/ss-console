import { jsonResponse } from '../../../../lib/api/helpers'
import type { APIContext, APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import {
  bulkDismissEntities,
  listEntitiesForExport,
  type BulkActionResult,
} from '../../../../lib/db/entities-bulk'
import { isLostReasonCode } from '../../../../lib/db/lost-reasons'

/**
 * POST /api/admin/entities/bulk
 *
 * Body (JSON):
 *   {
 *     ids: string[],
 *     action: 'dismiss' | 'export',
 *     reason?: LostReasonCode,          // required when action='dismiss'
 *     reasonDetail?: string | null      // optional when action='dismiss'
 *   }
 *
 * Responses:
 *   - action='dismiss': JSON `{ ok: [{id}], failed: [{id, reason}] }`
 *     (partial-success — batch continues past per-entity failures)
 *   - action='export' : CSV download (`Content-Disposition: attachment`)
 *
 * "Send outreach" is intentionally not a server-side action at this stage.
 * The client-side UI composes a mailto: link from the export CSV locally —
 * no persistent outreach record is created until the per-entity outreach
 * action ships in a follow-on issue.
 *
 * Admin-only. Org-scoped. Validates every id belongs to the session org.
 */
async function handlePost({ request, locals }: APIContext): Promise<Response> {
  const session = locals.session
  if (!session || session.role !== 'admin') {
    return jsonResponse(401, { error: 'Unauthorized' })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' })
  }

  if (!body || typeof body !== 'object') {
    return jsonResponse(400, { error: 'Invalid body' })
  }

  const { ids, action, reason, reasonDetail } = body as {
    ids?: unknown
    action?: unknown
    reason?: unknown
    reasonDetail?: unknown
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return jsonResponse(400, { error: 'ids must be a non-empty array' })
  }
  if (!ids.every((id) => typeof id === 'string' && id.length > 0)) {
    return jsonResponse(400, { error: 'ids must be strings' })
  }
  // Cap batch size to keep the request bounded. Picked to match a full
  // screen of signals without requiring pagination scroll gymnastics.
  if (ids.length > 200) {
    return jsonResponse(400, { error: 'batch size capped at 200 ids' })
  }

  const stringIds = ids as string[]

  try {
    if (action === 'dismiss') {
      return handleDismiss(session.orgId, stringIds, reason, reasonDetail)
    }

    if (action === 'export') {
      return handleExport(session.orgId, stringIds)
    }

    return jsonResponse(400, { error: `Unknown action: ${String(action)}` })
  } catch (err) {
    console.error('[api/admin/entities/bulk] Error:', err)
    const message = err instanceof Error ? err.message : 'server error'
    return jsonResponse(500, { error: message })
  }
}

async function handleDismiss(
  orgId: string,
  ids: string[],
  reason: unknown,
  reasonDetail: unknown
): Promise<Response> {
  if (!isLostReasonCode(reason)) {
    return jsonResponse(400, {
      error:
        'reason must be one of the canonical lost-reason values (see src/lib/db/lost-reasons.ts)',
    })
  }
  const detail =
    typeof reasonDetail === 'string' && reasonDetail.trim() ? reasonDetail.trim() : null

  const result: BulkActionResult = await bulkDismissEntities(env.DB, orgId, ids, {
    reason,
    detail,
  })
  return jsonResponse(result.failed.length === 0 ? 200 : 207, result)
}

async function handleExport(orgId: string, ids: string[]): Promise<Response> {
  const rows = await listEntitiesForExport(env.DB, orgId, ids)
  const csv = buildCsv(rows)
  const filename = `entities-export-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

export const POST: APIRoute = (ctx) => handlePost(ctx)

function csvEscape(value: string | null | undefined): string {
  if (value == null) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function buildCsv(
  rows: Array<{
    id: string
    name: string
    email: string | null
    contact_name: string | null
    website: string | null
    phone: string | null
    stage: string
  }>
): string {
  const header = ['id', 'name', 'contact_name', 'email', 'phone', 'website', 'stage'].join(',')
  const lines = rows.map((r) =>
    [r.id, r.name, r.contact_name, r.email, r.phone, r.website, r.stage].map(csvEscape).join(',')
  )
  return [header, ...lines].join('\n') + '\n'
}
