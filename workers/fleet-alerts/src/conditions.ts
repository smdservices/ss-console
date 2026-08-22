/**
 * The prefixed condition classes, in one place (ss#2316).
 *
 * Four conditions carry a payload after a colon: the MCP server, the credential's
 * server, the authored spec key, the expected webhook tool. Before this module the
 * prefixes were repeated string literals across five files, and `stale-holds.ts`
 * additionally sliced them in SQL by hardcoded character offsets (16 and 26) that
 * duplicated the literals' LENGTH. That coupling was invisible: renaming a prefix
 * updated every TypeScript site (they all slice by `.length`) while the SQL kept
 * cutting at the old column, handing `json_extract` a garbage path that returns
 * NULL — which is exactly this query's "stranded" signal, so every alert of that
 * class would report stranded forever and nothing would fail.
 *
 * The rule this module exists to enforce: a prefix's length is never written down.
 * TypeScript slices with `.length`; SQL receives the prefix as a bound parameter
 * and derives the offset with `length(?) + 1`. There is no third place to update.
 */

import type { FleetCondition } from './index'

/** Per-MCP-server outage (ADR 0080 / ss#1990). Payload: the server name. */
export const CONNECTOR_DOWN_PREFIX = 'connector_down:'

/** Pre-expiry credential warning (ss#2148). Payload: the server name. */
export const CONNECTOR_TOKEN_EXPIRING_PREFIX = 'connector_token_expiring:'

/** Authored spec declared but not installed (ss#2234). Payload: `<class>.<prop>`. */
export const SPEC_CONTROL_BROKEN_PREFIX = 'spec_control_broken:'

/** Expected webhook tool not offered (ss#2287). Payload: the tool name. */
export const WEBHOOK_SURFACE_MISSING_PREFIX = 'webhook_surface_missing:'

/**
 * Every prefixed class. Used by the stale-holds SQL builder and by the guard test
 * that asserts no caller has reintroduced a hardcoded offset.
 */
export const CONDITION_PREFIXES = [
  CONNECTOR_DOWN_PREFIX,
  CONNECTOR_TOKEN_EXPIRING_PREFIX,
  SPEC_CONTROL_BROKEN_PREFIX,
  WEBHOOK_SURFACE_MISSING_PREFIX,
] as const

/**
 * The payload after a prefix, or null when the condition is not of that class.
 * Single accessor so no call site writes an offset of its own.
 */
export function conditionPayload(condition: string, prefix: string): string | null {
  return condition.startsWith(prefix) ? condition.slice(prefix.length) : null
}

/**
 * Human labels for the unprefixed conditions; the prefixed classes are labelled
 * in conditionLabel() from their payload. Moved here from index.ts when that
 * file crossed the 500-line ceiling (ss#2488 part 2) -- the labels depend on
 * the prefix constants above, so this is where they belong anyway.
 */
const CONDITION_LABEL: Record<string, string> = {
  heartbeat_red: 'Machine not heartbeating',
  hard_stop: 'Cost breaker HARD_STOP',
  scheduler_error: 'Cron scheduler broken/unreadable',
  work_overdue: 'Scheduled work not firing',
  connector_check_error: 'Connector health check broken (outages not counted)',
  spec_control_unprovable: 'Authored-spec manifest unreadable (spec health unknown)',
  webhook_surface_unprovable: 'Webhook tool surface unresolvable (warn-tier health unknown)',
  gateway_loop_wedged: 'Gateway event loop wedged (Operator not answering)',
  gateway_loop_unprovable: 'Gateway loop heartbeat unreadable (loop health unknown)',
  gateway_restarted: 'Seat supervisor restarted the gateway',
  gateway_supervisor_refusing: 'Seat supervisor STOPPED restarting (budget spent, needs a human)',
  gateway_supervisor_inert: 'Seat supervisor cannot act (wedge would not self-recover)',
  send_refused:
    "a routine's outbound send was refused by a gate, or a wake with needs-you items sent nothing",
}

/** Label lookup with the per-connector prefix form (ADR 0080). */
export function conditionLabel(condition: FleetCondition): string {
  const down = conditionPayload(condition, CONNECTOR_DOWN_PREFIX)
  if (down !== null) return `Connector failing: ${down}`
  const expiring = conditionPayload(condition, CONNECTOR_TOKEN_EXPIRING_PREFIX)
  if (expiring !== null) return `Connector credential expiring: ${expiring}`
  const spec = conditionPayload(condition, SPEC_CONTROL_BROKEN_PREFIX)
  if (spec !== null) return `Authored spec declared but not installed: ${spec}`
  const tool = conditionPayload(condition, WEBHOOK_SURFACE_MISSING_PREFIX)
  if (tool !== null) return `Webhook tool expected but not offered: ${tool}`
  return CONDITION_LABEL[condition] ?? condition
}
