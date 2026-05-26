/**
 * Connectors section validator. The `connectors:` map is keyed by the
 * closed CapabilityName union and binds each capability to one adapter
 * slug + backend prefix + optional Infisical token_ref.
 *
 * Microsoft-hosted MCP backends (`mcp:m365-mail`, `mcp:m365-calendar`,
 * `mcp:m365-teams`) require a `tenant_id` so the bootstrap CLI can
 * resolve the per-tenant URL at `agent365.svc.cloud.microsoft`.
 */

import {
  ACCEPTED_BACKEND_PREFIXES,
  ACCEPTED_CAPABILITY_NAMES,
  ENTRA_TENANT_ID_PATTERN,
  M365_HOSTED_MCP_PREFIX,
  type CapabilityName,
  type Connector,
  type ValidationError,
} from './types'
import { isPlainObject } from './helpers'
/* eslint-disable @typescript-eslint/no-unused-vars */

export function checkConnectors(
  root: Record<string, unknown>,
  _customerId: string | null,
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
    const connector = checkOneConnector(key, value, errors)
    if (connector !== null) out[key as CapabilityName] = connector
  }
  return out
}

function checkOneConnector(
  key: string,
  value: unknown,
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
  const tenantId = checkTenantId(key, value['tenant_id'], backend, errors)
  if (tenantId === undefined) return null
  const enabled = typeof value['enabled'] === 'boolean' ? value['enabled'] : true
  const tokenRef = typeof value['token_ref'] === 'string' ? value['token_ref'] : null
  return {
    adapter,
    backend,
    enabled,
    scopes,
    token_ref: tokenRef,
    tenant_id: tenantId,
  }
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
 * Required tenant ID for Microsoft-hosted MCP backends. Returns the tenant
 * string when valid, null when correctly absent on a non-M365 backend,
 * undefined to signal a hard failure that drops the connector.
 */
function checkTenantId(
  key: string,
  raw: unknown,
  backend: string,
  errors: ValidationError[]
): string | null | undefined {
  const isM365 = backend.startsWith(M365_HOSTED_MCP_PREFIX)
  const path = `connectors.${key}.tenant_id`

  if (raw === undefined || raw === null) {
    if (isM365) {
      errors.push({
        code: 'MissingField',
        path,
        message: `tenant_id is required for backend "${M365_HOSTED_MCP_PREFIX}*"`,
      })
      return undefined
    }
    return null
  }

  if (typeof raw !== 'string') {
    errors.push({ code: 'TypeMismatch', path, message: 'tenant_id must be a string when present' })
    return undefined
  }

  if (!ENTRA_TENANT_ID_PATTERN.test(raw)) {
    errors.push({
      code: 'InvalidTenantId',
      path,
      message:
        'tenant_id must be a lowercase canonical UUID (e.g. "00000000-0000-0000-0000-000000000000")',
    })
    return undefined
  }

  return raw
}
