/**
 * Production HTTP clients for the cost telemetry worker.
 *
 * Two external surfaces:
 *
 *   1. Cloudflare D1 HTTP API — used to write per-customer cost_telemetry
 *      rows. Each customer has a distinct database id, so the client
 *      takes the id per call rather than baking it in.
 *
 *   2. Anthropic billing / usage API — daily token usage per model. The
 *      Anthropic Console exposes a usage endpoint; the exact shape may
 *      shift between API versions, so the client normalizes to
 *      `AnthropicUsageRow[]`. If the upstream shape drifts, only this
 *      file needs to change.
 *
 * Both clients are thin wrappers — no caching, no retry. The cron run
 * is the natural retry boundary (a missed day rolls forward to the
 * next night).
 */

import type { AnthropicSource, AnthropicUsageRow, D1HttpClient } from './ingest'

// ---------------------------------------------------------------------------
// Cloudflare D1 HTTP client
// ---------------------------------------------------------------------------

export class CloudflareD1Client implements D1HttpClient {
  private readonly accountId: string
  private readonly apiToken: string

  constructor(accountId: string, apiToken: string) {
    this.accountId = accountId
    this.apiToken = apiToken
  }

  async execute(databaseId: string, sql: string, params: unknown[]): Promise<void> {
    const url =
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}` +
      `/d1/database/${databaseId}/query`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`D1 HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    const payload: { success?: boolean; errors?: unknown } = await res.json()
    if (!payload.success) {
      throw new Error(`D1 query failed: ${JSON.stringify(payload.errors ?? payload)}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Anthropic usage client
// ---------------------------------------------------------------------------

/**
 * Anthropic usage API client.
 *
 * The Anthropic Usage & Cost API exposes daily token usage per
 * workspace/model. The endpoint shape used here is the documented
 * `/v1/organizations/usage_report/messages` form. If the API surface
 * shifts, normalize within this class — the rest of the ingest
 * pipeline accepts `AnthropicUsageRow[]` only.
 */
export class AnthropicHttpSource implements AnthropicSource {
  async fetchDailyUsage(apiKey: string, day: string): Promise<AnthropicUsageRow[]> {
    const url = new URL('https://api.anthropic.com/v1/organizations/usage_report/messages')
    // The API expects a date range; we ask for exactly the one day.
    url.searchParams.set('starting_at', `${day}T00:00:00Z`)
    url.searchParams.set('ending_at', `${day}T23:59:59Z`)
    url.searchParams.set('group_by[]', 'model')

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Anthropic usage HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    const payload: {
      data?: Array<{
        model?: string
        input_tokens?: number
        output_tokens?: number
      }>
    } = await res.json()
    const rows = payload.data ?? []
    const out: AnthropicUsageRow[] = []
    for (const r of rows) {
      if (!r.model) continue
      out.push({
        model: r.model,
        inputTokens: Number(r.input_tokens ?? 0),
        outputTokens: Number(r.output_tokens ?? 0),
      })
    }
    return out
  }
}
