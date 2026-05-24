import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resolveAiEmployeeAccess } from '../../../../../lib/portal/ai-employee-access'
import {
  listAuditEntriesUnpaginated,
  parseAuditListParams,
  defaultAuditDateRange,
} from '../../../../../lib/portal/ai-employee/audit'
import { renderAuditJson, exportFilename } from '../../../../../lib/portal/ai-employee/audit-export'
import { getCustomerConfig } from '../../../../../lib/portal/customer-config'

/**
 * GET /api/portal/ai-employee/audit/export.json
 *
 * Stream the audit log query result as a JSON file. Same params as the
 * audit page; behaves identically to export.csv but renders an
 * `AuditEntry[]` payload with a `.json` filename.
 *
 * Mirrors the CSV endpoint's contract:
 *   - Authorization: principal or compliance only.
 *   - Output is the FULL filtered+sorted result set (no pagination).
 *   - Empty result is a well-formed `[]\n`, never a fabricated row.
 *
 * Kept as a separate route file rather than a content-negotiated single
 * endpoint because the CSV download link and the JSON download link
 * are surfaced as two distinct buttons in the filter bar; one URL per
 * format is the simpler contract.
 */
export const GET: APIRoute = async ({ request, locals }) => {
  const access = await resolveAiEmployeeAccess(env.DB, locals, {
    allowedRoles: ['principal', 'compliance'],
  })
  if (access.kind === 'redirect') {
    return new Response(null, { status: 302, headers: { Location: access.to } })
  }
  const { subscription, client } = access

  const url = new URL(request.url)
  const params = parseAuditListParams(url.searchParams)

  const resolvedParams =
    params.from === null && params.to === null ? { ...params, ...defaultAuditDateRange() } : params

  const rows = await listAuditEntriesUnpaginated(subscription, resolvedParams)
  const body = renderAuditJson(rows)

  const config = await getCustomerConfig(env.DB, client.id)
  const slug = config?.customer_slug ?? 'customer'
  const filename = exportFilename(slug, 'json')

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
