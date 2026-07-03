/**
 * Fleet-roster reader for the admin Operator console landing
 * (`/admin/operator`) — design doc docs/design/operator/01-admin-portal.md §4.1.
 *
 * The roster is the "is anything on fire across all my operators" view: one
 * row per client, scannable as the fleet grows. It composes three console-side
 * projections, never a cross-Machine runtime join (ADR 0009):
 *
 *   1. `customer_configs`            — identity, persona roster, authority posture
 *   2. `operator_runtime_summary`    — health/alerts/last-activity mirror (ADR 0043 B)
 *   3. `fleet_status`                — per-customer heartbeat liveness (ADR 0023)
 *
 * This module owns only #1's read + the pure derivations the page renders
 * (posture label, combined health). The summary/heartbeat readers are the
 * frozen seam (src/lib/admin/runtime-summary.ts, fleet-status.ts); the page
 * joins them by entity_id (slug fallback), exactly as the costs page does.
 *
 * Fleet-view discipline (foundations §7, ADR 0043): one corrupt config row must
 * never 500 the whole fleet view. `listFleetRoster` parses each row defensively
 * — a malformed personas/authority column degrades that single row to a flagged
 * `config_error` state with an empty persona list and the launch-default
 * posture, and the rest of the fleet still renders.
 */

import type { D1Database } from '@cloudflare/workers-types'
import {
  DEFAULT_AUTHORITY_POSTURE,
  parseAuthorityPosture,
  resolveAllDomains,
  type AuthorityPosture,
} from '../operator/authority'
import type { SummaryStatus } from './runtime-summary'

export interface RosterPersona {
  slug: string
  name: string
  status: string
}

export interface RosterCustomer {
  entity_id: string
  customer_slug: string
  /** Display name from `entities.name`; null when no entity row joins. */
  entity_name: string | null
  /** Projected `customer_configs.vertical`; null before CI sync backfills it. */
  vertical: string | null
  personas: RosterPersona[]
  authority: AuthorityPosture
  /**
   * Set when this row's projected JSON was malformed. The row still renders
   * (degraded) so one corrupt config never blanks the fleet view — the flag
   * lets the page surface "this operator's config needs attention" honestly
   * instead of silently showing zero personas.
   */
  config_error: string | null
}

interface RosterDbRow {
  entity_id: string
  customer_slug: string
  personas_json: string
  authority_json: string | null
  vertical: string | null
}

interface EntityNameRow {
  id: string
  name: string
}

/**
 * Enumerate every Operator customer for the fleet roster, ordered by slug.
 * One batched read of `customer_configs` + one batched name lookup — no
 * per-row query and no per-customer Machine round-trip.
 */
export async function listFleetRoster(db: D1Database): Promise<RosterCustomer[]> {
  const configResult = await db
    .prepare(
      `SELECT entity_id, customer_slug, personas_json, authority_json, vertical
         FROM customer_configs
        ORDER BY customer_slug ASC`
    )
    .all<RosterDbRow>()
  const rows = configResult.results ?? []
  if (rows.length === 0) return []

  const namesByEntity = await loadEntityNames(
    db,
    rows.map((r) => r.entity_id)
  )

  return rows.map((row) => projectRosterRow(row, namesByEntity.get(row.entity_id) ?? null))
}

async function loadEntityNames(db: D1Database, entityIds: string[]): Promise<Map<string, string>> {
  const placeholders = entityIds.map(() => '?').join(',')
  const result = await db
    .prepare(`SELECT id, name FROM entities WHERE id IN (${placeholders})`)
    .bind(...entityIds)
    .all<EntityNameRow>()
  const map = new Map<string, string>()
  for (const row of result.results ?? []) map.set(row.id, row.name)
  return map
}

function projectRosterRow(row: RosterDbRow, entityName: string | null): RosterCustomer {
  const base = {
    entity_id: row.entity_id,
    customer_slug: row.customer_slug,
    entity_name: entityName,
    vertical: row.vertical,
  }
  try {
    return {
      ...base,
      personas: parsePersonas(row.personas_json),
      // parseAuthorityPosture is total (never throws); a malformed personas
      // column is what flips a row into the error state.
      authority: parseAuthorityPosture(safeJsonParse(row.authority_json)),
      config_error: null,
    }
  } catch (err) {
    return {
      ...base,
      personas: [],
      authority: { ...DEFAULT_AUTHORITY_POSTURE },
      config_error: err instanceof Error ? err.message : String(err),
    }
  }
}

function parsePersonas(raw: string): RosterPersona[] {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('personas_json is not an array')
  return parsed.map((p) => {
    if (typeof p !== 'object' || p === null) throw new Error('persona entry is not an object')
    const rec = p as Record<string, unknown>
    return {
      slug: typeof rec.slug === 'string' ? rec.slug : '',
      name: typeof rec.name === 'string' ? rec.name : '',
      status: typeof rec.status === 'string' ? rec.status : 'unknown',
    }
  })
}

/** Null-tolerant JSON parse; null/undefined → null, malformed → throws. */
function safeJsonParse(value: string | null | undefined): unknown {
  if (value === null || value === undefined) return null
  return JSON.parse(value)
}

// ===========================================================================
// Pure derivations the roster page renders
// ===========================================================================

export type PostureLabel = 'Managed' | 'Co-Managed' | 'Self-Managed'

export interface PosturePill {
  label: PostureLabel
  classes: string
}

const POSTURE_BADGE_STRUCTURE =
  'inline-flex items-center px-2 py-0.5 rounded-[var(--ss-radius-badge)] ' +
  'text-[10px] font-medium uppercase tracking-wide whitespace-nowrap'

/**
 * Derive the posture chip from the resolved authority posture (foundations
 * §4.1): the label is a description of the *switch pattern*, not a SKU —
 * Managed (every client switch off), Self-Managed (every switch client),
 * Co-Managed (a mix). SMD always retains full control regardless; this chip
 * describes only the client org's operability.
 */
export function derivePostureLabel(posture: AuthorityPosture | null): PostureLabel {
  const holders = Object.values(resolveAllDomains(posture))
  const clientCount = holders.filter((h) => h === 'client').length
  if (clientCount === 0) return 'Managed'
  if (clientCount === holders.length) return 'Self-Managed'
  return 'Co-Managed'
}

export function posturePill(posture: AuthorityPosture | null): PosturePill {
  const label = derivePostureLabel(posture)
  const tone =
    label === 'Managed'
      ? 'bg-[color:var(--ss-color-primary)] text-white'
      : label === 'Self-Managed'
        ? 'bg-[color:var(--ss-color-complete)] text-white'
        : 'bg-[color:var(--ss-color-attention)] text-white'
  return { label, classes: `${POSTURE_BADGE_STRUCTURE} ${tone}` }
}

export type RosterHealthColor = 'green' | 'yellow' | 'red' | 'gray'

export interface RosterHealth {
  color: RosterHealthColor
  /** Relative liveness label from the heartbeat ("47s ago" / "stale 12m"). */
  label: string
  /** Secondary line when the summary mirror reports a non-green rollup. */
  note: string | null
}

// gray ("no signal") ranks ABOVE green: an unknown-liveness Machine must never
// read calmer than a live one. Ordering: green < gray < yellow < red.
const HEALTH_RANK: Record<RosterHealthColor, number> = { green: 0, gray: 1, yellow: 2, red: 3 }

/**
 * Combine the heartbeat liveness ("is the process alive", fleet_status) with
 * the runtime-summary rollup ("is the operator OK" — folds in sticky-stop,
 * escalation pressure, connector health per migration 0052) into one fleet
 * dot. The heartbeat is the source of truth for LIVENESS; the summary may only
 * ESCALATE it (operator reports a warning/problem), never paint a Machine green
 * or downgrade a live-green Machine to "unknown". So only a yellow/red summary
 * participates — a green or absent summary leaves the heartbeat verdict standing.
 *
 * Previously the summary's own gray/green could override the heartbeat because
 * gray was ranked below green: a Machine that had never sent a heartbeat (gray)
 * but carried a stale "green" summary painted GREEN — the column reading calmer
 * than reality, the one thing a fleet dot must never do. `summaryStatus` is null
 * when no Machine has pushed a summary yet.
 */
export function rosterHealth(
  heartbeatColor: RosterHealthColor,
  heartbeatLabel: string,
  summaryStatus: SummaryStatus | null,
  stickyStopLevel: string | null = null
): RosterHealth {
  // The cost breaker (ADR 0062, fleet_status.sticky_stop_level) escalates
  // like the summary: SOFT_STOP -> yellow, HARD_STOP -> red. It can never
  // calm a dot; a tripped breaker on a live-green Machine must show.
  const breakerEscalation: RosterHealthColor | null =
    stickyStopLevel === 'HARD_STOP' ? 'red' : stickyStopLevel === 'SOFT_STOP' ? 'yellow' : null
  const summaryEscalation: RosterHealthColor | null =
    summaryStatus === 'red' ? 'red' : summaryStatus === 'yellow' ? 'yellow' : null
  let color = heartbeatColor
  for (const escalation of [summaryEscalation, breakerEscalation]) {
    if (escalation && HEALTH_RANK[escalation] > HEALTH_RANK[color]) color = escalation
  }
  // The breaker note wins when both fire: a hard-stopped operator is the
  // more actionable fact (recovery is a Captain clear, not investigation).
  const note =
    stickyStopLevel === 'HARD_STOP'
      ? 'cost breaker hard stop'
      : stickyStopLevel === 'SOFT_STOP'
        ? 'cost breaker soft stop'
        : summaryStatus === 'red'
          ? 'operator reports a problem'
          : summaryStatus === 'yellow'
            ? 'operator reports a warning'
            : null
  return { color, label: heartbeatLabel, note }
}

export function rosterHealthDotClass(color: RosterHealthColor): string {
  switch (color) {
    case 'green':
      return 'bg-[color:var(--ss-color-complete)]'
    case 'yellow':
      return 'bg-[color:var(--ss-color-attention)]'
    case 'red':
      return 'bg-[color:var(--ss-color-error)]'
    case 'gray':
      return 'bg-[color:var(--ss-color-border)]'
  }
}

/** "3 personas" / "1 persona" / "no personas". Pure, for the roster cell. */
export function personaSummary(personas: RosterPersona[]): string {
  const active = personas.filter((p) => p.status === 'active')
  const count = personas.length
  if (count === 0) return 'no personas'
  const noun = count === 1 ? 'persona' : 'personas'
  const archived = count - active.length
  return archived > 0 ? `${count} ${noun} (${archived} archived)` : `${count} ${noun}`
}
