/**
 * spec_control_broken:<class>.<property> and spec_control_unprovable —
 * authored-spec control health (ss#2234, amends ADR 0083).
 *
 * The incident (ss#2228): pilot-smokeball declared
 * `output_classes.staff.voice_spec: expected`, the staff spec was never
 * installed, and every autonomous staff send refused for six days with a remedy
 * the model could not perform. The gate noticed each time and wrote an audit
 * row. Nobody reads audit rows. This is the half that reaches a person.
 *
 * The seat ships `spec_control` — a map of "<class>.<property>" →
 * `{declared, installed}` computed by comparing customer.yaml against the
 * root-owned spec manifest (overlay `shared/spec_control_check.py`) — on the
 * HEARTBEAT rather than at the send site, so a broken control is reported
 * whether or not the seat happens to be sending.
 *
 * Two conditions, because two faults with different owners:
 *
 *   spec_control_broken:<class>.<prop>  the firm declared a spec and none is
 *                                       installed. Theirs to author.
 *   spec_control_unprovable             the seat could not read its own config
 *                                       or manifest. Ours to fix, and it must
 *                                       never be reported as the firm's gap.
 *
 * Keyed per PROPERTY: a seat can have staff.voice installed and staff.format
 * missing, and installing one must not clear the alert on the other.
 */

import type { ConditionState, FleetStatusRow } from './index'

/**
 * customer_slug → `<class>.<prop>` keys with an OPEN spec_control_broken alert.
 *
 * Every other condition's source field goes NULL when it stops applying, which
 * the NULL-hold handles. A spec_control key is different: withdrawing the
 * declaration (`voice_spec: expected` → `none`) removes the key from the seat's
 * map entirely, so nothing would ever evaluate it again and the alert would sit
 * open forever. Feeding the open keys back in lets a withdrawal resolve, with a
 * detail line saying which repair it was.
 */
export async function getOpenSpecControlKeys(db: D1Database): Promise<Record<string, string[]>> {
  const result = await db
    .prepare(
      `SELECT customer_slug, condition
         FROM fleet_alert_state
        WHERE status = 'open' AND condition LIKE 'spec_control_broken:%'`
    )
    .all<{ customer_slug: string; condition: string }>()
  const out: Record<string, string[]> = {}
  for (const row of result.results ?? []) {
    const key = row.condition.slice('spec_control_broken:'.length)
    if (!key) continue
    ;(out[row.customer_slug] ??= []).push(key)
  }
  return out
}

export interface SpecControlEntry {
  declared: boolean
  installed: boolean
}

/** "<class>.<prop>" → {declared, installed}. Corrupt/malformed → null (hold). */
export function parseSpecControlMap(json: string | null): Record<string, SpecControlEntry> | null {
  if (json === null) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const out: Record<string, SpecControlEntry> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const entry = value as Record<string, unknown>
    // Both flags required, neither defaulted: `installed` is what opens and
    // closes the alert, so inferring it would be manufacturing the verdict.
    if (typeof entry.declared !== 'boolean' || typeof entry.installed !== 'boolean') continue
    out[key] = { declared: entry.declared, installed: entry.installed }
  }
  return out
}

/**
 * Conditions for one seat.
 *
 * `spec_control_unprovable` is tri-state on the seat's own check:
 *   ok === 0  → active (the seat says it cannot read config or manifest)
 *   ok === 1  → inactive (resolves)
 *   ok null   → push NOTHING (hold) — a seat that stopped reporting has not
 *               recovered, it has gone quiet.
 *
 * `spec_control_broken:<key>` is tri-state per key:
 *   declared && !installed → active
 *   installed              → inactive (resolves — a spec landed)
 *   key absent from a reported map → inactive (resolves — the DECLARATION was
 *     withdrawn, which is also a real repair: nothing is expected any more)
 *   map absent/corrupt, or the check itself is broken → push NOTHING (hold)
 *
 * The detail line states WHICH repair happened, because "spec installed" and
 * "declaration withdrawn" both clear the gap and an operator needs to know
 * which one they got. Resolving on a withdrawn declaration is deliberate: with
 * nothing declared there is no control to be broken. The alert tracks the gap,
 * not the ambition.
 */
export function specControlConditions(
  row: FleetStatusRow,
  knownKeys: readonly string[] = []
): ConditionState[] {
  const out: ConditionState[] = []

  if (row.spec_control_ok === 0) {
    out.push({
      customer_slug: row.customer_slug,
      condition: 'spec_control_unprovable',
      active: true,
      detail:
        'The seat cannot read its authored-spec manifest or its customer config, ' +
        'so it cannot report whether declared specs are installed. This is a seat ' +
        'fault, not a missing spec: check SMD_SPEC_DIR and the spec applier.',
    })
    // The map cannot be trusted while the check is broken — hold every
    // per-key condition rather than resolving them on absent data.
    return out
  }
  if (row.spec_control_ok === 1) {
    out.push({
      customer_slug: row.customer_slug,
      condition: 'spec_control_unprovable',
      active: false,
      detail: 'The seat can read its authored-spec manifest again.',
    })
  }

  const map = parseSpecControlMap(row.spec_control_json)
  if (map === null) return out

  // Evaluate every key the seat reports, plus any key we have an open alert
  // for — otherwise a withdrawn declaration would strand its alert open
  // forever, since the key simply stops appearing in the map.
  const keys = new Set<string>([...Object.keys(map), ...knownKeys])
  for (const key of keys) {
    const entry = map[key]
    if (entry === undefined) {
      out.push({
        customer_slug: row.customer_slug,
        condition: `spec_control_broken:${key}`,
        active: false,
        detail: `${key}: no longer declared — the seat expects no spec for it.`,
      })
      continue
    }
    const broken = entry.declared && !entry.installed
    out.push({
      customer_slug: row.customer_slug,
      condition: `spec_control_broken:${key}`,
      active: broken,
      detail: broken
        ? `${key}: the seat declares this spec and none is installed. Autonomous ` +
          'internal mail proceeds in the persona register; outbound routes to a ' +
          'draft. Author and install the spec, or set the declaration to none.'
        : `${key}: spec installed.`,
    })
  }
  return out
}
