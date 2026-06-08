/**
 * Operator credential custody — the frozen contract (ADR 0042).
 *
 * Custody answers, per connector, one question: can SMD staff reach the
 * credential value to re-establish a broken connection, or only the client?
 * It is the security dimension of the connectors authority domain (ADR 0041),
 * not a separate axis of who-operates. Both modes store the secret in the
 * per-customer isolated vault (ADR 0010 / 0007); the only thing custody moves
 * is whether SMD can read/rotate it.
 *
 * Pure module — no D1, no validator dependency, no I/O. Imported by the
 * customer.yaml validator, the projection reader, and both portals.
 *
 * The two modes (ADR 0042 §Decision):
 *   - delegated  (default): SMD monitors and drives re-establishment. For
 *     OAuth, SMD never holds the secret but fires the one-click re-consent
 *     link; for static secrets, the key is stored SMD-readable so SMD can
 *     rotate it without the customer.
 *   - self_held (privacy-max): SMD cannot reach the value. OAuth re-consent is
 *     client-initiated; a static secret is stored so only the operator runtime
 *     can use it — SMD drives the customer through re-entry but cannot paste it
 *     back. The cost of the "our consultant literally cannot touch our keys"
 *     guarantee.
 */

export const ACCEPTED_CREDENTIAL_CUSTODY = ['delegated', 'self_held'] as const
export type CredentialCustody = (typeof ACCEPTED_CREDENTIAL_CUSTODY)[number]

/**
 * Delegated is the default because not-fussing-with-connectors is core to the
 * Operator value (ADR 0042 §Delegated). Self-held is always opt-in.
 */
export const DEFAULT_CREDENTIAL_CUSTODY: CredentialCustody = 'delegated'

/**
 * Resolve a connector's effective custody: per-connector value → client-level
 * default → `delegated` (ADR 0042 §Verification rule 1). A `null` at either
 * level means "inherit"; only an explicit value pins it.
 */
export function resolveCredentialCustody(
  perConnector: CredentialCustody | null,
  clientDefault: CredentialCustody | null
): CredentialCustody {
  return perConnector ?? clientDefault ?? DEFAULT_CREDENTIAL_CUSTODY
}

/**
 * Does this resolved custody allow SMD staff to read/rotate the secret value
 * without the customer? True only for delegated. Self-held is, by definition,
 * unreachable by SMD — the property the privacy guarantee rests on.
 *
 * NOTE: this describes the *intended* policy for static secrets. For OAuth,
 * SMD never holds the secret in either mode (ADR 0010) — delegated only means
 * SMD *drives* re-consent, not that SMD reads the token. The write-only
 * static-secret entry path is what physically enforces self-held for static
 * keys; this predicate is the policy these surfaces read to decide whether to
 * offer an SMD-side "rotate for the client" affordance.
 */
export function smdCanReachSecret(custody: CredentialCustody): boolean {
  return custody === 'delegated'
}

/**
 * Fail-safe parse of an untrusted custody value (projected JSON, form input).
 * Returns the value when it is one of the accepted modes, else `null`
 * ("inherit"). Never throws — the strict authoring gate is in the validator.
 */
export function parseCredentialCustody(raw: unknown): CredentialCustody | null {
  if (raw === 'delegated' || raw === 'self_held') return raw
  return null
}
