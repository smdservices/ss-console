/**
 * The evidence-packet signing key registry (ss#2122).
 *
 * WHY THIS IS A STANDING COMMITMENT, NOT A PAGE. A compliance evidence packet
 * outlives the engagement that produced it. A firm hands one to its malpractice
 * carrier, to opposing counsel, or to an auditor, sometimes years later, and
 * that recipient must be able to verify it without asking us for anything. Two
 * properties make that possible, and both are promises we are making here:
 *
 *   1. The URL does not move. `https://smd.services/keys/evidence-packet-signing-key.pem`
 *      always serves the CURRENT key, and `https://smd.services/trust` always
 *      lists every key we have ever used.
 *   2. A key's fingerprint is permanent. A key cannot be "stable across
 *      rotations" in the sense of staying the same value, because a rotation
 *      by definition produces a different key. What is stable is that every
 *      fingerprint we have ever signed under stays published, with its status
 *      and its dates, so a packet signed under a retired key never becomes
 *      unverifiable. Deleting a retired key would silently invalidate every
 *      packet that carries it, which is the failure mode this registry exists
 *      to prevent.
 *
 * AUTHORED DATA, NOT DERIVED. Every field here is reviewed content, per the
 * no-fabricated-client-facing-content rule. In particular the fingerprint is
 * not something the page may compute at render time from whatever file happens
 * to be on disk: that would make the published fingerprint follow the artifact
 * rather than constrain it, and a swapped key would publish its own new
 * fingerprint as if nothing had happened. The value below is the reviewed one,
 * and `tests/trust-signing-keys.test.ts` recomputes it from the committed PEM
 * and fails if they disagree. The check runs in the direction that catches the
 * real error.
 *
 * ADDING A KEY (rotation procedure):
 *   1. Generate the new Ed25519 key. The private half goes to Infisical
 *      (`EVIDENCE_PACKET_SIGNING_KEY_B64` at `/ss`) and nowhere else.
 *   2. Commit the new public PEM at `public/keys/<key_id>.pem` AND overwrite
 *      `public/keys/evidence-packet-signing-key.pem` with the same bytes, so
 *      the stable URL serves it.
 *   3. Move the outgoing entry's status to `retired`, set `retiredOn`, and add
 *      the new entry with status `active`. Never delete an entry.
 */

export type SigningKeyStatus = 'active' | 'retired'

export interface SigningKey {
  /** SHA-256 hex of the DER-encoded public key. Derivable from the PEM alone,
   * which is what lets a reader confirm the packet names the key they hold.
   * Mirrors `operator/adapter/evidence/signing.py::key_id_from_public_der`. */
  keyId: string
  algorithm: 'Ed25519'
  /** Path under `public/`, served at the same path on smd.services. */
  path: string
  status: SigningKeyStatus
  /** ISO date the key began signing packets. */
  activeFrom: string
  /** ISO date the key stopped signing. Null while active. */
  retiredOn: string | null
  /** Why it was retired. Null while active. A key retired because its private
   * half may be exposed is a materially different fact for a reader holding a
   * packet signed under it, so the reason is published, not just the status. */
  retiredReason: string | null
}

/** The stable address of whichever key is currently signing. */
export const CURRENT_KEY_URL = 'https://smd.services/keys/evidence-packet-signing-key.pem'

/** The party that signs. Never a person: see manifest.py's module docstring. */
export const SIGNER_OF_RECORD = 'SMDurgan, LLC'

/**
 * Every signing key, newest first. Retired entries are never removed.
 */
export const SIGNING_KEYS: readonly SigningKey[] = [
  {
    keyId: '64a294493be8bfed2f09c8ce83316744af0af95d19f2fc47ef48337181f98c8a',
    algorithm: 'Ed25519',
    path: '/keys/evidence-packet-signing-key.pem',
    status: 'active',
    // The date the public half was committed (ec553b45). Published as the
    // start of the key's life rather than a guess at when it was generated.
    activeFrom: '2026-08-01',
    retiredOn: null,
    retiredReason: null,
  },
]

/** The key currently signing, or null if signing is not yet configured. */
export function activeSigningKey(): SigningKey | null {
  return SIGNING_KEYS.find((k) => k.status === 'active') ?? null
}
