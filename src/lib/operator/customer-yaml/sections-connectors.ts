/**
 * Connectors section validator. The `connectors:` map is keyed by the
 * closed CapabilityName union (ADR 0006) and binds each capability to one
 * adapter slug + backend prefix + optional Infisical token_ref.
 */

import type { CapabilityName } from '../capabilities/types'
import {
  ACCEPTED_CREDENTIAL_CUSTODY,
  DEFAULT_CREDENTIAL_CUSTODY,
  type CredentialCustody,
} from '../credential-custody'
import {
  ACCEPTED_BACKEND_PREFIXES,
  ACCEPTED_CAPABILITY_NAMES,
  WEBHOOK_URL_PATTERN,
  type Connector,
  type ValidationError,
} from './types'
import { isPlainObject, optionalEnum } from './helpers'

/**
 * `credential_custody_default` (ADR 0042) — optional top-level client-level
 * default applied to every connector whose own `credential_custody` is null.
 * Defaults to `delegated` (the hands-off value) when absent. Per-connector
 * values override it; the resolver is `resolveCredentialCustody`. Lives with
 * the connectors section because custody is the security dimension of the
 * connectors authority domain.
 */
export function checkCredentialCustodyDefault(
  root: Record<string, unknown>,
  errors: ValidationError[]
): CredentialCustody {
  const v = optionalEnum(
    root,
    'credential_custody_default',
    ACCEPTED_CREDENTIAL_CUSTODY,
    'credential_custody_default',
    errors
  )
  return v ?? DEFAULT_CREDENTIAL_CUSTODY
}

export function checkConnectors(
  root: Record<string, unknown>,
  customerId: string | null,
  errors: ValidationError[]
): Partial<Record<CapabilityName, Connector>> {
  const raw = root['connectors']
  if (raw === undefined || raw === null) {
    errors.push({ code: 'MissingField', path: 'connectors', message: 'connectors is required' })
    return {}
  }
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path: 'connectors', message: 'connectors must be a map' })
    return {}
  }
  const out: Partial<Record<CapabilityName, Connector>> = {}
  for (const [key, value] of Object.entries(raw)) {
    const connector = checkOneConnector(key, value, customerId, errors)
    if (connector !== null) out[key as CapabilityName] = connector
  }
  return out
}

function checkOneConnector(
  key: string,
  value: unknown,
  customerId: string | null,
  errors: ValidationError[]
): Connector | null {
  if (!ACCEPTED_CAPABILITY_NAMES.has(key as CapabilityName)) {
    errors.push({
      code: 'UnknownCapability',
      path: `connectors.${key}`,
      message: `unknown capability "${key}"; accepted: ${Array.from(ACCEPTED_CAPABILITY_NAMES).join(
        ', '
      )}`,
    })
    return null
  }
  if (!isPlainObject(value)) {
    errors.push({
      code: 'TypeMismatch',
      path: `connectors.${key}`,
      message: 'connector entry must be an object',
    })
    return null
  }
  const adapter = checkAdapter(key, value['adapter'], errors)
  const backend = checkBackend(key, value['backend'], errors)
  if (adapter === null || backend === null) return null
  if (!checkTokenRef(key, value['token_ref'], errors)) return null
  const scopes = checkScopes(key, value['scopes'], errors)
  if (scopes === null) return null
  const webhookUrl = checkWebhookUrl(key, value['webhook_url'], customerId, errors)
  if (webhookUrl === undefined) return null
  const enabled = typeof value['enabled'] === 'boolean' ? value['enabled'] : true
  const tokenRef = typeof value['token_ref'] === 'string' ? value['token_ref'] : null
  // ADR 0042: optional per-connector custody; null ⇒ inherit the client-level
  // credential_custody_default. Enum-gated; absence is the common case.
  const custody = optionalEnum(
    value,
    'credential_custody',
    ACCEPTED_CREDENTIAL_CUSTODY,
    `connectors.${key}.credential_custody`,
    errors
  )
  const authMode = typeof value['auth_mode'] === 'string' ? value['auth_mode'] : null
  return {
    adapter,
    backend,
    enabled,
    scopes,
    token_ref: tokenRef,
    webhook_url: webhookUrl,
    credential_custody: custody,
    auth_mode: authMode,
  }
}

/**
 * Validate optional connector webhook_url. Returns the URL string when
 * valid, null when absent, or undefined to signal a hard failure that
 * drops the whole connector.
 *
 * ADR 0021 Stream E: the URL is where the connector's vendor pushes
 * events; the overlay's hermes-smd-webhook-router plugin routes the
 * inbound payload to a skill via the top-level webhook_triggers map.
 * The customer_id embedded in the URL MUST match the document's
 * customer_id (cross-customer leakage vector if it ever doesn't).
 */
function checkWebhookUrl(
  key: string,
  raw: unknown,
  customerId: string | null,
  errors: ValidationError[]
): string | null | undefined {
  if (raw === undefined || raw === null) return null
  const path = `connectors.${key}.webhook_url`
  if (typeof raw !== 'string' || raw.length === 0) {
    errors.push({
      code: 'TypeMismatch',
      path,
      message: 'webhook_url must be a non-empty string when present',
    })
    return undefined
  }
  const match = WEBHOOK_URL_PATTERN.exec(raw)
  if (match === null) {
    errors.push({
      code: 'InvalidWebhookUrl',
      path,
      message:
        'webhook_url must match "https://hermes-{customer_id}.fly.dev/webhooks/{capability_slug}" — ' +
        "the URL must point at the customer's own Fly Machine (ADR 0009)",
    })
    return undefined
  }
  if (customerId !== null && match[1] !== customerId) {
    errors.push({
      code: 'IsolationViolation',
      path,
      message:
        `webhook_url embeds slug "${match[1]}" but customer_id is "${customerId}" — ` +
        "cross-customer routing vector; the URL must point at THIS customer's Machine",
    })
    return undefined
  }
  return raw
}

function checkAdapter(key: string, adapter: unknown, errors: ValidationError[]): string | null {
  if (typeof adapter !== 'string' || adapter.length === 0) {
    errors.push({
      code: 'MissingField',
      path: `connectors.${key}.adapter`,
      message: 'connector.adapter is required',
    })
    return null
  }
  return adapter
}

function checkBackend(key: string, backend: unknown, errors: ValidationError[]): string | null {
  if (typeof backend !== 'string' || backend.length === 0) {
    errors.push({
      code: 'MissingField',
      path: `connectors.${key}.backend`,
      message: 'connector.backend is required',
    })
    return null
  }
  if (!ACCEPTED_BACKEND_PREFIXES.some((p) => backend.startsWith(p))) {
    errors.push({
      code: 'InvalidBackend',
      path: `connectors.${key}.backend`,
      message: `connector.backend must start with one of: ${ACCEPTED_BACKEND_PREFIXES.join(', ')}`,
    })
    return null
  }
  return backend
}

function checkTokenRef(key: string, tokenRef: unknown, errors: ValidationError[]): boolean {
  if (tokenRef === undefined || tokenRef === null) return true
  if (typeof tokenRef !== 'string' || !tokenRef.startsWith('infisical:')) {
    errors.push({
      code: 'InvalidTokenRef',
      path: `connectors.${key}.token_ref`,
      message:
        'token_ref must be a string starting with "infisical:" (the only permitted secret-reference channel)',
    })
    return false
  }
  const refPath = tokenRef.slice('infisical:'.length)
  const segments = refPath.split('/').filter((s) => s.length > 0)
  if (segments.length < 3) {
    errors.push({
      code: 'InvalidTokenRef',
      path: `connectors.${key}.token_ref`,
      message: 'token_ref must have at least three path segments after "infisical:"',
    })
    return false
  }
  return true
}

function checkScopes(key: string, scopes: unknown, errors: ValidationError[]): string[] | null {
  if (scopes === undefined || scopes === null) return []
  if (!Array.isArray(scopes) || !scopes.every((s) => typeof s === 'string')) {
    errors.push({
      code: 'TypeMismatch',
      path: `connectors.${key}.scopes`,
      message: 'connector.scopes must be a list of strings',
    })
    return null
  }
  return scopes
}
