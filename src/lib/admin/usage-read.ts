/**
 * Per-person token usage, read live from a seat (#2070).
 *
 * The nightly cost plane (`cost_telemetry`) answers "what did this seat spend?"
 * at workspace granularity. It cannot answer "whose work was that?" — the
 * question the sustained-dialogue program raises: once a firm's people talk to
 * the Operator all day instead of to claude.ai, the retainer's margin depends
 * on who is driving the tokens.
 *
 * The Machine meters that itself (overlay `hermes-smd-usage`) and serves it
 * over the runtime-read seam as `usage_export`. This module is the read + shape
 * guard + aggregation for the admin cost page.
 *
 * Two properties this deliberately keeps:
 *
 * - **Live, not durable.** These numbers come from the seat's own store on
 *   every page load. A stopped or unreachable Machine yields an honest
 *   `unreachable`, never a stale figure presented as current. There is no
 *   off-seat mirror; if one is wanted later it is a separate lane.
 * - **Fail-closed parsing.** A row that does not match the expected shape is
 *   dropped, not coerced. A malformed meter must under-report visibly rather
 *   than invent a number a pricing decision might rest on.
 *
 * SMD-only: cost is the one domain the client never reads (ADR 0041/0052 §8,
 * facet registry `cost` → `smd_only`).
 */

import {
  readMachineRuntime,
  type MachineRuntimeTransport,
  type RuntimeReadAudit,
  type RuntimeReadActor,
} from '../operator/runtime-read'

/** A person (or `system:*` lane) and their totals over the window. */
export interface UsageActorTotals {
  actor: string
  /** True when this row is scheduled/delegated work rather than a person. */
  isSystem: boolean
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  requests: number
  /** Per-day totals, newest first. */
  days: UsageDayTotals[]
}

export interface UsageDayTotals {
  day: string
  inputTokens: number
  outputTokens: number
  requests: number
}

export type UsageReadResult =
  | { status: 'not_enabled' }
  | { status: 'unreachable'; reason: string }
  | { status: 'empty' }
  | { status: 'items'; actors: UsageActorTotals[]; totalRequests: number; windowDays: number }

interface UsageMeterRow {
  day: string
  attributedTo: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  requests: number
}

const DEFAULT_WINDOW_DAYS = 30

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

/**
 * Parse one meter row, or null if it is not usable. `day` and `attributed_to`
 * are the identity of the row — without both, the row cannot be placed, so it
 * is dropped rather than bucketed under a guess.
 */
function parseRow(raw: unknown): UsageMeterRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const day = typeof r['day'] === 'string' ? r['day'] : ''
  const actor = typeof r['attributed_to'] === 'string' ? r['attributed_to'] : ''
  if (!day || !actor) return null
  return {
    day,
    attributedTo: actor,
    inputTokens: asCount(r['input_tokens']),
    outputTokens: asCount(r['output_tokens']),
    cacheReadTokens: asCount(r['cache_read_tokens']),
    cacheWriteTokens: asCount(r['cache_write_tokens']),
    requests: asCount(r['requests']),
  }
}

/** Rows within the window, newest-day-first, grouped by actor. */
export function aggregateUsage(
  rows: UsageMeterRow[],
  windowDays: number = DEFAULT_WINDOW_DAYS,
  today: string = new Date().toISOString().slice(0, 10)
): UsageActorTotals[] {
  const cutoff = new Date(`${today}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - (windowDays - 1))
  const cutoffDay = cutoff.toISOString().slice(0, 10)

  const byActor = new Map<string, UsageActorTotals>()
  for (const row of rows) {
    if (row.day < cutoffDay) continue
    let entry = byActor.get(row.attributedTo)
    if (!entry) {
      entry = {
        actor: row.attributedTo,
        isSystem: row.attributedTo.startsWith('system:'),
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        requests: 0,
        days: [],
      }
      byActor.set(row.attributedTo, entry)
    }
    entry.inputTokens += row.inputTokens
    entry.outputTokens += row.outputTokens
    entry.cacheReadTokens += row.cacheReadTokens
    entry.cacheWriteTokens += row.cacheWriteTokens
    entry.requests += row.requests
    // The meter is keyed (day, person, MODEL), so one actor-day can arrive as
    // several rows; fold them into a single day entry.
    const existingDay = entry.days.find((d) => d.day === row.day)
    if (existingDay) {
      existingDay.inputTokens += row.inputTokens
      existingDay.outputTokens += row.outputTokens
      existingDay.requests += row.requests
    } else {
      entry.days.push({
        day: row.day,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        requests: row.requests,
      })
    }
  }

  for (const entry of byActor.values()) {
    entry.days.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
  }
  // People first (the question this surface answers), then the system lanes;
  // within each group, heaviest usage first.
  return [...byActor.values()].sort((a, b) => {
    if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1
    return b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)
  })
}

interface UsageReadDeps {
  transport: MachineRuntimeTransport
  audit: RuntimeReadAudit
}

/**
 * Read and aggregate one seat's per-person meter.
 *
 * `configured` mirrors the runtime-observe loader: when the read path is not
 * wired we return `not_enabled` WITHOUT attempting a read, so a dark deploy
 * writes no runtime-read-audit noise on every page load.
 */
export async function loadUsageView(
  deps: UsageReadDeps,
  customerSlug: string,
  actor: RuntimeReadActor,
  configured: boolean,
  windowDays: number = DEFAULT_WINDOW_DAYS
): Promise<UsageReadResult> {
  if (!configured) return { status: 'not_enabled' }

  const rows: UsageMeterRow[] = []
  let cursor: string | null = null
  // Bounded page walk: the meter is aggregate-grained (day × person × model),
  // so a real seat is tens of rows; the cap is a runaway guard, not a limit we
  // expect to hit.
  for (let page = 0; page < 20; page += 1) {
    const result = await readMachineRuntime(
      deps,
      customerSlug,
      { kind: 'usage_export', cursor },
      actor
    )
    if (!result.ok) {
      return { status: 'unreachable', reason: result.reason }
    }
    const payload = result.data as { entries?: unknown; cursor?: unknown } | null
    const entries = Array.isArray(payload?.entries) ? payload.entries : []
    for (const raw of entries) {
      const parsed = parseRow(raw)
      if (parsed) rows.push(parsed)
    }
    cursor = typeof payload?.cursor === 'string' && payload.cursor ? payload.cursor : null
    if (!cursor) break
  }

  const actors = aggregateUsage(rows, windowDays)
  if (actors.length === 0) return { status: 'empty' }
  const totalRequests = actors.reduce((sum, a) => sum + a.requests, 0)
  return { status: 'items', actors, totalRequests, windowDays }
}

export { DEFAULT_WINDOW_DAYS, parseRow }
