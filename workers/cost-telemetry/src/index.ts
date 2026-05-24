/**
 * Cost Telemetry Worker — daily cost-driver ingest.
 *
 * Runs at 02:00 UTC daily per `triggers.crons` in wrangler.toml. Per
 * docs/specs/ai-employee/cost-telemetry-events.md "Nightly Captain job",
 * the worker iterates every active AI Employee customer, pulls
 * yesterday's Anthropic + Composio usage, and UPSERTs into each
 * customer's per-customer `cost_telemetry` D1 table.
 *
 * Cloudflare D1/R2/Vectorize metering is deferred to phase 2 per the
 * validation-spike outcome documented in
 * ai-employee/adapter/cost_ingest.py. Token cost dominates the COGS
 * surface for v1.
 *
 * Customer enumeration: the central D1 `customer_configs` table holds
 * the list. The per-customer D1 database id is required to address
 * the right database via the D1 HTTP API. v1 reads from a metadata
 * column on `customer_configs` (`per_customer_d1_database_id` —
 * populated by the customer provisioner at create time; this worker
 * skips customers without one and logs the skip).
 */

import { AnthropicHttpSource, CloudflareD1Client, ComposioHttpSource } from './clients'
import {
  runIngestForCustomer,
  type CustomerIngestContext,
  type CustomerIngestResult,
} from './ingest'

export interface Env {
  DB: D1Database
  CF_ACCOUNT_ID: string
  CF_D1_API_TOKEN: string
  ANTHROPIC_API_KEY: string
  COMPOSIO_API_KEY?: string
  COST_INGEST_BEARER?: string
}

interface CustomerRow {
  customer_slug: string
  per_customer_d1_database_id: string | null
  composio_account_id: string | null
}

/** Read the active customer list with the per-customer D1 id resolved. */
async function listCustomers(db: D1Database): Promise<CustomerRow[]> {
  // `connectors_json` carries non-secret references including the
  // per-customer Hermes database id and the composio account id. The
  // projection layer denormalizes them into the JSON blob per ADR 0012.
  // For v1 the worker uses two convention keys; if not present the
  // customer is skipped (logged, not errored).
  const result = await db
    .prepare('SELECT customer_slug, connectors_json FROM customer_configs')
    .all<{ customer_slug: string; connectors_json: string | null }>()

  const rows: CustomerRow[] = []
  for (const row of result.results ?? []) {
    let perCustomerDbId: string | null = null
    let composioAccountId: string | null = null
    if (row.connectors_json) {
      try {
        const parsed = JSON.parse(row.connectors_json) as Record<string, unknown>
        const dbId = parsed['per_customer_d1_database_id']
        const composio = parsed['composio_account_id']
        if (typeof dbId === 'string' && dbId.length > 0) perCustomerDbId = dbId
        if (typeof composio === 'string' && composio.length > 0) composioAccountId = composio
      } catch {
        // Bad JSON — skip; not the worker's job to fix projection.
      }
    }
    rows.push({
      customer_slug: row.customer_slug,
      per_customer_d1_database_id: perCustomerDbId,
      composio_account_id: composioAccountId,
    })
  }
  return rows
}

function yesterdayUtc(now: Date = new Date()): string {
  const ms = now.getTime() - 24 * 60 * 60 * 1000
  const d = new Date(ms)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

interface RunSummary {
  day: string
  customersTotal: number
  customersSkipped: number
  customersRun: number
  customersWithFailures: number
  totalCentsWritten: number
  perCustomer: CustomerIngestResult[]
  skipped: Array<{ customer_slug: string; reason: string }>
}

export async function run(env: Env, day?: string): Promise<RunSummary> {
  const targetDay = day ?? yesterdayUtc()
  const customers = await listCustomers(env.DB)

  const d1 = new CloudflareD1Client(env.CF_ACCOUNT_ID, env.CF_D1_API_TOKEN)
  const anthropicSource = new AnthropicHttpSource()
  const composioSource = env.COMPOSIO_API_KEY ? new ComposioHttpSource() : null

  const summary: RunSummary = {
    day: targetDay,
    customersTotal: customers.length,
    customersSkipped: 0,
    customersRun: 0,
    customersWithFailures: 0,
    totalCentsWritten: 0,
    perCustomer: [],
    skipped: [],
  }

  for (const customer of customers) {
    if (!customer.per_customer_d1_database_id) {
      summary.customersSkipped++
      summary.skipped.push({
        customer_slug: customer.customer_slug,
        reason: 'no per_customer_d1_database_id in connectors_json',
      })
      console.warn(
        `[cost-telemetry] skip ${customer.customer_slug}: no per_customer_d1_database_id`
      )
      continue
    }

    const ctx: CustomerIngestContext = {
      customerSlug: customer.customer_slug,
      perCustomerDatabaseId: customer.per_customer_d1_database_id,
      anthropicApiKey: env.ANTHROPIC_API_KEY,
      composioApiKey: env.COMPOSIO_API_KEY,
      composioAccountId: customer.composio_account_id ?? undefined,
    }

    try {
      const result = await runIngestForCustomer(ctx, d1, anthropicSource, composioSource, targetDay)
      summary.customersRun++
      summary.perCustomer.push(result)
      if (result.anyFailures) summary.customersWithFailures++
      summary.totalCentsWritten += result.totalCents
    } catch (e) {
      summary.customersWithFailures++
      summary.customersRun++
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[cost-telemetry] ${customer.customer_slug}: ${msg}`)
      summary.perCustomer.push({
        customerSlug: customer.customer_slug,
        day: targetDay,
        sources: [
          {
            source: 'orchestrator',
            ok: false,
            rowsWritten: 0,
            centsWritten: 0,
            reason: msg,
          },
        ],
        anyFailures: true,
        totalCents: 0,
      })
    }
  }

  console.log(
    `[cost-telemetry] day=${summary.day} customers=${summary.customersTotal} ` +
      `run=${summary.customersRun} skipped=${summary.customersSkipped} ` +
      `failures=${summary.customersWithFailures} cents=${summary.totalCentsWritten}`
  )

  return summary
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    await run(env)
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (env.COST_INGEST_BEARER) {
      const auth = request.headers.get('Authorization')
      if (auth !== `Bearer ${env.COST_INGEST_BEARER}`) {
        return new Response('Unauthorized', { status: 401 })
      }
    }
    const url = new URL(request.url)
    const day = url.searchParams.get('day') ?? undefined
    const summary = await run(env, day)
    return new Response(JSON.stringify(summary, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
} satisfies ExportedHandler<Env>
