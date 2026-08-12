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
