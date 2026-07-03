/**
 * Cost Telemetry Worker — daily cost-driver ingest (ADR 0062).
 *
 * Runs at 02:00 UTC daily per `triggers.crons` in wrangler.toml. The
 * worker pulls yesterday's org-wide Anthropic usage grouped by
 * (workspace_id, model) via the Admin usage-report API and UPSERTs
 * per-seat rows into the CENTRAL `cost_telemetry` table in
 * ss-console-db (migration 0083), keyed (customer_slug, date, driver).
 *
 * Per-seat attribution comes from per-customer Anthropic workspaces:
 * `customer_configs.anthropic_workspace_id` maps each workspace to a
 * seat. Unmapped workspaces land under the reserved slug '_unmapped';
 * the org total is written under '_org' as a reconciliation row. See
 * src/ingest.ts and docs/runbooks/operator/cost-telemetry-enable.md.
 *
 * The per-customer-D1 enumeration this worker used to perform is gone:
 * those databases were never provisioned (ADR 0062 context; ADR 0009's
 * wiring note), so the old path skipped every seat.
 *
 * Cloudflare D1/R2/Vectorize metering remains deferred to phase 2 per
 * the validation-spike outcome documented in
 * operator/adapter/cost_ingest.py. Token cost dominates the COGS
 * surface for v1.
 */

import { AnthropicHttpSource } from './clients'
import { runIngest, type IngestResult } from './ingest'

export interface Env {
  DB: D1Database
  /**
   * Anthropic ADMIN API key (sk-ant-admin...). The usage-report API
   * rejects regular runtime keys with authentication_error. Missing
   * key: the run logs one clear error and exits cleanly — the cron
   * must not crashloop while the Captain enablement step is pending.
   */
  ANTHROPIC_ADMIN_KEY?: string
  COST_INGEST_BEARER?: string
}

function yesterdayUtc(now: Date = new Date()): string {
  const ms = now.getTime() - 24 * 60 * 60 * 1000
  const d = new Date(ms)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export async function run(env: Env, day?: string): Promise<IngestResult> {
  const targetDay = day ?? yesterdayUtc()

  if (!env.ANTHROPIC_ADMIN_KEY) {
    const reason =
      'ANTHROPIC_ADMIN_KEY is not set; skipping ingest. Mint an Admin API key and ' +
      'stage it per docs/runbooks/operator/cost-telemetry-enable.md.'
    console.error(`[cost-telemetry] ${reason}`)
    return {
      ok: false,
      day: targetDay,
      rowsWritten: 0,
      centsWritten: 0,
      slugs: [],
      unmappedWorkspaceIds: [],
      warnings: [],
      reason,
    }
  }

  const result = await runIngest(
    env.DB,
    new AnthropicHttpSource(),
    env.ANTHROPIC_ADMIN_KEY,
    targetDay
  )

  console.log(
    `[cost-telemetry] day=${result.day} ok=${result.ok} rows=${result.rowsWritten} ` +
      `cents=${result.centsWritten} slugs=${result.slugs.join(',')} ` +
      `unmapped=${result.unmappedWorkspaceIds.join(',') || 'none'}`
  )

  return result
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
