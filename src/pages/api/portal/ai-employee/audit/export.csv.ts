import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resolveAiEmployeeAccess } from '../../../../../lib/portal/ai-employee-access'
import {
  listAuditEntriesUnpaginated,
  parseAuditListParams,
  defaultAuditDateRange,
} from '../../../../../lib/portal/ai-employee/audit'
import { renderAuditCsv, exportFilename } from '../../../../../lib/portal/ai-employee/audit-export'
import { getCustomerConfig } from '../../../../../lib/portal/customer-config'

/**
 * GET /api/portal/ai-employee/audit/export.csv
 *
 * Stream the audit log query result as a CSV file. Same params as the
 * audit page (`/portal/products/ai-employee/audit?...`) — the page's
 * "Export CSV" link re-uses the current URL's query string so the
 * export reflects exactly what the reviewer is looking at.
 *
 * Authorization:
 *   - Clerk session required (middleware enforces)
 *   - Active AI Employee subscription on the entity
 *   - Caller holds principal OR compliance role (operators do NOT get
 *     audit exports; their workflow surface is the drafts queue, and
 *     the org-wide audit log is sensitive)
 *
 * Per AC of #896: the export contract is the FULL filtered+sorted
 * result set, not the visible page. Reviewers exporting for ethics
 * counsel must not silently truncate. We deliberately omit pagination
 * here — the unpaginated resolver is the export source of truth.
 *
 * Per the empty-state pattern (docs/style/empty-state-pattern.md), an
 * empty result still returns a well-formed CSV with the header row;
 * downstream tooling parses it deterministically. We never fabricate
 * placeholder rows.
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

  // Apply the same default-window logic as the page so the export and
  // the on-screen result match when no explicit range is set.
  const resolvedParams =
    params.from === null && params.to === null ? { ...params, ...defaultAuditDateRange() } : params

  const rows = await listAuditEntriesUnpaginated(subscription, resolvedParams)
  const body = renderAuditCsv(rows)

  const config = await getCustomerConfig(env.DB, client.id)
  const slug = config?.customer_slug ?? 'customer'
  const filename = exportFilename(slug, 'csv')

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
