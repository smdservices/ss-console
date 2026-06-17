/**
 * GET /api/admin/fleet/health
 *
 * Fleet-health snapshot for the SMD dogfood Operator (customer-zero). Returns
 * one entry per provisioned Machine, composed from the two console-side mirrors
 * that each Machine pushes to:
 *
 *   - `fleet_status`              — heartbeat liveness (ADR 0023)
 *   - `operator_runtime_summary`  — operational health rollup (ADR 0043 path B)
 *
 * The SMD Operator's `health_monitor` skill polls this on a cron cadence and
 * emails Captain when any entry is in a degraded state. The admin portal fleet
 * view reads the same underlying tables — this endpoint is the machine-callable
 * surface over that data, not a new data pipeline.
 *
 * Auth: dedicated bearer secret (`OPERATOR_HEALTH_READ_KEY`) held only by
 * customer-zero. NOT the shared machine heartbeat key. Verified with
 * constant-time compare; no DB lookup required (fleet-wide read, not per-tenant).
 *
 * Isolation (ADR 0009): the query reads per-customer summary rows from both
 * tables but never joins across two Machines' runtime D1. Each row was pushed
 * by exactly one Machine.
 *
 * Response shape:
 *   {
 *     "generated_at": "<ISO 8601 UTC>",
 *     "entries": [
 *       {
 *         "slug":              "<customer_slug>",
 *         "heartbeat_status":  "green"|"yellow"|"red"|"unknown",
 *         "last_heartbeat_ts": "<ISO 8601 UTC>" | null,
 *         "last_audit_ts":     "<ISO 8601 UTC>" | null,
 *         "summary_status":    "green"|"yellow"|"red"|"unknown" | null,
 *         "open_alerts":       <integer> | null,
 *         "last_activity_ts":  "<ISO 8601 UTC>" | null,
 *         "pushed_at":         "<ISO 8601 UTC>" | null
 *       },
 *       ...
 *     ]
 *   }
 *
 * `summary_status` and related fields are null when no runtime summary has been
 * pushed yet (Machine alive but summary push not yet implemented or not yet run).
 * Slugs with no fleet_status row are omitted — this endpoint describes
 * provisioned Machines, not the full customer list.
 */

import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { verifyHealthReadKey } from '../../../../lib/auth/health-read-key'

export interface HealthEntry {
  slug: string
  heartbeat_status: 'green' | 'yellow' | 'red' | 'unknown'
  last_heartbeat_ts: string | null
  last_audit_ts: string | null
  summary_status: 'green' | 'yellow' | 'red' | 'unknown' | null
  open_alerts: number | null
  last_activity_ts: string | null
  pushed_at: string | null
}

interface HealthRow {
  customer_slug: string
  heartbeat_status: string
  last_heartbeat_ts: string | null
  last_audit_ts: string | null
  summary_status: string | null
  open_alerts: number | null
  last_activity_ts: string | null
  pushed_at: string | null
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const VALID_STATUSES = new Set(['green', 'yellow', 'red', 'unknown'])

function parseHeartbeatStatus(s: string): 'green' | 'yellow' | 'red' | 'unknown' {
  return VALID_STATUSES.has(s) ? (s as 'green' | 'yellow' | 'red' | 'unknown') : 'unknown'
}

function parseSummaryStatus(s: string | null): 'green' | 'yellow' | 'red' | 'unknown' | null {
  if (s === null) return null
  return VALID_STATUSES.has(s) ? (s as 'green' | 'yellow' | 'red' | 'unknown') : 'unknown'
}

export const GET: APIRoute = async ({ request }) => {
  if (!verifyHealthReadKey(request, env.OPERATOR_HEALTH_READ_KEY)) {
    return json({ error: 'unauthorized' }, 401)
  }

  const rows = await env.DB.prepare(
    `SELECT
       fs.customer_slug,
       fs.heartbeat_status,
       fs.last_heartbeat_ts,
       fs.last_audit_ts,
       ors.summary_status,
       ors.open_alerts,
       ors.last_activity_ts,
       ors.pushed_at
     FROM fleet_status fs
     LEFT JOIN operator_runtime_summary ors
       ON fs.customer_slug = ors.customer_slug
     ORDER BY fs.customer_slug ASC`
  ).all<HealthRow>()

  const entries: HealthEntry[] = (rows.results ?? []).map((r) => ({
    slug: r.customer_slug,
    heartbeat_status: parseHeartbeatStatus(r.heartbeat_status),
    last_heartbeat_ts: r.last_heartbeat_ts,
    last_audit_ts: r.last_audit_ts,
    summary_status: parseSummaryStatus(r.summary_status),
    open_alerts: r.open_alerts,
    last_activity_ts: r.last_activity_ts,
    pushed_at: r.pushed_at,
  }))

  return json({ generated_at: new Date().toISOString(), entries }, 200)
}
