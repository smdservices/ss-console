/**
 * CSV export for the per-customer cost dashboard (#885).
 *
 * `GET /api/admin/operator/costs/export?customer_slug=...&start=YYYY-MM-DD&end=YYYY-MM-DD`
 *
 * Returns the raw `cost_telemetry` rows for one customer in the given
 * date window as a CSV download. Used for billing reconciliation —
 * Captain pulls the file into a spreadsheet to cross-check the ingest
 * against the Anthropic invoice.
 *
 * Admin-only (enforced both by middleware on `/api/admin/*` and by an
 * explicit role check here for defense in depth).
 *
 * Window defaults to the same 30-day window the dashboard uses. `start`
 * and `end` are validated as 'YYYY-MM-DD' strings; bad input returns
 * 400 rather than silently widening the query.
 */

import type { APIContext, APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import {
  defaultWindow,
  fetchCustomerCostRows,
  listCostCustomers,
  rowsToCsv,
} from '../../../../../lib/admin/cost-query'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function handleGet({ request, locals }: APIContext): Promise<Response> {
  const session = locals.session
  if (!session || session.role !== 'admin') {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const url = new URL(request.url)
  const customerSlug = url.searchParams.get('customer_slug')
  if (!customerSlug) {
    return jsonResponse({ error: 'customer_slug query param is required' }, 400)
  }

  const defaults = defaultWindow()
  const start = url.searchParams.get('start') ?? defaults.start
  const end = url.searchParams.get('end') ?? defaults.end
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return jsonResponse({ error: 'start and end must be YYYY-MM-DD' }, 400)
  }
  if (start >= end) {
    return jsonResponse({ error: 'start must be before end' }, 400)
  }

  const customers = await listCostCustomers(env.DB)
  const customer = customers.find((c) => c.customer_slug === customerSlug)
  if (!customer) {
    return jsonResponse({ error: 'customer not found' }, 404)
  }
  if (!customer.per_customer_d1_database_id) {
    return jsonResponse({ error: 'customer has no per-customer D1 database configured' }, 409)
  }
  if (!env.CF_ACCOUNT_ID || !env.CF_D1_API_TOKEN) {
    return jsonResponse({ error: 'CF_ACCOUNT_ID / CF_D1_API_TOKEN not configured' }, 503)
  }

  const result = await fetchCustomerCostRows(
    { CF_ACCOUNT_ID: env.CF_ACCOUNT_ID, CF_D1_API_TOKEN: env.CF_D1_API_TOKEN },
    customer.per_customer_d1_database_id,
    start,
    end
  )
  if (result.error) {
    return jsonResponse({ error: result.error }, 502)
  }

  const csv = rowsToCsv(customerSlug, result.rows)
  const filename = `operator-cost-${customerSlug}-${start}-to-${end}.csv`
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const GET: APIRoute = (ctx) => handleGet(ctx)
