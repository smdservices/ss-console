/**
 * Per-customer cost telemetry ingest — TS twin of
 * `ai-employee/adapter/cost_ingest.py`.
 *
 * Pulls yesterday's Anthropic + Composio usage and UPSERTs into the
 * customer's per-customer cost_telemetry D1 table via the Cloudflare
 * D1 HTTP API. Per ADR 0009 each customer has their own D1 database
 * — there is no cross-customer table — so the worker addresses each
 * customer's database id resolved from the central `customer_configs`.
 *
 * Failure isolation: a single source failing (Anthropic 503, Composio
 * 500) does NOT block the other source. The result names each source's
 * outcome so the cron summary can surface partial-success days.
 *
 * Source-of-truth references:
 *   docs/specs/ai-employee/cost-telemetry-events.md
 *   ai-employee/adapter/cost_ingest.py
 */

import { computeAnthropicCents, computeComposioCents } from './pricing'

export interface AnthropicUsageRow {
  model: string
  inputTokens: number
  outputTokens: number
}

export interface ComposioUsageRow {
  toolkit: string
  actionCount: number
}

export interface AnthropicSource {
  fetchDailyUsage(apiKey: string, day: string): Promise<AnthropicUsageRow[]>
}

export interface ComposioSource {
  fetchDailyUsage(apiKey: string, accountId: string, day: string): Promise<ComposioUsageRow[]>
}

/** Minimal D1 HTTP API shape used here. */
export interface D1HttpClient {
  execute(databaseId: string, sql: string, params: unknown[]): Promise<void>
}

export interface SourceResult {
  source: string
  ok: boolean
  rowsWritten: number
  centsWritten: number
  reason?: string
}

export interface CustomerIngestResult {
  customerSlug: string
  day: string
  sources: SourceResult[]
  anyFailures: boolean
  totalCents: number
}

const UPSERT_SQL =
  'INSERT INTO cost_telemetry (date, driver, amount_cents, units, unit_type) ' +
  'VALUES (?, ?, ?, ?, ?) ' +
  'ON CONFLICT (date, driver) DO UPDATE SET ' +
  '  amount_cents = amount_cents + excluded.amount_cents, ' +
  '  units = units + excluded.units'

interface UpsertRow {
  dayStr: string
  driver: string
  amountCents: number
  units: number
  unitType: string
}

async function upsertRow(d1: D1HttpClient, databaseId: string, row: UpsertRow): Promise<void> {
  await d1.execute(databaseId, UPSERT_SQL, [
    row.dayStr,
    row.driver,
    row.amountCents,
    row.units,
    row.unitType,
  ])
}

export async function ingestAnthropic(
  d1: D1HttpClient,
  databaseId: string,
  source: AnthropicSource,
  apiKey: string,
  day: string
): Promise<SourceResult> {
  let rows: AnthropicUsageRow[]
  try {
    rows = await source.fetchDailyUsage(apiKey, day)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`anthropic_billing fetch failed for ${day}: ${msg}`)
    return {
      source: 'anthropic_billing',
      ok: false,
      rowsWritten: 0,
      centsWritten: 0,
      reason: `fetch failed: ${msg}`,
    }
  }

  let totalInTokens = 0
  let totalOutTokens = 0
  let totalInCents = 0
  let totalOutCents = 0
  const warnings: string[] = []

  for (const row of rows) {
    const { inputCents, outputCents, warning } = computeAnthropicCents(
      row.model,
      row.inputTokens,
      row.outputTokens
    )
    if (warning) {
      warnings.push(warning)
      console.warn(warning)
    }
    totalInTokens += row.inputTokens
    totalOutTokens += row.outputTokens
    totalInCents += inputCents
    totalOutCents += outputCents
  }

  let rowsWritten = 0
  if (totalInTokens > 0) {
    await upsertRow(d1, databaseId, {
      dayStr: day,
      driver: 'claude_api_input_tokens',
      amountCents: totalInCents,
      units: totalInTokens,
      unitType: 'input_tokens',
    })
    rowsWritten++
  }
  if (totalOutTokens > 0) {
    await upsertRow(d1, databaseId, {
      dayStr: day,
      driver: 'claude_api_output_tokens',
      amountCents: totalOutCents,
      units: totalOutTokens,
      unitType: 'output_tokens',
    })
    rowsWritten++
  }

  return {
    source: 'anthropic_billing',
    ok: true,
    rowsWritten,
    centsWritten: totalInCents + totalOutCents,
    reason: warnings.length ? warnings.join('; ') : undefined,
  }
}

export interface ComposioIngestArgs {
  source: ComposioSource
  apiKey: string
  accountId: string
  day: string
}

export async function ingestComposio(
  d1: D1HttpClient,
  databaseId: string,
  args: ComposioIngestArgs
): Promise<SourceResult> {
  const { source, apiKey, accountId, day } = args
  let rows: ComposioUsageRow[]
  try {
    rows = await source.fetchDailyUsage(apiKey, accountId, day)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`composio_usage fetch failed for ${day}: ${msg}`)
    return {
      source: 'composio_usage',
      ok: false,
      rowsWritten: 0,
      centsWritten: 0,
      reason: `fetch failed: ${msg}`,
    }
  }

  let totalActions = 0
  let totalCents = 0
  for (const row of rows) {
    totalActions += row.actionCount
    totalCents += computeComposioCents(row.toolkit, row.actionCount)
  }

  let rowsWritten = 0
  if (totalActions > 0) {
    await upsertRow(d1, databaseId, {
      dayStr: day,
      driver: 'composio_actions',
      amountCents: totalCents,
      units: totalActions,
      unitType: 'api_calls',
    })
    rowsWritten = 1
  }

  return {
    source: 'composio_usage',
    ok: true,
    rowsWritten,
    centsWritten: totalCents,
  }
}

export interface CustomerIngestContext {
  customerSlug: string
  perCustomerDatabaseId: string
  anthropicApiKey: string
  composioApiKey?: string
  composioAccountId?: string
}

export async function runIngestForCustomer(
  ctx: CustomerIngestContext,
  d1: D1HttpClient,
  anthropicSource: AnthropicSource,
  composioSource: ComposioSource | null,
  day: string
): Promise<CustomerIngestResult> {
  const sources: SourceResult[] = []

  try {
    const anth = await ingestAnthropic(
      d1,
      ctx.perCustomerDatabaseId,
      anthropicSource,
      ctx.anthropicApiKey,
      day
    )
    sources.push(anth)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`anthropic ingest crashed for ${ctx.customerSlug}: ${msg}`)
    sources.push({
      source: 'anthropic_billing',
      ok: false,
      rowsWritten: 0,
      centsWritten: 0,
      reason: `unhandled exception: ${msg}`,
    })
  }

  if (composioSource && ctx.composioApiKey && ctx.composioAccountId) {
    try {
      const comp = await ingestComposio(d1, ctx.perCustomerDatabaseId, {
        source: composioSource,
        apiKey: ctx.composioApiKey,
        accountId: ctx.composioAccountId,
        day,
      })
      sources.push(comp)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`composio ingest crashed for ${ctx.customerSlug}: ${msg}`)
      sources.push({
        source: 'composio_usage',
        ok: false,
        rowsWritten: 0,
        centsWritten: 0,
        reason: `unhandled exception: ${msg}`,
      })
    }
  }

  return {
    customerSlug: ctx.customerSlug,
    day,
    sources,
    anyFailures: sources.some((s) => !s.ok),
    totalCents: sources.reduce((sum, s) => sum + s.centsWritten, 0),
  }
}
