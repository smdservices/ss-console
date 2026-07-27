/**
 * Commitments contract gate for the pilot-smokeball seat (ADR 0075).
 *
 * The Ashton & Price 2026-07-09 letter makes per-routine autonomy commitments
 * (the routine-settings grid) and names permanent caps (deadline / money /
 * opposing counsel / court). Those commitments are authored across three
 * artifacts on this seat:
 *
 *   - operator/customers/pilot-smokeball/customer.yaml   (the live config)
 *   - operator/customers/pilot-smokeball/routine-grid.yaml (the traceability grid)
 *   - operator/customers/pilot-smokeball/commitments.json  (the pinned contract)
 *
 * This suite parses the LIVE customer.yaml + routine-grid.yaml and asserts the
 * five commitment invariants below. It is deliberately hermetic (no network):
 * everything it checks is a file in this repo.
 *
 * The tool-to-action-class map that pins payments_* / trust-ledger / create_matter
 * as COMMITMENT-class lives OVERLAY-side (shared/action_classes.py), outside this
 * repo, so there is no ss-side BANNED_TOOLS list. Test (e) asserts the ss-reachable
 * enforcement floor instead: trust_ceiling.enforce() never lets a COMMITMENT action
 * fire without explicit current-turn approval.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'
import { parse as parseYaml } from 'yaml'
import { validate, type CustomerYaml } from '../src/lib/operator/customer-yaml'
import { validateRoutineGrid, type RoutineGridRow } from '../src/lib/operator/routine-grid'
import { isCeiling, restrictiveness } from '../src/lib/portal/operator/config-governance'

const SEAT_YAML_PATH = resolve('operator/customers/pilot-smokeball/customer.yaml')
const GRID_YAML_PATH = resolve('operator/customers/pilot-smokeball/routine-grid.yaml')
const COMMITMENTS_PATH = resolve('operator/customers/pilot-smokeball/commitments.json')
const TRUST_CEILING_PY = resolve('operator/adapter/trust_ceiling.py')
const AP_DIR = resolve('operator/customers/ashton-price')

const TIER_VOCAB = ['flag-only', 'prepare-and-route', 'auto-handle'] as const

/** Parse + validate the LIVE customer.yaml, throwing if it no longer validates. */
function seatValue(): CustomerYaml {
  const raw = parseYaml(readFileSync(SEAT_YAML_PATH, 'utf-8')) as Record<string, unknown>
  const result = validate(raw)
  if (!result.ok) {
    throw new Error(`customer.yaml no longer validates:\n${JSON.stringify(result.errors, null, 2)}`)
  }
  return result.value
}

/**
 * Parse + validate the LIVE routine-grid.yaml through the canonical parser
 * (src/lib/operator/routine-grid.ts), throwing if it no longer validates. The
 * parser owns the tier vocabulary + field shape; this suite asserts the
 * grid<->config drift invariants on top of the parsed rows.
 */
function gridRows(): RoutineGridRow[] {
  const raw = parseYaml(readFileSync(GRID_YAML_PATH, 'utf-8'))
  const result = validateRoutineGrid(raw)
  if (!result.ok) {
    throw new Error(
      `routine-grid.yaml no longer validates:\n${JSON.stringify(result.errors, null, 2)}`
    )
  }
  return result.value.rows
}

function commitments(): {
  invariants: {
    outbound_roster_classes_allowed: string[]
    tier_vocabulary: string[]
  }
  outbound_roster: Array<{ address: string; class: string }>
} {
  return JSON.parse(readFileSync(COMMITMENTS_PATH, 'utf-8'))
}

/** Recursively list every file under `dir`. */
function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkFiles(full))
    else out.push(full)
  }
  return out
}

describe('pilot-smokeball commitments contract (ADR 0075)', () => {
  it('the live customer.yaml still validates', () => {
    expect(() => seatValue()).not.toThrow()
  })

  it('the routine grid carries all 19 letter rows', () => {
    expect(gridRows()).toHaveLength(19)
  })

  // (a) The opposing-counsel / court permanent cap: no persona may EVER author
  // external_send: autonomous. draft_for_review is the seat's authored value.
  it('(a) external_send is never autonomous for any persona', () => {
    const seat = seatValue()
    for (const persona of seat.personas) {
      expect(
        persona.entitlements.exposure['external_send'],
        `persona ${persona.slug} must not author external_send: autonomous`
      ).not.toBe('autonomous')
    }
  })

  // (b) Every outbound_roster entry is a client / records_vendor, and the live
  // roster EXACTLY equals the pinned commitments.json roster (any roster change
  // forces a same-PR commitments bump = reviewed diff).
  it('(b) outbound_roster classes are {client, records_vendor} and match the pinned contract', () => {
    const seat = seatValue()
    const pinned = commitments()
    const allowed = new Set(pinned.invariants.outbound_roster_classes_allowed)

    for (const entry of seat.scope.outbound_roster) {
      expect(allowed.has(entry.class), `roster class "${entry.class}" not allowed`).toBe(true)
    }

    const norm = (list: Array<{ address: string; class: string }>) =>
      list.map((e) => `${e.address} ${e.class}`).sort()
    expect(norm(seat.scope.outbound_roster)).toEqual(norm(pinned.outbound_roster))
  })

  // (c) Grid <-> config traceability: every grid row's tier vocabulary is closed to
  // {flag-only, prepare-and-route, auto-handle}, its exposure-key values equal the
  // live customer.yaml values, and its skills reference real seat skills.
  it('(c) every grid row traces to the live config (tiers, exposure keys, skills)', () => {
    const seat = seatValue()
    const exposure = seat.personas.find((p) => p.slug === 'operator')?.entitlements.exposure
    expect(exposure, 'persona operator must exist').toBeTruthy()
    const seatSkills = new Set(seat.personas.flatMap((p) => p.skills.map((s) => s.name)))

    for (const row of gridRows()) {
      expect(TIER_VOCAB, `${row.routine} start_tier`).toContain(row.start_tier)
      expect(TIER_VOCAB, `${row.routine} ceiling_tier`).toContain(row.ceiling_tier)

      for (const [key, value] of Object.entries(row.enforcement.exposure_keys)) {
        expect(
          exposure![key as keyof typeof exposure],
          `${row.routine}: exposure_keys.${key} must match live customer.yaml`
        ).toBe(value)
      }

      for (const skill of row.skills) {
        expect(seatSkills.has(skill), `${row.routine}: skill "${skill}" not on the seat`).toBe(true)
      }
    }
  })

  // (d) Placeholder go-live gate: PLACEHOLDER markers are permitted on the
  // pilot-smokeball staging seat but must NEVER inherit to the real client seat.
  it('(d) no PLACEHOLDER marker exists anywhere under operator/customers/ashton-price/', () => {
    const offenders = walkFiles(AP_DIR).filter((f) =>
      readFileSync(f, 'utf-8').includes('PLACEHOLDER')
    )
    expect(
      offenders,
      `PLACEHOLDER markers found under ashton-price (Christa's real numbers are a go-live gate):\n${offenders.join('\n')}`
    ).toEqual([])
  })

  // (e) Banned-tools sanity. There is no ss-side tool->class map (it lives overlay-
  // side in shared/action_classes.py), so we assert the ss-reachable enforcement
  // FLOOR: trust_ceiling.enforce() never lets a COMMITMENT action (which the overlay
  // classifies payments_* / trust-ledger / create_matter into) fire without an
  // explicit current-turn approval, and no persona authors commitment: autonomous.
  it('(e) COMMITMENT (fund movement) is never autonomous in the reachable enforcement floor', () => {
    const src = readFileSync(TRUST_CEILING_PY, 'utf-8')
    expect(src).toContain('COMMITMENT = "commitment"')
    expect(src).toContain('# COMMITMENT never autonomous')
    expect(src).toContain('commitment action requires explicit current-turn approval')

    const seat = seatValue()
    for (const persona of seat.personas) {
      expect(
        persona.entitlements.exposure['commitment'],
        `persona ${persona.slug} must not author commitment: autonomous`
      ).not.toBe('autonomous')
    }
  })

  // (f) Christa's confirmed settings (correspondence 09, 2026-07-23; #2005).
  // The diligence reply (10) states these as set — the ashton-price seat must
  // author exactly these values, and chase_cadence_days must stay UNAUTHORED
  // (the letter commits a cadence "you set per matter": a firm input at the
  // working session; authoring a guessed value here would be fabrication).
  it('(f) ashton-price authors the two confirmed settings and no invented cadence', () => {
    const raw = parseYaml(readFileSync(join(AP_DIR, 'customer.yaml'), 'utf-8')) as Record<
      string,
      unknown
    >
    const result = validate(raw)
    if (!result.ok) {
      throw new Error(
        `ashton-price customer.yaml no longer validates:\n${JSON.stringify(result.errors, null, 2)}`
      )
    }
    const skills = result.value.personas.flatMap((p) => p.skills)
    const byName = (name: string) => skills.find((s) => s.name === name)

    expect(
      byName('client-verification-tracker')?.settings?.['escalate_after_attempts'],
      'client-verification-tracker must author escalate_after_attempts: 3 (correspondence 09)'
    ).toBe(3)
    expect(
      byName('client-verification-tracker')?.settings?.['chase_cadence_days'],
      'chase_cadence_days must stay unauthored until the firm sets it (per-matter, letter 07)'
    ).toBeUndefined()
    expect(
      byName('medical-chronology-maintainer')?.settings?.['treatment_gap_flag_days'],
      'medical-chronology-maintainer must author treatment_gap_flag_days: 45 (correspondence 09)'
    ).toBe(45)
  })

  // (h) A&P GRID TRACEABILITY. The (c) gate above checks the pilot seat
  // against the pilot grid; the CLIENT seat's own grid was checked by
  // nothing, and the gap it hid was real: ashton-price authored neither
  // external_send_client nor external_send_vendor, the two keys its grid
  // says enforce the letter's prepare-and-route tiers for client
  // verification (the firm's #1 named routine) and records chase.
  // resolve_ceiling does NO recipient-class fallback — unauthored is
  // REFUSED (ADR 0056), so those routines would have refused instead of
  // drafting. This gate makes the client seat's grid binding.
  it('(h) every ashton-price grid row traces to the ashton-price seat config', () => {
    const raw = parseYaml(readFileSync(join(AP_DIR, 'customer.yaml'), 'utf-8')) as Record<
      string,
      unknown
    >
    const seat = validate(raw)
    if (!seat.ok) {
      throw new Error(
        `ashton-price customer.yaml no longer validates:\n${JSON.stringify(seat.errors, null, 2)}`
      )
    }
    const gridResult = validateRoutineGrid(
      parseYaml(readFileSync(join(AP_DIR, 'routine-grid.yaml'), 'utf-8'))
    )
    if (!gridResult.ok) {
      throw new Error(
        `ashton-price routine-grid.yaml no longer validates:\n${JSON.stringify(gridResult.errors, null, 2)}`
      )
    }
    const exposure = seat.value.personas.find((p) => p.slug === gridResult.value.persona)
      ?.entitlements.exposure
    expect(exposure, `persona ${gridResult.value.persona} must exist on the seat`).toBeTruthy()
    const seatSkills = new Set(seat.value.personas.flatMap((p) => p.skills.map((s) => s.name)))

    // Direction matters. A grid-claimed key the seat does not author is a
    // DEFECT (unauthored = REFUSED, so the routine cannot do what the letter
    // says). A seat value MORE restrictive than the grid claims is the
    // client's own posture and is allowed — running tighter than committed is
    // always the firm's right (ADR 0035). Only absence, or a value LESS
    // restrictive than the grid claims, fails.
    for (const row of gridResult.value.rows) {
      for (const [key, claimed] of Object.entries(row.enforcement.exposure_keys)) {
        const authored = exposure![key as keyof typeof exposure] as string | undefined
        expect(
          authored,
          `${row.routine}: grid says ${key}=${claimed} enforces this row, but the seat authors no ${key} (unauthored = REFUSED, ADR 0056 — the routine would refuse instead of acting)`
        ).toBeTruthy()
        if (!authored || !isCeiling(authored) || !isCeiling(claimed)) continue
        expect(
          restrictiveness(authored) >= restrictiveness(claimed),
          `${row.routine}: seat authors ${key}=${authored}, LESS restrictive than the grid's ${claimed} — the seat exceeds what the letter committed`
        ).toBe(true)
      }
      for (const skill of row.skills) {
        expect(seatSkills.has(skill), `${row.routine}: skill "${skill}" not on the seat`).toBe(true)
      }
    }
  })

  // (g) Per-matter alert routing (#2004, correspondence 09): case-level alerts
  // route to the matter's assigned attorney/paralegal — never a central inbox
  // on the firm's side. The seat must author matter_staff routing, must NOT
  // author a fallback (who receives an unassigned matter's alert is the firm's
  // working-session call; until then resolution failure holds fail-closed),
  // and must author external_send_internal so the routed delivery is not
  // refused at the gate.
  it('(g) ashton-price authors matter_staff routing, no invented fallback, and internal-send delivery', () => {
    const raw = parseYaml(readFileSync(join(AP_DIR, 'customer.yaml'), 'utf-8')) as Record<
      string,
      unknown
    >
    const result = validate(raw)
    if (!result.ok) {
      throw new Error(
        `ashton-price customer.yaml no longer validates:\n${JSON.stringify(result.errors, null, 2)}`
      )
    }
    const routing = result.value.escalation.case_alert_routing
    expect(routing?.mode, 'case_alert_routing.mode must be matter_staff (correspondence 09)').toBe(
      'matter_staff'
    )
    expect(
      routing?.fallback_recipients,
      'fallback_recipients must stay unauthored until the firm names one (working-session input)'
    ).toEqual([])

    const operator = result.value.personas.find((p) => p.slug === 'operator')
    expect(
      operator?.entitlements.exposure['external_send_internal'],
      'external_send_internal must be authored autonomous — a routed alert that waits for SMD approval is not an alert'
    ).toBe('autonomous')
  })
})
