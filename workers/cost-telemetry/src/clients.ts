/**
 * Anthropic usage-report client for the cost telemetry worker.
 *
 * One external surface: the Anthropic Admin API's usage report,
 * `GET /v1/organizations/usage_report/messages`. It requires an ADMIN
 * API key (sk-ant-admin...); the runtime ANTHROPIC_API_KEY is rejected
 * with authentication_error (verified live, 2026-07-03). The worker's
 * secret is ANTHROPIC_ADMIN_KEY.
 *
 * Per ADR 0062 the report is grouped by workspace_id AND model:
 * workspace_id carries the per-seat attribution (one Anthropic
 * workspace per customer seat), model feeds the cents math against
 * anthropic_pricing.json.
 *
 * The client is a thin wrapper — no caching, no retry. The cron run is
 * the natural retry boundary (a missed day rolls forward to the next
 * night, and writes are idempotent day totals).
 */

import type { AnthropicSource, AnthropicUsageRow } from './ingest'

/**
 * Response shape of /v1/organizations/usage_report/messages (the fields
 * this worker reads). `data` is a list of time buckets; with
 * bucket_width=1d and a one-day window there is exactly one bucket, but
 * the client tolerates several and paginates on `has_more`.
 */
interface UsageReportPayload {
  data?: Array<{
    starting_at?: string
    ending_at?: string
    results?: Array<{
      workspace_id?: string | null
      model?: string | null
      uncached_input_tokens?: number
      cache_read_input_tokens?: number
      cache_creation?: {
        ephemeral_1h_input_tokens?: number
        ephemeral_5m_input_tokens?: number
      }
      output_tokens?: number
    }>
  }>
  has_more?: boolean
  next_page?: string | null
}

export class AnthropicHttpSource implements AnthropicSource {
  async fetchDailyUsage(adminKey: string, day: string): Promise<AnthropicUsageRow[]> {
    const out: AnthropicUsageRow[] = []
    let page: string | null = null

    do {
      const url = new URL('https://api.anthropic.com/v1/organizations/usage_report/messages')
      url.searchParams.set('starting_at', `${day}T00:00:00Z`)
      url.searchParams.set('ending_at', nextDayUtc(day))
      url.searchParams.set('bucket_width', '1d')
      url.searchParams.append('group_by[]', 'workspace_id')
      url.searchParams.append('group_by[]', 'model')
      if (page) url.searchParams.set('page', page)

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'x-api-key': adminKey,
          'anthropic-version': '2023-06-01',
        },
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Anthropic usage HTTP ${res.status}: ${text.slice(0, 200)}`)
      }
      const payload: UsageReportPayload = await res.json()

      for (const bucket of payload.data ?? []) {
        for (const r of bucket.results ?? []) {
          if (!r.model) continue
          // Input tokens roll up every input variant. The v1 cents math
          // prices them all at the model's input rate (cache reads and
          // cache writes bill at different multipliers upstream; the
          // uniform rate is a documented conservative approximation —
          // the '_org' reconciliation row is the cross-check against
          // the invoice).
          const inputTokens =
            num(r.uncached_input_tokens) +
            num(r.cache_read_input_tokens) +
            num(r.cache_creation?.ephemeral_1h_input_tokens) +
            num(r.cache_creation?.ephemeral_5m_input_tokens)
          out.push({
            workspaceId:
              typeof r.workspace_id === 'string' && r.workspace_id.length > 0
                ? r.workspace_id
                : null,
            model: r.model,
            inputTokens,
            outputTokens: num(r.output_tokens),
          })
        }
      }

      page = payload.has_more && payload.next_page ? payload.next_page : null
    } while (page)

    return out
  }
}

function num(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** 'YYYY-MM-DD' -> exclusive end-of-day RFC 3339 timestamp (next day 00:00 UTC). */
function nextDayUtc(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d) + 86_400_000)
  const yyyy = next.getUTCFullYear()
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(next.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T00:00:00Z`
}
