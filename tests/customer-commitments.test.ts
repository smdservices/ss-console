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
})
