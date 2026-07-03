/**
 * Central cost telemetry ingest (ADR 0062, #1660).
 *
 * Pulls yesterday's org-wide Anthropic usage grouped by
 * (workspace_id, model), maps each workspace to a customer seat via
 * `customer_configs.anthropic_workspace_id`, and UPSERTs per-seat rows
 * into the CENTRAL `cost_telemetry` table (migration 0083) keyed
 * (customer_slug, date, driver).
 *
 * Attribution rules:
 *   - workspace_id with an authored mapping  -> that customer_slug
 *   - workspace_id without a mapping (or the default workspace, which
 *     the API reports as null) -> reserved slug '_unmapped', with a
 *     logged warning naming the workspace id. Nothing is silently
 *     dropped.
 *   - the org total across all workspaces    -> reserved slug '_org'
 *     under drivers 'anthropic.org_total.input_tokens' /
 *     'anthropic.org_total.output_tokens'. Reconciliation cross-check,
 *     not an attribution source (ADR 0062 decision 2).
 *
 * Write semantics are idempotent day totals: the usage-report API
 * returns the authoritative total for the day, so a re-run REPLACES the
 * row instead of accumulating (unlike the per-event additive contract
 * used by the captain-time CLI rollup).
 *
 * This module supersedes the per-customer-D1 fan-out (the databases it
 * addressed were never provisioned; see ADR 0062 context).
 */

import { computeAnthropicCents } from './pricing'

/** One (workspace, model) usage row from the Anthropic usage report. */
export interface AnthropicUsageRow {
  /** Anthropic workspace id, or null for the org default workspace. */
  workspaceId: string | null
  model: string
  inputTokens: number
  outputTokens: number
}

export interface AnthropicSource {
  fetchDailyUsage(adminKey: string, day: string): Promise<AnthropicUsageRow[]>
}

/**
 * Minimal structural slice of the D1 binding used here — satisfied by
 * the real D1Database and trivially fakeable in tests.
 */
export interface CentralDb {
  prepare(sql: string): {
    bind(...params: unknown[]): {
      run(): Promise<unknown>
      all<T>(): Promise<{ results?: T[] }>
    }
    all<T>(): Promise<{ results?: T[] }>
  }
}

export const ORG_SLUG = '_org'
export const UNMAPPED_SLUG = '_unmapped'

export const ORG_INPUT_DRIVER = 'anthropic.org_total.input_tokens'
export const ORG_OUTPUT_DRIVER = 'anthropic.org_total.output_tokens'

export interface IngestResult {
  ok: boolean
  day: string
  rowsWritten: number
  centsWritten: number
  /** Slugs (customers + reserved) that received at least one row. */
  slugs: string[]
  /** Workspace ids seen in the report with no authored mapping. */
  unmappedWorkspaceIds: string[]
  warnings: string[]
  reason?: string
}

interface WorkspaceMappingRow {
  customer_slug: string
  anthropic_workspace_id: string
}

/** Load the authored workspace_id -> customer_slug mapping from central D1. */
export async function loadWorkspaceMapping(db: CentralDb): Promise<Map<string, string>> {
  const result = await db
    .prepare(
      'SELECT customer_slug, anthropic_workspace_id FROM customer_configs ' +
        "WHERE anthropic_workspace_id IS NOT NULL AND anthropic_workspace_id != ''"
    )
    .all<WorkspaceMappingRow>()
  const map = new Map<string, string>()
  for (const row of result.results ?? []) {
    map.set(row.anthropic_workspace_id, row.customer_slug)
  }
  return map
}

const UPSERT_SQL =
  'INSERT INTO cost_telemetry (customer_slug, date, driver, amount_cents, units, unit_type, updated_at) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
  'ON CONFLICT (customer_slug, date, driver) DO UPDATE SET ' +
  '  amount_cents = excluded.amount_cents, ' +
  '  units = excluded.units, ' +
  '  unit_type = excluded.unit_type, ' +
  '  updated_at = excluded.updated_at'

interface Totals {
  inputTokens: number
  outputTokens: number
  inputCents: number
  outputCents: number
}

function emptyTotals(): Totals {
  return { inputTokens: 0, outputTokens: 0, inputCents: 0, outputCents: 0 }
}

interface Aggregation {
  bySlug: Map<string, Totals>
  org: Totals
  unmappedWorkspaceIds: string[]
  warnings: string[]
}

/** Attribute usage rows to slugs (mapped seat, '_unmapped') and total the org. */
export function aggregateUsage(
  rows: AnthropicUsageRow[],
  mapping: Map<string, string>
): Aggregation {
  const warnings: string[] = []
  const bySlug = new Map<string, Totals>()
  const org = emptyTotals()
  const unmapped = new Set<string>()

  for (const row of rows) {
    const { inputCents, outputCents, warning } = computeAnthropicCents(
      row.model,
      row.inputTokens,
      row.outputTokens
    )
    if (warning) {
      warnings.push(warning)
      console.warn(`[cost-telemetry] ${warning}`)
    }

    let slug: string
    if (row.workspaceId && mapping.has(row.workspaceId)) {
      slug = mapping.get(row.workspaceId)!
    } else {
      slug = UNMAPPED_SLUG
      if (row.workspaceId) unmapped.add(row.workspaceId)
    }

    const t = bySlug.get(slug) ?? emptyTotals()
    t.inputTokens += row.inputTokens
    t.outputTokens += row.outputTokens
    t.inputCents += inputCents
    t.outputCents += outputCents
    bySlug.set(slug, t)

    org.inputTokens += row.inputTokens
    org.outputTokens += row.outputTokens
    org.inputCents += inputCents
    org.outputCents += outputCents
  }

  for (const workspaceId of unmapped) {
    console.warn(
      `[cost-telemetry] workspace ${workspaceId} has no ` +
        `customer_configs.anthropic_workspace_id mapping; usage recorded under '${UNMAPPED_SLUG}'`
    )
  }

  return { bySlug, org, unmappedWorkspaceIds: [...unmapped], warnings }
}

/** UPSERT the attributed rows plus the '_org' reconciliation pair. */
async function writeRows(
  db: CentralDb,
  day: string,
  agg: Aggregation
): Promise<{ rowsWritten: number; centsWritten: number }> {
  const updatedAt = new Date().toISOString()
  let rowsWritten = 0
  let centsWritten = 0

  async function upsert(
    slug: string,
    driver: string,
    amountCents: number,
    units: number,
    unitType: string
  ): Promise<void> {
    await db
      .prepare(UPSERT_SQL)
      .bind(slug, day, driver, amountCents, units, unitType, updatedAt)
      .run()
    rowsWritten++
  }

  // Per-seat attribution rows (including '_unmapped').
  for (const [slug, t] of agg.bySlug) {
    if (t.inputTokens > 0) {
      await upsert(slug, 'claude_api_input_tokens', t.inputCents, t.inputTokens, 'input_tokens')
      centsWritten += t.inputCents
    }
    if (t.outputTokens > 0) {
      await upsert(slug, 'claude_api_output_tokens', t.outputCents, t.outputTokens, 'output_tokens')
      centsWritten += t.outputCents
    }
  }

  // Org reconciliation rows under '_org'. Written even at zero usage so
  // "the ingest ran and the org total was 0" is distinguishable from
  // "the ingest never ran". Their cents are excluded from centsWritten
  // (they duplicate the attributed rows by construction).
  const { org } = agg
  await upsert(ORG_SLUG, ORG_INPUT_DRIVER, org.inputCents, org.inputTokens, 'input_tokens')
  await upsert(ORG_SLUG, ORG_OUTPUT_DRIVER, org.outputCents, org.outputTokens, 'output_tokens')

  return { rowsWritten, centsWritten }
}

export async function runIngest(
  db: CentralDb,
  source: AnthropicSource,
  adminKey: string,
  day: string
): Promise<IngestResult> {
  let rows: AnthropicUsageRow[]
  try {
    rows = await source.fetchDailyUsage(adminKey, day)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[cost-telemetry] usage fetch failed for ${day}: ${msg}`)
    return {
      ok: false,
      day,
      rowsWritten: 0,
      centsWritten: 0,
      slugs: [],
      unmappedWorkspaceIds: [],
      warnings: [],
      reason: `usage fetch failed: ${msg}`,
    }
  }

  const mapping = await loadWorkspaceMapping(db)
  const agg = aggregateUsage(rows, mapping)
  const { rowsWritten, centsWritten } = await writeRows(db, day, agg)

  return {
    ok: true,
    day,
    rowsWritten,
    centsWritten,
    slugs: [...agg.bySlug.keys(), ORG_SLUG],
    unmappedWorkspaceIds: agg.unmappedWorkspaceIds,
    warnings: agg.warnings,
  }
}
