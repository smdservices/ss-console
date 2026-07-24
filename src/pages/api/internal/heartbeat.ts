/**
 * POST /api/internal/heartbeat
 *
 * Per-customer Operator Machine → control-plane heartbeat ingestion
 * (ADR 0023 Wave 1). The overlay-side ticker in the Machine POSTs every
 * ~60s; this handler upserts the row in `fleet_status` and replies with
 * 200 + the resolved heartbeat status so the Machine can log it.
 *
 * Auth: shared Bearer key + X-Tenant-Slug header (see
 * `src/lib/auth/machine-key.ts`). Wave 1 uses a single shared key; the
 * per-tenant upgrade path is documented in ADR 0023 §"Cross-cutting
 * calls" #10 and lands at customer #2 onboarding.
 *
 * Body (JSON):
 *   {
 *     "heartbeat_ts":            <ISO 8601 UTC>,   // required
 *     "last_audit_ts":           <ISO 8601 UTC>,   // optional
 *     "last_skill_ts":           <ISO 8601 UTC>,   // optional
 *     "process_uptime_seconds":  <integer>,        // optional
 *     "version":                 <string>,         // optional
 *     "sticky_stop_level":       <string>          // optional (ADR 0062)
 *   }
 *
 * The handler doesn't trust the Machine's `heartbeat_status` — it derives
 * it from the freshness math the admin dashboard uses (green/yellow/red
 * thresholds based on customer.yaml.observability.health.period_seconds
 * and grace_minutes, defaults 60 and 5). Wave 1 hardcodes the same
 * thresholds the dashboard uses to avoid reading customer.yaml on every
 * heartbeat; the dashboard re-derives the color at render time anyway,
 * so any discrepancy is corrected on the next page load. The
 * healthchecks.io webhook handler additionally writes
 * `heartbeat_status='red'` on grace expiration so the alert path is the
 * authoritative red signal.
 */

import { jsonResponse } from '../../../lib/api/helpers'
import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { verifyMachineRequest } from '../../../lib/auth/machine-key'

const DEFAULT_PERIOD_SECONDS = 60
const DEFAULT_GRACE_MINUTES = 5

interface HeartbeatBody {
  heartbeat_ts: string
  last_audit_ts?: string
  last_skill_ts?: string
  process_uptime_seconds?: number
  version?: string
  sticky_stop_level?: string
}

// The breaker ladder vocabulary (overlay shared/cost_breaker.read_level).
// Anything else is stored as NULL — never guess a level from junk input.
const STICKY_STOP_LEVELS = new Set(['OK', 'WARN', 'SOFT_STOP', 'HARD_STOP', 'unknown'])

export const POST: APIRoute = async ({ request }) => {
  const auth = await verifyMachineRequest(request, env.MACHINE_HEARTBEAT_KEY, env.DB)
  if (!auth.ok) {
    return jsonResponse(401, { error: 'unauthorized' })
  }

  let body: HeartbeatBody
  try {
    body = await request.json<HeartbeatBody>()
  } catch {
    return jsonResponse(400, { error: 'invalid_json' })
  }

  if (typeof body.heartbeat_ts !== 'string' || body.heartbeat_ts.length === 0) {
    return jsonResponse(400, { error: 'missing_heartbeat_ts' })
  }

  const heartbeatStatus = deriveStatus(
    body.heartbeat_ts,
    DEFAULT_PERIOD_SECONDS,
    DEFAULT_GRACE_MINUTES
  )

  // sticky_stop_level overwrites every beat, INCLUDING back to NULL when the
  // Machine stops reporting one — a stale pinned level must not outlive the
  // signal that produced it (absence renders as unknown, never as OK).
  const stickyStopLevel =
    typeof body.sticky_stop_level === 'string' && STICKY_STOP_LEVELS.has(body.sticky_stop_level)
      ? body.sticky_stop_level
      : null

  await env.DB.prepare(
    `INSERT INTO fleet_status (
       entity_id, customer_slug, last_heartbeat_ts, last_audit_ts, last_skill_ts,
       process_uptime_seconds, version, heartbeat_status, sticky_stop_level, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(entity_id) DO UPDATE SET
       last_heartbeat_ts       = excluded.last_heartbeat_ts,
       last_audit_ts           = COALESCE(excluded.last_audit_ts, fleet_status.last_audit_ts),
       last_skill_ts           = COALESCE(excluded.last_skill_ts, fleet_status.last_skill_ts),
       process_uptime_seconds  = COALESCE(excluded.process_uptime_seconds, fleet_status.process_uptime_seconds),
       version                 = COALESCE(excluded.version, fleet_status.version),
       heartbeat_status        = excluded.heartbeat_status,
       sticky_stop_level       = excluded.sticky_stop_level,
       updated_at              = datetime('now')`
  )
    .bind(
      auth.entityId,
      auth.slug,
      body.heartbeat_ts,
      body.last_audit_ts ?? null,
      body.last_skill_ts ?? null,
      typeof body.process_uptime_seconds === 'number' ? body.process_uptime_seconds : null,
      typeof body.version === 'string' ? body.version : null,
      heartbeatStatus,
      stickyStopLevel
    )
    .run()

  return jsonResponse(200, { ok: true, heartbeat_status: heartbeatStatus })
}

function deriveStatus(
  heartbeatIso: string,
  periodSec: number,
  graceMin: number
): 'green' | 'yellow' | 'red' | 'unknown' {
  const ts = Date.parse(heartbeatIso)
  if (Number.isNaN(ts)) return 'unknown'
  const ageSec = Math.floor((Date.now() - ts) / 1000)
  if (ageSec < 2 * periodSec) return 'green'
  if (ageSec < graceMin * 60) return 'yellow'
  return 'red'
}
