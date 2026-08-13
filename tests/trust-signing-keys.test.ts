import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CURRENT_KEY_URL,
  SIGNER_OF_RECORD,
  SIGNING_KEYS,
  activeSigningKey,
} from '../src/lib/trust/signing-keys'

/**
 * The trust page is a standing commitment to people who are not our customers
 * (a client's carrier, their counsel, an opposing party). These guards hold the
 * two properties that commitment rests on.
 *
 * THE FALSIFIER, AND WHY IT RUNS IN THIS DIRECTION. The published fingerprint
 * is authored data, deliberately: a page that computed it from whatever PEM
 * happens to be on disk would republish a swapped key's own fingerprint as if
 * nothing had changed, and would pass every time. So the test recomputes the
 * fingerprint FROM the committed key and asserts it equals the AUTHORED value.
 * Swap the key without updating the registry and this fails; update the
 * registry without swapping the key and this fails. Either error is caught, and
 * neither is caught by the page rendering successfully.
 *
 * The recomputation mirrors `operator/adapter/evidence/signing.py`:
 * `key_id = sha256(DER of the public key)`. A PEM is base64 of exactly those
 * DER bytes between the armor lines, so decoding the body reproduces the input
 * the Python side hashes.
 */

/** Decode a PEM public key body to its DER bytes. */
function pemToDer(pem: string): Buffer {
  const body = pem
    .split('\n')
    .filter((line) => !line.startsWith('-----') && line.trim() !== '')
    .join('')
  return Buffer.from(body, 'base64')
}

describe('published signing keys', () => {
  it('publishes at least one key (the page has something to say)', () => {
    expect(SIGNING_KEYS.length).toBeGreaterThan(0)
  })

  it('every published fingerprint is the sha256 of the committed key it names', () => {
    for (const key of SIGNING_KEYS) {
      const onDisk = resolve(`public${key.path}`)
      expect(existsSync(onDisk), `${key.path} is published but not committed`).toBe(true)
      const recomputed = createHash('sha256')
        .update(pemToDer(readFileSync(onDisk, 'utf8')))
        .digest('hex')
      expect(
        recomputed,
        `the key at ${key.path} does not match its published fingerprint. Either the key ` +
          'was replaced without updating src/lib/trust/signing-keys.ts, or the registry was ' +
          'edited without replacing the key. Both invalidate every packet that cites it.'
      ).toBe(key.keyId)
    }
  })

  it('at most one key is active at a time', () => {
    expect(SIGNING_KEYS.filter((k) => k.status === 'active').length).toBeLessThanOrEqual(1)
  })

  it('the stable URL resolves to the active key', () => {
    const active = activeSigningKey()
    if (active === null) return
    expect(CURRENT_KEY_URL.endsWith(active.path)).toBe(true)
  })

  it('a retired key keeps a retirement date and a stated reason', () => {
    // A retired key that says nothing about WHY leaves a reader holding a
    // packet signed under it unable to judge what the retirement means for
    // them: routine rotation and a suspected exposure are not the same fact.
    for (const key of SIGNING_KEYS.filter((k) => k.status === 'retired')) {
      expect(key.retiredOn, `${key.keyId} is retired with no date`).not.toBeNull()
      expect(key.retiredReason, `${key.keyId} is retired with no reason`).not.toBeNull()
    }
    for (const key of SIGNING_KEYS.filter((k) => k.status === 'active')) {
      expect(key.retiredOn).toBeNull()
    }
  })

  it('fingerprints are unique (a duplicate would make the table ambiguous)', () => {
    const ids = SIGNING_KEYS.map((k) => k.keyId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('the signer of record is the entity, never a person', () => {
    expect(SIGNER_OF_RECORD).toBe('SMDurgan, LLC')
  })
})

describe('the trust page itself', () => {
  const page = readFileSync(resolve('src/pages/trust.astro'), 'utf8')

  it('is served at the address the packets cite', () => {
    // packet.py's README tells every reader to go to smd.services/trust. If the
    // page moves, that instruction is printed into archives we cannot recall.
    expect(existsSync(resolve('src/pages/trust.astro'))).toBe(true)
  })

  it('renders the registry rather than hardcoding a fingerprint', () => {
    expect(page).toContain('SIGNING_KEYS.map')
    // A literal 64-hex fingerprint in the page would drift from the registry.
    expect(page).not.toMatch(/[0-9a-f]{64}/)
  })
})
