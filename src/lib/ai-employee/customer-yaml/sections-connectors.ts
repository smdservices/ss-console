/**
 * Connectors section validator. The `connectors:` map is keyed by the
 * closed CapabilityName union (ADR 0006) and binds each capability to one
 * adapter slug + backend prefix + optional Infisical token_ref.
 *
 * For Composio-managed connectors (`backend: composio:*`) we additionally
 * require a `composio_connection_id` of the shape
 * `conn_{customer_id}_{suffix}`. Composio's tenant model stages one
 * `COMPOSIO_API_KEY` per fleet and scopes per-customer access by
 * connection ID; without an authored-and-checked binding to the customer
 * slug a misrouted ID is a cross-customer leakage vector (issue #850).
 * The runtime backstop lives at
 * `ai-employee/adapter/connectors/composio_assertion.py`.
 */

import {
  ACCEPTED_BACKEND_PREFIXES,
  ACCEPTED_CAPABILITY_NAMES,
  SLUG_PATTERN,
  WEBHOOK_URL_PATTERN,
  type CapabilityName,
  type Connector,
  type ValidationError,
} from './types'
import { isPlainObject } from './helpers'

const COMPOSIO_BACKEND_PREFIX = 'composio:'

/**
 * Connection-ID suffix shape. Mirrors the regex in
 * `composio_assertion.py::_CONNECTION_ID_SUFFIX` — keep the two in sync.
 * Allowed: 4-80 chars of [A-Za-z0-9_-].
 */
const CONNECTION_ID_SUFFIX_PATTERN = /^[A-Za-z0-9_-]{4,80}$/

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
  const connectionId = checkComposioConnectionId(
    key,
    value['composio_connection_id'],
    backend,
    customerId,
    errors
  )
  if (connectionId === undefined) return null
  const webhookUrl = checkWebhookUrl(key, value['webhook_url'], customerId, errors)
  if (webhookUrl === undefined) return null
  const enabled = typeof value['enabled'] === 'boolean' ? value['enabled'] : true
  const tokenRef = typeof value['token_ref'] === 'string' ? value['token_ref'] : null
  return {
    adapter,
    backend,
    enabled,
    scopes,
    token_ref: tokenRef,
    composio_connection_id: connectionId,
    webhook_url: webhookUrl,
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

/**
 * Returns the validated connection ID string, `null` if absent (legal for
 * non-composio backends), or `undefined` to signal a hard failure that
 * should drop the whole connector from the output.
 */
function checkComposioConnectionId(
  key: string,
  raw: unknown,
  backend: string,
  customerId: string | null,
  errors: ValidationError[]
): string | null | undefined {
  const isComposio = backend.startsWith(COMPOSIO_BACKEND_PREFIX)
  const path = `connectors.${key}.composio_connection_id`

  if (raw === undefined || raw === null) {
    if (isComposio) {
      errors.push({
        code: 'MissingField',
        path,
        message:
          'composio_connection_id is required for backend "composio:*" — per-customer ' +
          'connection isolation cannot be enforced without it (issue #850)',
      })
      return undefined
    }
    return null
  }

  if (typeof raw !== 'string') {
    errors.push({
      code: 'TypeMismatch',
      path,
      message: 'composio_connection_id must be a string when present',
    })
    return undefined
  }

  if (!isComposio) {
    errors.push({
      code: 'IsolationViolation',
      path,
      message:
        'composio_connection_id may only be set when backend starts with "composio:" — ' +
        'remove it from non-composio connectors to avoid implying isolation that is not enforced',
    })
    return undefined
  }

  return checkComposioConnectionIdShape(path, raw, customerId, errors)
}

function checkComposioConnectionIdShape(
  path: string,
  raw: string,
  customerId: string | null,
  errors: ValidationError[]
): string | undefined {
  const parsed = parseComposioConnectionId(raw)
  if (parsed === null) {
    errors.push({
      code: 'InvalidFormat',
      path,
      message:
        'composio_connection_id must match shape "conn_{customer_id}_{suffix}" ' +
        'where suffix is 4-80 chars of [A-Za-z0-9_-]; see ' +
        'ai-employee/adapter/connectors/composio_assertion.py',
    })
    return undefined
  }

  if (customerId !== null && parsed.slug !== customerId) {
    errors.push({
      code: 'IsolationViolation',
      path,
      message:
        `composio_connection_id is bound to slug "${parsed.slug}" but customer_id is ` +
        `"${customerId}" — Composio connection IDs MUST embed the customer_id ` +
        '(cross-customer leakage vector; see ADR 0009 and issue #850)',
    })
    return undefined
  }
  return raw
}

/**
 * Parse a `conn_{slug}_{suffix}` ID. Returns the slug + suffix when the
 * shape matches, or null otherwise.
 *
 * Implementation note: we avoid a single mega-regex with `{2,40}` style
 * quantifiers so the slug-vs-suffix split is unambiguous when the slug
 * itself contains dashes (e.g. `smith-pi-firm`). Strategy: strip the
 * `conn_` prefix, find the LAST underscore — slug is everything before
 * it, suffix is everything after — then validate each piece against the
 * shared patterns.
 */
function parseComposioConnectionId(raw: string): { slug: string; suffix: string } | null {
  if (!raw.startsWith('conn_')) return null
  const tail = raw.slice('conn_'.length)
  const lastUnderscore = tail.lastIndexOf('_')
  if (lastUnderscore <= 0 || lastUnderscore === tail.length - 1) return null
  const slug = tail.slice(0, lastUnderscore)
  const suffix = tail.slice(lastUnderscore + 1)
  if (!SLUG_PATTERN.test(slug)) return null
  if (!CONNECTION_ID_SUFFIX_PATTERN.test(suffix)) return null
  return { slug, suffix }
}
