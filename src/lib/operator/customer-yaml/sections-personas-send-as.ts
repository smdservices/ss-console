/**
 * Persona `send_as` validator — split from sections-personas.ts to keep that
 * file under the 500-line ceiling (same convention as sections-google-auth.ts:
 * one focused module per grown sub-block).
 */

import {
  ACCEPTED_SEND_PROVIDERS,
  type PersonaSendAs,
  type SendIdentity,
  type SendProvider,
  type ValidationError,
} from './types'
import { isPlainObject } from './helpers'

/**
 * Validate + normalize a persona `send_as` block into the provider-neutral
 * {@link PersonaSendAs} shape (ADR 0078 §4 / email-channel-seam spec D5).
 *
 * Two authored forms are accepted:
 *   - `send_identity: { provider, address }` — the current shape.
 *   - `agentmail_identity: <address>` — the deprecated AgentMail-only field,
 *     normalized to `{ provider: 'agentmail', address }`.
 *
 * Authoring BOTH is a hard error (ambiguous intent — the repo fails closed on
 * ambiguity rather than silently picking one). On success the output carries
 * ONLY `send_identity` (the deprecated field is never emitted), so the output is
 * idempotent as input — re-validating a normalized value never trips the both-set
 * guard. Downstream readers consume `send_identity`; pre-migration projected D1
 * rows keep resolving via the read-side `agentmail_identity` fallback.
 */
export function checkSendAs(
  raw: unknown,
  path: string,
  errors: ValidationError[]
): PersonaSendAs | null {
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path, message: `${path} must be an object` })
    return null
  }
  const hasSendIdentity = raw['send_identity'] !== undefined && raw['send_identity'] !== null
  const hasLegacy = raw['agentmail_identity'] !== undefined && raw['agentmail_identity'] !== null
  if (hasSendIdentity && hasLegacy) {
    errors.push({
      code: 'InvalidFormat',
      path,
      message:
        `${path} sets both send_identity and the deprecated agentmail_identity — ` +
        'author exactly one (send_identity is preferred; agentmail_identity is back-compat only)',
    })
    return null
  }
  if (hasSendIdentity) {
    const identity = checkSendIdentity(raw['send_identity'], `${path}.send_identity`, errors)
    if (identity === null) return null
    return { send_identity: identity }
  }
  if (hasLegacy) {
    const legacy = raw['agentmail_identity']
    if (typeof legacy !== 'string' || legacy.length === 0) {
      errors.push({
        code: 'MissingField',
        path: `${path}.agentmail_identity`,
        message: 'send_as.agentmail_identity must be a non-empty string when set',
      })
      return null
    }
    return { send_identity: { provider: 'agentmail', address: legacy } }
  }
  errors.push({
    code: 'MissingField',
    path: `${path}.send_identity`,
    message: 'send_as requires send_identity { provider, address } (or legacy agentmail_identity)',
  })
  return null
}

/** Validate a `send_identity: { provider, address }` sub-block. */
function checkSendIdentity(
  raw: unknown,
  path: string,
  errors: ValidationError[]
): SendIdentity | null {
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path, message: `${path} must be an object` })
    return null
  }
  const provider = raw['provider']
  if (
    typeof provider !== 'string' ||
    !(ACCEPTED_SEND_PROVIDERS as readonly string[]).includes(provider)
  ) {
    errors.push({
      code: 'EnumViolation',
      path: `${path}.provider`,
      message: `${path}.provider must be one of: ${ACCEPTED_SEND_PROVIDERS.join(', ')}`,
    })
    return null
  }
  const address = raw['address']
  if (typeof address !== 'string' || address.length === 0) {
    errors.push({
      code: 'MissingField',
      path: `${path}.address`,
      message: `${path}.address must be a non-empty string`,
    })
    return null
  }
  return { provider: provider as SendProvider, address }
}
