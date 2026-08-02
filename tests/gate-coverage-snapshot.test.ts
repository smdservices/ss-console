/**
 * Gate-coverage snapshot: the console half of the additive-gate assertion.
 *
 * WHAT THIS PINS. Two fields in every seat's customer.yaml decide whether the
 * distillation gates have anything to act on: `voice_library` (is there a corpus
 * pointer at all) and `output_classes` (which classes declare that a voice or
 * format spec is EXPECTED). The overlay asserts, per seat, that turning a gate
 * on is ADDITIVE — that no seat silently loses a control when the gate repoints.
 * It can only assert that against a picture of what each seat declares, and the
 * picture has to come from somewhere. This file is where it comes from.
 *
 * WHY A CHECKED-IN SNAPSHOT AND NOT A LIVE READ. The overlay cannot read this
 * repo at test time, and a fixture it maintains by hand drifts the moment a seat
 * is edited here — silently, and in the direction that matters, because a seat
 * that GAINS `output_classes: {staff: {voice_spec: expected}}` is exactly the
 * change an additive-gate assertion must see. Regenerating from the real
 * customer.yaml files and failing on drift makes the two repos move together:
 * editing a gate-relevant field here fails this test until the snapshot is
 * regenerated, and regenerating changes the pinned hash, which fails the
 * overlay's test until its copy is updated too. Neither side can move alone.
 *
 * THE FIELD NAME IS A TRAP WORTH NAMING. `voice_library_nonempty` is a claim
 * about the customer.yaml BLOCK — the mapping exists and has at least one key.
 * It is NOT a claim that the seat has voice samples. ashton-price's own
 * customer.yaml says "voice_library below is empty until then" while carrying a
 * populated `voice_library:` block; the comment means the R2 vault is empty, and
 * the two senses of "empty" sit fourteen lines apart in the same file. This
 * snapshot records the config-plane fact only. Corpus emptiness is the
 * compilers' business at establishment time (spec_leak_check and voice_profile
 * both exit nonzero on an empty corpus), not a thing this repo can see.
 *
 * REGENERATE:
 *
 *   UPDATE_GATE_COVERAGE_SNAPSHOT=1 npx vitest run tests/gate-coverage-snapshot.test.ts
 *
 * @see operator/contracts/gate-coverage-snapshot.json (the artifact)
 * @see operator/contracts/output-classes.yaml (what the classes MEAN)
 * @see tests/customer-yaml-parity-contract.test.ts (the pinned-hash precedent)
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'

const CUSTOMERS_DIR = 'operator/customers'
const SNAPSHOT_PATH = 'operator/contracts/gate-coverage-snapshot.json'

/**
 * Canonical-content hash of the `seats` object (sorted keys, compact
 * separators) — independent of file formatting, so prettier cannot break it.
 *
 * MUST equal the constant the overlay's additive-gate test pins. Update in BOTH
 * repos when seat coverage changes; `vitest -u`-style regeneration deliberately
 * does NOT update this line, so the cross-repo half stays a human edit.
 */
const PINNED_SEATS_SHA256 = '00f77f4ea430ba38d6330a15c76b19e2dff1382ba9251bc8c85aa62838953325'

/** A seat's gate-relevant declaration, as the overlay consumes it. */
interface SeatCoverage {
  /**
   * The customer.yaml `voice_library` mapping exists and has ≥1 key. NOT a
   * statement about the R2 vault's contents — see the header.
   */
  readonly voice_library_nonempty: boolean
  /**
   * Declared output classes. `null` for a property the class does not declare,
   * never the string 'none': `none` is an authored choice that a spec is not
   * expected, and absence is a class nobody has decided about yet. The registry
   * is built so those cannot be confused (operator/contracts/output-classes.yaml).
   */
  readonly output_classes: Record<
    string,
    { readonly voice_spec: string | null; readonly format_spec: string | null }
  >
}

/**
 * Scaffold directories, excluded from the snapshot. They are provisioning
 * templates rather than seats: nothing boots from them, so an additive-gate
 * assertion over them would be asserting against a form, not a deployment.
 */
const isScaffold = (dirName: string): boolean => dirName.startsWith('_')

function seatDirs(): string[] {
  return readdirSync(resolve(CUSTOMERS_DIR), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

function readSeat(slug: string): SeatCoverage {
  const yamlPath = resolve(CUSTOMERS_DIR, slug, 'customer.yaml')
  const doc = parseYaml(readFileSync(yamlPath, 'utf8')) as Record<string, unknown>

  const lib = doc.voice_library
  const voice_library_nonempty =
    typeof lib === 'object' && lib !== null && !Array.isArray(lib) && Object.keys(lib).length > 0

  const declared = doc.output_classes
  const output_classes: SeatCoverage['output_classes'] = {}
  if (typeof declared === 'object' && declared !== null && !Array.isArray(declared)) {
    for (const className of Object.keys(declared).sort()) {
      const props = (declared as Record<string, unknown>)[className]
      const asRecord =
        typeof props === 'object' && props !== null && !Array.isArray(props)
          ? (props as Record<string, unknown>)
          : {}
      const asStringOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)
      output_classes[className] = {
        voice_spec: asStringOrNull(asRecord.voice_spec),
        format_spec: asStringOrNull(asRecord.format_spec),
      }
    }
  }

  return { voice_library_nonempty, output_classes }
}

/** Regenerate the whole `seats` object from the real customer.yaml files. */
function regenerateSeats(): Record<string, SeatCoverage> {
  const out: Record<string, SeatCoverage> = {}
  for (const slug of seatDirs()) {
    if (isScaffold(slug)) continue
    out[slug] = readSeat(slug)
  }
  return out
}

/** Stable, formatting-independent serialization: keys sorted recursively,
 *  compact separators. Matches Python's json.dumps(sort_keys, separators). */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  if (v !== null && typeof v === 'object') {
    const entries = Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k]))
    return '{' + entries.join(',') + '}'
  }
  return JSON.stringify(v)
}

const seatsSha256 = (seats: Record<string, SeatCoverage>): string =>
  createHash('sha256').update(stableStringify(seats), 'utf8').digest('hex')

const SNAPSHOT_NOTE =
  'Gate-relevant customer.yaml coverage, regenerated by tests/gate-coverage-snapshot.test.ts ' +
  'and consumed by the overlay additive-gate assertion. voice_library_nonempty describes the ' +
  'customer.yaml BLOCK, not the R2 vault contents. A null voice_spec/format_spec means the ' +
  'class does not declare that property; the string "none" means it declares that no spec is ' +
  'expected. Do not hand-edit: regenerate with UPDATE_GATE_COVERAGE_SNAPSHOT=1.'

function renderSnapshot(seats: Record<string, SeatCoverage>): string {
  return JSON.stringify({ note: SNAPSHOT_NOTE, seats }, null, 2) + '\n'
}

const LIVE_SEATS = regenerateSeats()

describe('gate-coverage snapshot', () => {
  it('excludes scaffold directories, and there are some to exclude', () => {
    // Asserted separately, and in both directions, because an exclusion rule
    // that filters nothing is indistinguishable from no rule at all. If
    // `_template` were ever renamed, the filter would go quietly inert and this
    // test is what notices.
    const all = seatDirs()
    const scaffolds = all.filter(isScaffold)
    expect(
      scaffolds,
      'the underscore-prefixed provisioning scaffolds must still exist, or the exclusion this ' +
        'snapshot depends on is filtering nothing'
    ).not.toEqual([])
    expect(
      scaffolds.filter((s) => s in LIVE_SEATS),
      'a scaffold reached the snapshot; it is a provisioning form, not a deployed seat'
    ).toEqual([])
    expect(
      all.filter((d) => !isScaffold(d) && !(d in LIVE_SEATS)),
      'every non-scaffold customer dir must appear in the snapshot'
    ).toEqual([])
  })

  it('reads a customer.yaml from every seat it lists', () => {
    // Guards the silent-empty case: a glob that matches nothing produces an
    // empty snapshot that agrees with an empty checked-in file forever.
    expect(Object.keys(LIVE_SEATS).length).toBeGreaterThan(0)
    for (const slug of Object.keys(LIVE_SEATS)) {
      expect(
        existsSync(resolve(CUSTOMERS_DIR, slug, 'customer.yaml')),
        `${slug} customer.yaml`
      ).toBe(true)
    }
  })

  it('matches the checked-in snapshot', () => {
    const rendered = renderSnapshot(LIVE_SEATS)
    const snapshotFile = resolve(SNAPSHOT_PATH)

    if (process.env.UPDATE_GATE_COVERAGE_SNAPSHOT === '1') {
      writeFileSync(snapshotFile, rendered, 'utf8')
      console.warn(
        `[gate-coverage] rewrote ${SNAPSHOT_PATH}. Seats hash is now ${seatsSha256(LIVE_SEATS)} — ` +
          'update PINNED_SEATS_SHA256 here AND the overlay constant.'
      )
      return
    }

    expect(existsSync(snapshotFile), `${SNAPSHOT_PATH} is missing`).toBe(true)
    expect(
      readFileSync(snapshotFile, 'utf8'),
      `${SNAPSHOT_PATH} is stale. A gate-relevant customer.yaml field changed. Regenerate with ` +
        '`UPDATE_GATE_COVERAGE_SNAPSHOT=1 npx vitest run tests/gate-coverage-snapshot.test.ts`, ' +
        'then update PINNED_SEATS_SHA256 below AND the matching constant in the overlay, so the ' +
        'additive-gate assertion is re-decided rather than silently re-based.'
    ).toBe(rendered)
  })

  it('pins the seats hash the overlay mirrors', () => {
    // The cross-repo half. Regeneration deliberately does not touch this
    // constant: a snapshot change that nobody carried to the overlay should
    // fail here, in this repo, with the new value printed.
    expect(
      seatsSha256(LIVE_SEATS),
      'Seat coverage changed. Update this constant AND the overlay additive-gate test, together.'
    ).toBe(PINNED_SEATS_SHA256)
  })
})
