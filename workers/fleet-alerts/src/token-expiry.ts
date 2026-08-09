/**
 * connector_token_expiring:<server> — pre-expiry warning for durable
 * credentials with a recorded lifetime (ss#2148, ADR 0080 amendment
 * 2026-08-09).
 *
 * The seat ships connector_token_age (the durable token file's mtime age,
 * overlay connector_check.token_ages()) as a heartbeat field SEPARATE from
 * the connector-health map — synthesizing a consecutive_failures=0 entry for
 * an idle connector would falsely RESOLVE an open connector_down alert. In
 * normal operation the daily auth-probe keepalive rotates the file and this
 * condition never fires; it fires when the probe infrastructure itself has
 * been dead for ~(lifetime - warn) days — the watcher's watcher.
 */

import type { ConditionState, FleetStatusRow } from './index'

function nonNegInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** server → token-file age seconds. Corrupt/malformed → null (hold). */
export function parseTokenAgeMap(json: string | null): Record<string, number> | null {
  if (json === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const out: Record<string, number> = {}
  for (const [server, value] of Object.entries(raw as Record<string, unknown>)) {
    const age = nonNegInt(value)
    if (age !== null) out[server] = age
  }
  return out
}

/**
 * Tri-state per server:
 *   age reported, >= (lifetime - warn) → active (dies in <= warn days unless
 *     rotated/re-consented).
 *   age reported, below threshold      → inactive (resolves — rotation or a
 *     fresh consent reset the file's mtime; a real recovery signal).
 *   age absent (no field, no file, corrupt map) → push NOTHING (hold): a seat
 *     that stops reporting must not read as recovered.
 * Servers with no recorded lifetime are never evaluated — a guessed lifetime
 * would manufacture pages.
 */
export function tokenExpiryConditions(
  row: FleetStatusRow,
  lifetimesDays: Record<string, number>,
  warnDays: number
): ConditionState[] {
  const ages = parseTokenAgeMap(row.connector_token_age_json)
  if (ages === null) return []
  const out: ConditionState[] = []
  for (const [server, lifetimeDays] of Object.entries(lifetimesDays)) {
    const age = ages[server]
    if (age === undefined) continue
    const thresholdSeconds = Math.max(0, lifetimeDays - warnDays) * 86400
    const ageDays = Math.floor(age / 86400)
    out.push({
      customer_slug: row.customer_slug,
      condition: `connector_token_expiring:${server}`,
      active: age >= thresholdSeconds,
      detail:
        `${server} durable credential is ${ageDays}d old ` +
        `(recorded lifetime ${lifetimeDays}d, warning at ${lifetimeDays - warnDays}d). ` +
        'Rotate or re-consent before it expires; auto-resolves when the token file is rewritten.',
    })
  }
  return out
}
