/**
 * Portal kill switch — pause/resume transport + governance audit (#2003,
 * A&P diligence reply Q6/Q7).
 *
 * The pause is a control-plane action: the portal API authenticates the
 * client admin (RBAC + the runtime authority switch), this module proxies
 * the stop to the Machine's gate (POST /sticky-stop/set, overlay#188 —
 * Bearer HMAC-SHA256(OPERATOR_MCP_WEBHOOK_SECRET, slug), the same
 * console-proxy key as /mcp/turn), and records the governance row in
 * `operator_pause_events`. Resume rides the existing clear transport
 * (`src/lib/admin/sticky-stop-clear.ts`) — the state machine's only
 * backward transition — and records through the same table so pause and
 * resume land in one client-readable record.
 *
 * Why the audit lives here, not on the Machine: the audit-ledger broker
 * PID-gates appends to the gateway process (OP-P1-4), so neither the gate
 * nor the console can write the Machine ledger. The pause/resume is a
 * governance action audited control-plane-side where the actor was
 * authenticated; the portal audit viewer unions this table into its feed.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { deriveRuntimeReadKey } from '../../operator/runtime-read-transport'
import { resolveCustomerFlyApp } from '../../operator/fly-app-registry'
import {
  clearStopOnMachine,
  type GateClearResult,
  type StickyStopClearEnv,
} from '../../admin/sticky-stop-clear'

export type PauseAction = 'pause' | 'resume'

export interface PinnedRow {
  customer: string
  persona: string
  prior_level: string
}

export interface GateSetResult {
  pinned: PinnedRow[]
  level: string
}

function machineBaseUrl(template: string, app: string): string {
  return template.includes('{app}') ? template.replace('{app}', app) : `https://${app}.fly.dev`
}

/** True when the pause transport can reach a Machine (secret + URL present). */
export function isPauseConfigured(env: StickyStopClearEnv): boolean {
  return (
    typeof env.OPERATOR_MCP_WEBHOOK_SECRET === 'string' &&
    env.OPERATOR_MCP_WEBHOOK_SECRET.length > 0 &&
    typeof env.OPERATOR_RUNTIME_READ_URL === 'string' &&
    env.OPERATOR_RUNTIME_READ_URL.length > 0
  )
}

/**
 * Proxy the pause to the customer's Machine gate. Throws on any failure so
 * the caller records nothing and surfaces an honest error — a pause the
 * Machine did not acknowledge must never be reported as "paused".
 */
export async function setStopOnMachine(
  env: StickyStopClearEnv,
  customerSlug: string,
  body: { actor_id: string; reason: string }
): Promise<GateSetResult> {
  if (!isPauseConfigured(env)) {
    throw new Error('pause transport not configured (OPERATOR_MCP_WEBHOOK_SECRET / URL unset)')
  }
  const app = resolveCustomerFlyApp(customerSlug)
  if (!app) throw new Error(`pause: unknown customer ${customerSlug}`)

  const bearer = await deriveRuntimeReadKey(env.OPERATOR_MCP_WEBHOOK_SECRET!, customerSlug)
  const url = `${machineBaseUrl(env.OPERATOR_RUNTIME_READ_URL!, app)}/sticky-stop/set`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`gate set failed: ${resp.status} ${detail.slice(0, 200)}`)
  }
  const data: Partial<GateSetResult> = await resp.json()
  return {
    pinned: Array.isArray(data.pinned) ? data.pinned : [],
    level: data.level ?? 'unknown',
  }
}

/** Resume = the existing clear transport; re-exported so the pause route has one import surface. */
export async function resumeOnMachine(
  env: StickyStopClearEnv,
  customerSlug: string,
  body: { captain_id: string; reason: string }
): Promise<GateClearResult> {
  return clearStopOnMachine(env, customerSlug, body)
}

export interface RecordPauseEventInput {
  entity_id: string
  customer_slug: string
  action: PauseAction
  actor_user_id: string
  actor_email: string
  actor_role: string
  source: 'portal' | 'admin'
  reason: string
  gate_level: string
}

/** Record the governance row. Every pause and resume is logged with who/when (Q6). */
export async function recordPauseEvent(
  db: D1Database,
  input: RecordPauseEventInput
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO operator_pause_events ' +
        '(id, entity_id, customer_slug, action, actor_user_id, actor_email, actor_role, ' +
        'source, reason, gate_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      crypto.randomUUID(),
      input.entity_id,
      input.customer_slug,
      input.action,
      input.actor_user_id,
      input.actor_email,
      input.actor_role,
      input.source,
      input.reason,
      input.gate_level
    )
    .run()
}

export interface PauseEventRow {
  id: string
  action: PauseAction
  actor_email: string
  actor_role: string
  source: string
  reason: string
  gate_level: string
  created_at: string
}

/**
 * Current pause posture for the settings card: true when the Machine-reported
 * sticky-stop level is HARD_STOP. Display mirror only (enforcement is the
 * Machine-side ladder); a missing row/table reads as not-paused so a stale
 * mirror can never hide the switch.
 */
export async function readPausePosture(db: D1Database, customerSlug: string): Promise<boolean> {
  try {
    const row = await db
      .prepare('SELECT sticky_stop_level FROM fleet_status WHERE customer_slug = ?')
      .bind(customerSlug)
      .first<{ sticky_stop_level: string | null }>()
    return row?.sticky_stop_level === 'HARD_STOP'
  } catch {
    return false
  }
}

/** Read the pause/resume history for one customer, newest first (audit union feed). */
export async function listPauseEvents(
  db: D1Database,
  customerSlug: string,
  limit = 50
): Promise<PauseEventRow[]> {
  const res = await db
    .prepare(
      'SELECT id, action, actor_email, actor_role, source, reason, gate_level, created_at ' +
        'FROM operator_pause_events WHERE customer_slug = ? ORDER BY created_at DESC LIMIT ?'
    )
    .bind(customerSlug, limit)
    .all<PauseEventRow>()
  return res.results ?? []
}
