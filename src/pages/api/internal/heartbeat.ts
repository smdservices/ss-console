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
 *     "sticky_stop_level":       <string>,         // optional (ADR 0062)
 *     "scheduler_ok":            <boolean | 0/1>,  // optional (WP-2 work-liveness)
 *     "scheduler_job_count":     <integer>,        // optional
 *     "scheduler_max_overdue_seconds": <integer>,  // optional
 *     "connector_check_ok":      <boolean | 0/1>,  // optional (ADR 0080)
 *     "connectors":              <map server → entry> // optional (ADR 0080)
 *     "cron_containment":        <boolean | 0/1>,  // optional (ss#2276 sentinel)
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
  scheduler_ok?: unknown
  scheduler_job_count?: unknown
  scheduler_max_overdue_seconds?: unknown
  connector_check_ok?: unknown
  connectors?: unknown
  connector_token_age?: unknown
  spec_control_ok?: unknown
  spec_control?: unknown
  cron_containment?: unknown
}

// The breaker ladder vocabulary (overlay shared/cost_breaker.read_level).
// Anything else is stored as NULL — never guess a level from junk input.
const STICKY_STOP_LEVELS = new Set(['OK', 'WARN', 'SOFT_STOP', 'HARD_STOP', 'unknown'])

// Coerce the overlay's scheduler_ok signal to 1/0/NULL. Accepts a boolean or a
// literal 0/1 (JSON booleans and small-int flags are both idiomatic in the
// emitter). Anything else — including a truthy non-1 number — is junk and
// stored NULL: never manufacture a health verdict from an unrecognized value.
function parseSchedulerOk(value: unknown): 0 | 1 | null {
  if (value === true || value === 1) return 1
  if (value === false || value === 0) return 0
  return null
}

// Non-negative integer counters (job count, max-overdue seconds). Junk — a
// float, a negative, a string, a missing field — is stored NULL.
function parseNonNegInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

// Per-connector map guardrails (ADR 0080). The overlay writer caps at 32
// servers and 200-char messages; these ingest-side caps are the backstop
// against a compromised or drifted emitter, not the primary limit.
const CONNECTORS_MAX_SERVERS = 64
const CONNECTORS_MAX_MESSAGE_CHARS = 200
const CONNECTOR_SERVER_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/

// One connector entry, parsed-not-cast (ADR 0080 three-tier rule): a valid
// entry's meaning doesn't depend on its neighbors, so an invalid ENTRY is
// dropped (absence = the alerter holds for that server) while valid siblings
// are kept. Fields inside a kept entry are never individually nulled — a
// half-trusted entry could open or resolve an alert wrongly; entries are
// atomic. consecutive_failures is the one required field; a failure run
// (count > 0) additionally requires its writer-side run_age_seconds, because
// every open condition is age-gated and an ageless run can satisfy none.
function parseConnectorEntry(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const count = parseNonNegInt(raw.consecutive_failures)
  if (count === null) return null
  const entry: Record<string, unknown> = { consecutive_failures: count }
  if (count > 0) {
    const runAge = parseNonNegInt(raw.run_age_seconds)
    if (runAge === null) return null
    entry.run_age_seconds = runAge
    entry.conn_evidence = raw.conn_evidence === true
  }
  const lastOkAge = parseNonNegInt(raw.last_ok_age_seconds)
  if (lastOkAge !== null) entry.last_ok_age_seconds = lastOkAge
  const lastErrorAge = parseNonNegInt(raw.last_error_age_seconds)
  if (lastErrorAge !== null) entry.last_error_age_seconds = lastErrorAge
  if (typeof raw.last_error_message === 'string' && raw.last_error_message.length > 0) {
    entry.last_error_message = raw.last_error_message.slice(0, CONNECTORS_MAX_MESSAGE_CHARS)
  }
  return entry
}

// The whole map: structurally-invalid (not a plain object, or absurdly large)
// → NULL, meaning "trust nothing this beat"; under NULL-hold semantics every
// open connector alert simply holds, which makes whole-map NULL cheap and
// honest. Returns the serialized JSON to store, or null.
function parseConnectorsJson(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > CONNECTORS_MAX_SERVERS) return null
  const parsed: Record<string, unknown> = {}
  for (const [server, raw] of entries) {
    if (!CONNECTOR_SERVER_NAME_RE.test(server)) continue
    const entry = parseConnectorEntry(raw)
    if (entry !== null) parsed[server] = entry
  }
  return JSON.stringify(parsed)
}

// server → token-file age seconds (ss#2148). A SEPARATE map from connectors:
// token age must never synthesize a health entry. Structurally-invalid → NULL
// ("trust nothing this beat" — the token-expiry condition holds on NULL).
function parseConnectorTokenAgeJson(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > CONNECTORS_MAX_SERVERS) return null
  const parsed: Record<string, number> = {}
  for (const [server, raw] of entries) {
    if (!CONNECTOR_SERVER_NAME_RE.test(server)) continue
    const age = parseNonNegInt(raw)
    if (age !== null) parsed[server] = age
  }
  return JSON.stringify(parsed)
}

// Authored-spec control map (ss#2234): "<output_class>.<property>" →
// { declared, installed }. Keyed per PROPERTY because a seat can have
// staff.voice installed and staff.format missing, and resolving one must not
// clear the alert on the other.
const SPEC_CONTROL_MAX_KEYS = 64
const SPEC_CONTROL_KEY_RE = /^[a-z_]{1,40}\.(voice|format)$/

// Same three-tier rule as the connector map. Both flags are REQUIRED in a kept
// entry and neither is defaulted: `installed` is what opens and closes the
// alert, so inferring it from a missing field would be manufacturing the
// verdict. An entry that cannot supply both is dropped (that key holds);
// a structurally-invalid MAP → NULL (nothing this beat is trusted, every open
// alert holds).
function parseSpecControlJson(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > SPEC_CONTROL_MAX_KEYS) return null
  const parsed: Record<string, { declared: boolean; installed: boolean }> = {}
  for (const [key, raw] of entries) {
    if (!SPEC_CONTROL_KEY_RE.test(key)) continue
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
    const entry = raw as Record<string, unknown>
    if (typeof entry.declared !== 'boolean' || typeof entry.installed !== 'boolean') continue
    parsed[key] = { declared: entry.declared, installed: entry.installed }
  }
  return JSON.stringify(parsed)
}

/**
 * Every alert-driving field, parsed-not-cast.
 *
 * All of these share ONE contract that the surrounding upsert depends on: they
 * overwrite every beat INCLUDING back to NULL. A stale pinned verdict must not
 * outlive the signal that produced it — `COALESCE` here would keep a
 * `scheduler_ok=0` (or a broken-control map) forever after an overlay rollback
 * dropped the field. Grouped into one function so that contract is stated once
 * and a new field cannot quietly acquire different semantics.
 *
 * The three `*_ok` booleans share `parseSchedulerOk`'s 1/0/NULL coercion, and 0
 * always means the SEAT's own check is broken — the alerter pages that
 * separately (`connector_check_error`, `spec_control_unprovable`) rather than
 * letting the whole class go dark or, worse, reporting our blindness as the
 * customer's missing config.
 */
function parseObservability(body: HeartbeatBody) {
  return {
    schedulerOk: parseSchedulerOk(body.scheduler_ok),
    schedulerJobCount: parseNonNegInt(body.scheduler_job_count),
    schedulerMaxOverdueSeconds: parseNonNegInt(body.scheduler_max_overdue_seconds),
    connectorCheckOk: parseSchedulerOk(body.connector_check_ok),
    connectorsJson: parseConnectorsJson(body.connectors),
    connectorTokenAgeJson: parseConnectorTokenAgeJson(body.connector_token_age),
    specControlOk: parseSchedulerOk(body.spec_control_ok),
    specControlJson: parseSpecControlJson(body.spec_control),
    // ss#2276: 1 = the CRON_CONTAINMENT volume sentinel is present (all managed
    // crons deliberately off, surviving boots), 0 = normal, NULL = unreported.
    cronContainment: parseSchedulerOk(body.cron_containment),
  }
}

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

  const {
    schedulerOk,
    schedulerJobCount,
    schedulerMaxOverdueSeconds,
    connectorCheckOk,
    connectorsJson,
    connectorTokenAgeJson,
    specControlOk,
    specControlJson,
    cronContainment,
  } = parseObservability(body)

  await upsertFleetStatus({
    entityId: auth.entityId,
    slug: auth.slug,
    body,
    heartbeatStatus,
    stickyStopLevel,
    schedulerOk,
    schedulerJobCount,
    schedulerMaxOverdueSeconds,
    connectorsJson,
    connectorCheckOk,
    connectorTokenAgeJson,
    specControlJson,
    specControlOk,
    cronContainment,
  })

  return jsonResponse(200, { ok: true, heartbeat_status: heartbeatStatus })
}

interface FleetStatusUpsert {
  entityId: string
  slug: string
  body: HeartbeatBody
  heartbeatStatus: string
  stickyStopLevel: string | null
  schedulerOk: 0 | 1 | null
  schedulerJobCount: number | null
  schedulerMaxOverdueSeconds: number | null
  connectorsJson: string | null
  connectorCheckOk: 0 | 1 | null
  connectorTokenAgeJson: string | null
  specControlJson: string | null
  specControlOk: 0 | 1 | null
  cronContainment: 0 | 1 | null
}

/**
 * The upsert, and the two update disciplines it deliberately mixes.
 *
 * `COALESCE` for the four fields where a beat that omits one has nothing to say
 * (timestamps, uptime, version). Plain overwrite — INCLUDING back to NULL — for
 * everything an alert reads, because a stale pinned verdict must never outlive
 * the signal that produced it.
 */
async function upsertFleetStatus(u: FleetStatusUpsert): Promise<void> {
  // Re-keyed on customer_slug (migration 0093): several seats share one entity,
  // so ON CONFLICT(entity_id) would collide them into one row. entity_id is now
  // a plain column and is refreshed from the request on every upsert.
  await env.DB.prepare(
    `INSERT INTO fleet_status (
       entity_id, customer_slug, last_heartbeat_ts, last_audit_ts, last_skill_ts,
       process_uptime_seconds, version, heartbeat_status, sticky_stop_level,
       scheduler_ok, scheduler_job_count, scheduler_max_overdue_seconds,
       connectors_json, connector_check_ok, connector_token_age_json,
       spec_control_json, spec_control_ok, cron_containment, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(customer_slug) DO UPDATE SET
       entity_id               = excluded.entity_id,
       last_heartbeat_ts       = excluded.last_heartbeat_ts,
       last_audit_ts           = COALESCE(excluded.last_audit_ts, fleet_status.last_audit_ts),
       last_skill_ts           = COALESCE(excluded.last_skill_ts, fleet_status.last_skill_ts),
       process_uptime_seconds  = COALESCE(excluded.process_uptime_seconds, fleet_status.process_uptime_seconds),
       version                 = COALESCE(excluded.version, fleet_status.version),
       heartbeat_status        = excluded.heartbeat_status,
       sticky_stop_level       = excluded.sticky_stop_level,
       scheduler_ok                  = excluded.scheduler_ok,
       scheduler_job_count           = excluded.scheduler_job_count,
       scheduler_max_overdue_seconds = excluded.scheduler_max_overdue_seconds,
       connectors_json         = excluded.connectors_json,
       connector_check_ok      = excluded.connector_check_ok,
       connector_token_age_json = excluded.connector_token_age_json,
       spec_control_json       = excluded.spec_control_json,
       spec_control_ok         = excluded.spec_control_ok,
       cron_containment        = excluded.cron_containment,
       updated_at              = datetime('now')`
  )
    .bind(
      u.entityId,
      u.slug,
      u.body.heartbeat_ts,
      u.body.last_audit_ts ?? null,
      u.body.last_skill_ts ?? null,
      typeof u.body.process_uptime_seconds === 'number' ? u.body.process_uptime_seconds : null,
      typeof u.body.version === 'string' ? u.body.version : null,
      u.heartbeatStatus,
      u.stickyStopLevel,
      u.schedulerOk,
      u.schedulerJobCount,
      u.schedulerMaxOverdueSeconds,
      u.connectorsJson,
      u.connectorCheckOk,
      u.connectorTokenAgeJson,
      u.specControlJson,
      u.specControlOk,
      u.cronContainment
    )
    .run()
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
