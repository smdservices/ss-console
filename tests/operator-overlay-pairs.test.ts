/**
 * Adapter ↔ overlay paired-file drift gate (2026-06-12 code review;
 * runtime-side coverage added 2026-06-16, SEC-32).
 *
 * Four modules exist as deliberate ported pairs: the ss-console copy
 * (`operator/adapter/*`) is the control-plane substrate consumed by
 * `operator/bin` lifecycle tooling, and the hermes-smd-overlay copy
 * (`plugins/*`, `shared/*`) is the runtime that ships on customer Machines.
 * Nothing previously enforced that an edit to one side was made with the
 * other in mind — the pairs were already diverging (SentItem vs
 * SentMessage, executor contracts) with no signal.
 *
 * The manifest (`operator/contracts/overlay-pairs.json`) pins, per pair:
 *   - `sha256`        : the ss-console-side file's hash, checked HERE (offline).
 *   - `overlaySha256` : the overlay runtime file's hash at `overlayRef`,
 *                       checked by the `operator-substrate` CI workflow,
 *                       which fetches the overlay at that ref and hashes the
 *                       runtime copies. See `.github/workflows/operator-substrate.yml`.
 *
 * WHY two halves. This vitest suite runs in the offline `verify` workflow and
 * must stay hermetic (no network), so it cannot itself fetch the overlay repo.
 * The original gate concluded "the overlay repo is not present in this CI" and
 * therefore checked ONLY the dormant adapter side — which meant a neutered
 * RUNTIME file (e.g. a no-op audit emitter) shipped green, since the adapter
 * file was untouched and its hash still matched. SEC-32 closes that hole: the
 * overlay IS publicly fetchable at the pinned `overlayRef`, so the cross-repo
 * content check now runs in `operator-substrate` (where network is available),
 * while THIS suite verifies the manifest is well-formed and pins the overlay
 * at the same commit the Dockerfile actually ships.
 *
 * Editing either side without updating its manifest hash fails CI. Updating a
 * hash is the conscious act: record in `syncNote` whether the change needs a
 * paired PR on the other side (and reference it) or is deliberately one-sided.
 */

import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

interface PairEntry {
  adapterPath: string
  overlayPath: string
  sha256: string
  overlaySha256: string
  syncNote: string
}

interface Manifest {
  overlayRepo: string
  overlayRef: string
  overlayRefNote: string
  pairs: PairEntry[]
}

const MANIFEST_PATH = resolve('operator/contracts/overlay-pairs.json')
const DOCKERFILE_PATH = resolve('operator/templates/Dockerfile')

function loadManifest(): Manifest {
  const raw: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('overlay-pairs.json must be an object { overlayRepo, overlayRef, pairs[] }')
  }
  const m = raw as Manifest
  if (!Array.isArray(m.pairs)) throw new Error('overlay-pairs.json: `pairs` must be an array')
  return m
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** The 40-hex SHA pinned in the Dockerfile's `ARG OVERLAY_REF`. */
function dockerfileOverlayRef(): string {
  const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf-8')
  const m = dockerfile.match(/ARG\s+OVERLAY_REF=["']?([^"'\s]+)["']?/)
  if (!m) throw new Error('Dockerfile: ARG OVERLAY_REF not found')
  return m[1]
}

describe('adapter ↔ overlay paired-file drift gate', () => {
  const manifest = loadManifest()

  it('manifest is well-formed (repo, ref, non-empty pairs)', () => {
    expect(manifest.overlayRepo, 'overlayRepo required').toBeTruthy()
    expect(manifest.overlayRef, 'overlayRef required').toMatch(/^[0-9a-f]{40}$/)
    expect(manifest.pairs.length).toBeGreaterThan(0)
    for (const entry of manifest.pairs) {
      expect(entry.adapterPath, 'adapterPath required').toBeTruthy()
      expect(entry.overlayPath, 'overlayPath required').toBeTruthy()
      expect(entry.sha256, `sha256 malformed for ${entry.adapterPath}`).toMatch(/^[0-9a-f]{64}$/)
      expect(
        entry.overlaySha256,
        `overlaySha256 required + well-formed for ${entry.overlayPath} ` +
          `(this is the runtime-side pin SEC-32 added)`
      ).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.syncNote, `syncNote required for ${entry.adapterPath}`).toBeTruthy()
    }
  })

  it('manifest overlayRef matches the Dockerfile-pinned ARG OVERLAY_REF', () => {
    // Single source of truth: the overlay commit the manifest pins MUST be the
    // overlay commit a customer Machine actually ships (Dockerfile ARG). If they
    // drift, the operator-substrate overlay-hash check would verify a different
    // commit than ships — defeating the gate. Bump both together.
    expect(
      manifest.overlayRef,
      `overlay-pairs.json overlayRef (${manifest.overlayRef}) != Dockerfile ARG OVERLAY_REF ` +
        `(${dockerfileOverlayRef()}). Re-pin both to the same overlay commit and re-record ` +
        `each overlaySha256 from the runtime file at that ref.`
    ).toBe(dockerfileOverlayRef())
  })

  it('every manifest entry points at an existing adapter file', () => {
    for (const entry of manifest.pairs) {
      expect(existsSync(resolve(entry.adapterPath)), `${entry.adapterPath} missing`).toBe(true)
    }
  })

  for (const entry of loadManifest().pairs) {
    it(`${entry.adapterPath} matches its recorded hash`, () => {
      const actual = sha256(resolve(entry.adapterPath))
      expect(
        actual,
        `${entry.adapterPath} changed without a manifest update.\n` +
          `Its runtime twin is ${entry.overlayPath} in venturecrane/hermes-smd-overlay.\n` +
          `Decide whether this change needs a paired overlay PR, then update the\n` +
          `sha256 to ${actual} and record the decision in syncNote\n` +
          `(operator/contracts/overlay-pairs.json).`
      ).toBe(entry.sha256)
    })
  }
})
