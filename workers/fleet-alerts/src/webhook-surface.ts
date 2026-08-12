/**
 * webhook_surface_missing:<tool> and webhook_surface_unprovable — the ss#2222
 * warn tier, finally given somewhere to land (ss#2287).
 *
 * The defect (ss#2287): the seat has emitted `webhook_surface_ok` +
 * `webhook_surface` on every heartbeat since ss#2222 and the console had no
 * reader. The overlay's own docstring says the empty map "is what RESOLVES an
 * open alert" — there was no alert to resolve. This module is the half that
 * reaches a person.
 *
 * What the seat reports. `shared/webhook_read_surface.WEBHOOK_EXPECTED_TOOLS`
 * (today: `operator_seat_facts`) names tools a webhook turn must be OFFERED but
 * whose absence degrades one class of answer rather than the seat — so boot
 * continues and the report has to arrive on something that runs whether or not
 * the seat is busy. That is the heartbeat. The agent process resolves the
 * surface once at startup and writes a pid-stamped sentinel; the gate reads it
 * back behind a pid-liveness guard and ships `tool → {expected, offered}`.
 *
 * Two conditions, because two faults with different owners — spec-control's
 * split, for spec-control's reason:
 *
 *   webhook_surface_missing:<tool>  a tool the webhook surface must offer is
 *                                   not offered. That class of answer is
 *                                   silently degraded on the client's channel.
 *   webhook_surface_unprovable      the seat could not resolve its own webhook
 *                                   toolset. Ours to fix, and it must never be
 *                                   reported as a missing tool.
 *
 * Keyed per TOOL: the expected tuple can grow, and one tool returning must not
 * clear the alert on another still absent.
 */

import { WEBHOOK_SURFACE_MISSING_PREFIX, conditionPayload } from './conditions'
import type { ConditionState, FleetStatusRow } from './index'

/**
 * customer_slug → tool names with an OPEN webhook_surface_missing alert.
 *
 * The spec-control feedback pattern, and needed for the same reason: a tool can
 * leave WEBHOOK_EXPECTED_TOOLS (an overlay bump that stops expecting it), at
 * which point the key vanishes from the seat's map entirely and nothing would
 * ever evaluate it again — the alert would sit open forever. Feeding the open
 * keys back lets that resolve, with a detail line saying which repair it was.
 * The `connector_down:` condition deliberately does NOT do this, because a
 * connector's key never disappears; an expectation's does.
 */
export async function getOpenWebhookSurfaceKeys(db: D1Database): Promise<Record<string, string[]>> {
  const result = await db
    .prepare(
      `SELECT customer_slug, condition
         FROM fleet_alert_state
        WHERE status = 'open' AND condition LIKE ? || '%'`
    )
    .bind(WEBHOOK_SURFACE_MISSING_PREFIX)
    .all<{ customer_slug: string; condition: string }>()
  const out: Record<string, string[]> = {}
  for (const row of result.results ?? []) {
    const tool = conditionPayload(row.condition, WEBHOOK_SURFACE_MISSING_PREFIX)
    if (!tool) continue
    ;(out[row.customer_slug] ??= []).push(tool)
  }
  return out
}

export interface WebhookSurfaceEntry {
  expected: boolean
  offered: boolean
}

/** tool → {expected, offered}. Corrupt/malformed → null (whole-map hold). */
export function parseWebhookSurfaceMap(
  json: string | null
): Record<string, WebhookSurfaceEntry> | null {
  if (json === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const out: Record<string, WebhookSurfaceEntry> = {}
  for (const [tool, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const entry = value as Record<string, unknown>
    // Both flags required, neither defaulted: `offered` is what opens and closes
    // the alert, so inferring it would be manufacturing the verdict.
    if (typeof entry.expected !== 'boolean' || typeof entry.offered !== 'boolean') continue
    out[tool] = { expected: entry.expected, offered: entry.offered }
  }
  return out
}

/**
 * Conditions for one seat.
 *
 * `webhook_surface_unprovable` is tri-state on the seat's own check:
 *   ok === 0  → active (the seat says it cannot resolve its webhook toolset)
 *   ok === 1  → inactive (resolves)
 *   ok null   → push NOTHING (hold). NULL covers a seat that does not serve the
 *               webhook platform at all, a sentinel written by a dead pid, and a
 *               pre-ss#2222 overlay — none of which is a recovery.
 *
 * `webhook_surface_missing:<tool>` is tri-state per tool:
 *   expected && !offered → active
 *   offered              → inactive (resolves — the tool is back on the surface)
 *   tool absent from a reported map → inactive (resolves — it is no longer
 *     EXPECTED, which is also a real repair: nothing is missing any more)
 *   map absent/corrupt, or the check itself is broken → push NOTHING (hold)
 *
 * An entry with `expected: false` is inactive rather than skipped: the seat is
 * affirmatively saying nothing is expected of that tool, which is the same
 * repair as its key vanishing and should close an open alert the same way.
 */
export function webhookSurfaceConditions(
  row: FleetStatusRow,
  knownTools: readonly string[] = []
): ConditionState[] {
  const out: ConditionState[] = []

  if (row.webhook_surface_ok === 0) {
    out.push({
      customer_slug: row.customer_slug,
      condition: 'webhook_surface_unprovable',
      active: true,
      detail:
        'The seat cannot resolve its webhook tool surface, so it cannot report ' +
        'whether the expected warn-tier tools are offered. This is a seat fault, ' +
        'not a missing tool: check the gateway startup sentinel at ' +
        '$HERMES_HOME/.smd/webhook_surface.json and the activation gate that writes it.',
    })
    // The map cannot be trusted while the check is broken — hold every per-tool
    // condition rather than resolving them on data the seat just disowned.
    return out
  }
  if (row.webhook_surface_ok === 1) {
    out.push({
      customer_slug: row.customer_slug,
      condition: 'webhook_surface_unprovable',
      active: false,
      detail: 'The seat can resolve its webhook tool surface again.',
    })
  }

  const map = parseWebhookSurfaceMap(row.webhook_surface_json)
  if (map === null) return out

  // Every tool the seat reports, plus any tool we have an open alert for —
  // otherwise a withdrawn expectation strands its alert open forever, since the
  // key simply stops appearing in the map.
  const tools = new Set<string>([...Object.keys(map), ...knownTools])
  for (const tool of tools) {
    const entry = map[tool]
    if (entry === undefined) {
      out.push({
        customer_slug: row.customer_slug,
        condition: `${WEBHOOK_SURFACE_MISSING_PREFIX}${tool}`,
        active: false,
        detail: `${tool}: no longer expected on the webhook surface.`,
      })
      continue
    }
    const missing = entry.expected && !entry.offered
    out.push({
      customer_slug: row.customer_slug,
      condition: `${WEBHOOK_SURFACE_MISSING_PREFIX}${tool}`,
      active: missing,
      detail: missing
        ? `${tool}: expected on every webhook turn and not offered. Answers that ` +
          'need it are silently degraded on the client channel — the seat still ' +
          'serves, and improvises instead. Check the toolset resolution for the ' +
          "webhook platform and the tool's registration."
        : entry.expected
          ? `${tool}: offered on the webhook surface.`
          : `${tool}: no longer expected on the webhook surface.`,
    })
  }
  return out
}
