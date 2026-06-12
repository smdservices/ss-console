/**
 * Adapter ↔ overlay paired-file drift gate (2026-06-12 code review).
 *
 * Five modules exist as deliberate ported pairs: the ss-console copy is the
 * control-plane substrate (consumed by operator/bin lifecycle tooling) and
 * the hermes-smd-overlay copy is the runtime that ships on customer
 * Machines. Nothing previously enforced that an edit to one side was made
 * with the other side in mind — the pairs were already diverging
 * (SentItem vs SentMessage, executor contracts) with no signal.
 *
 * This gate pins the sha256 of each ss-console-side file in
 * operator/contracts/overlay-pairs.json. Editing a paired file without
 * updating its manifest entry fails CI. Updating the entry is the
 * conscious act: while bumping the hash, record in `syncNote` whether the
 * change needs a paired overlay PR (and reference it) or is deliberately
 * one-sided. The overlay repo is not present in this CI, so the gate
 * cannot diff contents across repos — it forces the human decision
 * instead.
 */

import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'

interface PairEntry {
  adapterPath: string
  overlayPath: string
  sha256: string
  syncNote: string
}

const MANIFEST_PATH = resolve('operator/contracts/overlay-pairs.json')

function loadManifest(): PairEntry[] {
  const raw: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'))
  if (!Array.isArray(raw)) throw new Error('overlay-pairs.json must be an array')
  return raw as PairEntry[]
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

describe('adapter ↔ overlay paired-file drift gate', () => {
  const manifest = loadManifest()

  it('manifest is non-empty and well-formed', () => {
    expect(manifest.length).toBeGreaterThan(0)
    for (const entry of manifest) {
      expect(entry.adapterPath, 'adapterPath required').toBeTruthy()
      expect(entry.overlayPath, 'overlayPath required').toBeTruthy()
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.syncNote, `syncNote required for ${entry.adapterPath}`).toBeTruthy()
    }
  })

  it('every manifest entry points at an existing file', () => {
    for (const entry of manifest) {
      expect(existsSync(resolve(entry.adapterPath)), `${entry.adapterPath} missing`).toBe(true)
    }
  })

  for (const entry of loadManifest()) {
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
