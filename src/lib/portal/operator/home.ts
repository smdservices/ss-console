/**
 * Home / Today runtime feeds (client-portal §5.1). The Home surface answers
 * "what's happening" with four elements: aliveness (resolved separately via
 * the fleet-status heartbeat store), recent activity, what-needs-you, and
 * escalations. The latter three are fed here.
 *
 * Data sources (issue #1678 wired this; the prior revision returned hardcoded
 * empty feeds):
 *
 *   - Recent activity + escalations: ONE live runtime read (ADR 0043 path A,
 *     kind `audit_log`) against the customer's own Machine — the same frozen
 *     seam the Activity page uses. Escalations are the `ESCALATION_FIRED`
 *     rows in that page: a record of what the operator flagged to a human,
 *     never an invented queue. Fails closed to empty on any transport
 *     failure; when the read path is not configured we short-circuit BEFORE
 *     calling the seam so an unwired deployment does not write an
 *     `unreachable` read-audit row on every dashboard view (same posture as
 *     activity-read.ts).
 *
 *   - `needsAttentionCount`: the Machine-pushed `draft_queue_depth` in this
 *     customer's own `operator_runtime_summary` row (ADR 0043 path B mirror).
 *     The Home must never fabricate a review queue the entitlements did not
 *     author (ADR 0035 / client-portal §5.1): the count renders only when the
 *     Machine itself reported a pending-review depth. No row, NULL depth, or
 *     an unreadable mirror all resolve to 0 — an honest absence, not a zeroed
 *     queue implying one exists.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { readMachineRuntime, type RuntimeReadActor } from '../../operator/runtime-read'
import {
  createMachineRuntimeTransport,
  createRuntimeReadAudit,
  isRuntimeReadConfigured,
  type RuntimeReadEnv,
} from '../../operator/runtime-read-transport'
import { parseAuditEntries } from './activity-read'
import type { AuditEntry } from './audit'
import { toClientActivity } from './activity-language'

export interface HomeActivityItem {
  id: string
  summary: string
  at: string
}

export interface HomeEscalationItem {
  id: string
  summary: string
  at: string
}

export interface HomeFeeds {
  /** Whether the live runtime read path is wired. When false, every feed is empty. */
  runtimeConfigured: boolean
  /** Recent completed actions, plain-language. */
  recentActivity: HomeActivityItem[]
  /** Count of items routed to a human for THIS client. 0 unless the Machine reported a depth. */
  needsAttentionCount: number
  /** Items the operator flagged to a human (`ESCALATION_FIRED` audit records). */
  escalations: HomeEscalationItem[]
}

export interface HomeFeedsDeps {
  db: D1Database
  env: RuntimeReadEnv
  /** Console-side actor id for the read-audit row (distinct from the operator's log). */
  actorUserId: string
}

/** How many audit rows one dashboard read requests. The frozen ADR 0043
 * seam has no action filter, so curated-language filtering happens
 * console-side (activity-language allowlist); the window is wide enough
 * that a chatty agent's suppressed telemetry cannot starve the six-line
 * client feed. The Machine clamps oversized limits. */
const HOME_READ_LIMIT = 200
/** How many recent-activity lines the dashboard shows. */
const RECENT_ACTIVITY_MAX = 6
/** How many escalation lines the dashboard shows. */
const ESCALATIONS_MAX = 5

const EMPTY_UNCONFIGURED: HomeFeeds = {
  runtimeConfigured: false,
  recentActivity: [],
  needsAttentionCount: 0,
  escalations: [],
}

/**
 * Assemble the Home/Today feeds for the signed-in client's own operator.
 * One customer per call (ADR 0009/0043); fails closed to empty feeds on any
 * failure — never throws into the page render.
 */
export async function loadHomeFeeds(
  deps: HomeFeedsDeps,
  customerSlug: string,
  actor: RuntimeReadActor
): Promise<HomeFeeds> {
  if (!isRuntimeReadConfigured(deps.env)) {
    return EMPTY_UNCONFIGURED
  }

  const [entries, needsAttentionCount] = await Promise.all([
    readRecentAuditEntries(deps, customerSlug, actor),
    readDraftQueueDepth(deps.db, customerSlug),
  ])

  return {
    runtimeConfigured: true,
    // Curated client language only (Captain decision 7): filter through the
    // allowlist FIRST, then take the six most recent mapped lines.
    recentActivity: toClientActivity(entries)
      .slice(0, RECENT_ACTIVITY_MAX)
      .map((line) => ({ id: line.id, summary: line.summary, at: line.at })),
    needsAttentionCount,
    escalations: entries
      .filter((e) => e.action === 'ESCALATION_FIRED')
      .slice(0, ESCALATIONS_MAX)
      .map(toEscalationItem),
  }
}

/** One page of this customer's audit log via the frozen ADR 0043 seam,
 * newest first. Fail-closed empty on transport failure. */
async function readRecentAuditEntries(
  deps: HomeFeedsDeps,
  customerSlug: string,
  actor: RuntimeReadActor
): Promise<AuditEntry[]> {
  const result = await readMachineRuntime(
    {
      transport: createMachineRuntimeTransport(deps.env),
      audit: createRuntimeReadAudit(deps.db, { actorUserId: deps.actorUserId }),
    },
    customerSlug,
    { kind: 'audit_log', limit: HOME_READ_LIMIT },
    actor
  )
  const rows = result.ok ? parseAuditEntries(result.data) : []
  // The Machine serves newest-first, but the dashboard's ordering promise is
  // its own: sort defensively so a cursor/ordering drift never scrambles the
  // "recent" list.
  return rows.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
}

/**
 * This customer's Machine-pushed pending-review depth from the path-B summary
 * mirror. Reads exactly one row for exactly this customer — never a fleet-wide
 * read (that is the admin view's job; ADR 0052 keeps this surface scoped to
 * the client's own operator). Missing row / NULL depth / read failure → 0.
 */
export async function readDraftQueueDepth(db: D1Database, customerSlug: string): Promise<number> {
  try {
    const row = await db
      .prepare('SELECT draft_queue_depth FROM operator_runtime_summary WHERE customer_slug = ?')
      .bind(customerSlug)
      .first<{ draft_queue_depth: number | null }>()
    const depth = row?.draft_queue_depth
    return typeof depth === 'number' && Number.isFinite(depth) && depth > 0 ? Math.floor(depth) : 0
  } catch {
    // A missing mirror table (fresh environment) is an honest 0, not a crash.
    return 0
  }
}

function toEscalationItem(entry: AuditEntry): HomeEscalationItem {
  // Prefer the writer's recorded reason (what was escalated and why); fall
  // back to the action label — never fabricate a friendlier story.
  return {
    id: entry.id,
    summary: entry.reason ?? 'Flagged something for your attention',
    at: entry.ts,
  }
}
