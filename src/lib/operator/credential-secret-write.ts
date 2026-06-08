/**
 * Write-only static-secret entry core (ADR 0042 §Rules 3, §Verification 3).
 *
 * A client entering a raw static secret (an API key for CourtListener,
 * CallRail, etc.) needs it to land in their per-customer isolated vault
 * WITHOUT the value ever touching the console DB, an application log, or any
 * transcript. This module is that guarantee, expressed as a pure, fully
 * testable core: parse → validate → write (via an injected vault transport) →
 * return ONLY a masked confirmation, and record an audit row that proves a
 * secret was set without ever carrying the value.
 *
 * The value appears in exactly one place: the `secret` argument flowing into
 * `CustomerSecretWriter.write`. It is never returned, never audited, never
 * logged. `maskSecret` is the only value-derived output and reveals at most
 * the last four characters.
 *
 * The transport is injected (the {@link CustomerSecretWriter} interface) so:
 *   - the no-leak invariants are tested against a spy with zero infra, and
 *   - the production transport (Fly per-customer secret + Machine relay, the
 *     ADR 0036 pattern, or an Infisical per-customer path for delegated static
 *     keys) is wired at the edge without touching this contract.
 *
 * Self-held vs delegated custody (ADR 0042) is a property of the *transport*,
 * not this core: a self-held writer stores the value where only the operator
 * runtime can read it (SMD-unreadable); a delegated writer stores it
 * SMD-readable. Both honor the same no-leak-into-console contract here — the
 * console process must never persist or log the value in either mode.
 */

import { ACCEPTED_CAPABILITY_NAMES } from './customer-yaml/types'
import type { CapabilityName } from './capabilities/types'

/** Max accepted secret length. Generous for API keys / PATs; rejects pasted
 * blobs that are almost certainly a mistake (a whole file, a cert chain). */
export const MAX_SECRET_LENGTH = 8192

export interface SecretWriteInput {
  /** Per-customer slug — scopes the write to exactly one customer's vault. */
  customerSlug: string
  /** Capability the secret authenticates; validated against the closed union. */
  connector: string
  /** The raw secret value. NEVER logged, returned, or audited. */
  secret: string
}

export interface SecretWriteActor {
  /** Identity of the human entering the secret — for the audit row. */
  actor: string
  /** Their client-internal role — for the audit row. */
  actorRole: string
}

/**
 * Injected vault transport. The ONLY component that sees the raw value.
 * Implementations MUST write straight to the per-customer isolated store and
 * MUST NOT log or persist the value anywhere the console can read it (in
 * self-held mode, anywhere SMD can read it at all).
 */
export interface CustomerSecretWriter {
  /**
   * Write `secret` into the customer's vault for `connector`. Return a
   * NON-secret storage pointer (e.g. "infisical:/operator/<slug>/<cap>/api-key"
   * or a Fly secret name) — never the value. Throw on failure; the core maps a
   * throw to `write_failed` and never surfaces the thrown detail to the client.
   */
  write(input: { customerSlug: string; connector: CapabilityName; secret: string }): Promise<{
    ref: string
  }>
}

/**
 * Injected audit sink. Records THAT a secret was set — actor, connector,
 * masked tail, storage ref, timestamp. Never the value. Append-only at the
 * edge (a row in the operator audit log).
 */
export interface CredentialSecretAudit {
  record(row: {
    customerSlug: string
    connector: CapabilityName
    actor: string
    actorRole: string
    masked: string
    ref: string
  }): Promise<void>
}

export type SecretWriteError = 'invalid_connector' | 'empty_secret' | 'too_long' | 'write_failed'

export type SecretWriteResult =
  | { ok: true; masked: string; ref: string }
  | { ok: false; error: SecretWriteError }

/**
 * Mask a secret for confirmation display. Reveals at most the last four
 * characters, and nothing at all for short secrets (≤8 chars) where four
 * characters would expose too much. Never returns the full value.
 */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••••••'
  return `••••••${secret.slice(-4)}`
}

function isAcceptedConnector(connector: string): connector is CapabilityName {
  return ACCEPTED_CAPABILITY_NAMES.has(connector as CapabilityName)
}

/**
 * Validate input WITHOUT echoing the value. Returns an error tag or null.
 * Length/emptiness are the only value-derived checks and they never include
 * the value in their result.
 */
export function validateSecretInput(input: SecretWriteInput): SecretWriteError | null {
  if (!isAcceptedConnector(input.connector)) return 'invalid_connector'
  if (input.secret.length === 0) return 'empty_secret'
  if (input.secret.length > MAX_SECRET_LENGTH) return 'too_long'
  return null
}

/**
 * Orchestrate a write-only secret entry. The value flows only into
 * `writer.write`; everything returned or audited is masked or a non-secret
 * ref. A transport failure is collapsed to `write_failed` so no thrown detail
 * (which could embed the value) reaches the caller.
 */
export async function handleSecretWrite(
  deps: { writer: CustomerSecretWriter; audit: CredentialSecretAudit },
  input: SecretWriteInput,
  actor: SecretWriteActor
): Promise<SecretWriteResult> {
  const invalid = validateSecretInput(input)
  if (invalid !== null) return { ok: false, error: invalid }

  const connector = input.connector as CapabilityName
  let ref: string
  try {
    const written = await deps.writer.write({
      customerSlug: input.customerSlug,
      connector,
      secret: input.secret,
    })
    ref = written.ref
  } catch {
    // Deliberately discard the thrown value — it may embed the secret.
    return { ok: false, error: 'write_failed' }
  }

  const masked = maskSecret(input.secret)
  await deps.audit.record({
    customerSlug: input.customerSlug,
    connector,
    actor: actor.actor,
    actorRole: actor.actorRole,
    masked,
    ref,
  })
  return { ok: true, masked, ref }
}
