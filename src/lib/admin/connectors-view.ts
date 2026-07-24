/**
 * Connectors & credentials view-model for the admin Operator console
 * (`/admin/operator/[customer]/connectors`) — design §5.4, ADR 0042 (custody) /
 * ADR 0020 (connector backends).
 *
 * Reads the connector bindings out of `customer_configs.connectors_json` (the
 * `capability → Connector` map, ADR 0019) and resolves each connector's
 * effective credential custody (delegated / self-held) over the client-level
 * default. The custody contract and the secret-relay gate are the frozen
 * foundation; this module owns only the parse + the pure display derivations.
 *
 * Two honesty rules the surface obeys:
 *   - connectors_json carries infra keys (e.g. per_customer_d1_database_id)
 *     alongside the capability bindings; only keys in ACCEPTED_CAPABILITY_NAMES
 *     are connectors. Everything else is skipped, never rendered as a connector.
 *   - Live connector HEALTH (reachable / auth-expired) needs a per-customer
 *     runtime read; the console does not have it here. We surface the AUTHORED
 *     state (configured vs not, from token_ref) and say health is pending —
 *     never a fabricated "connected/green".
 */

import {
  resolveCredentialCustody,
  smdCanReachSecret,
  parseCredentialCustody,
  type CredentialCustody,
} from '../operator/credential-custody'
import { ACCEPTED_CAPABILITY_NAMES } from '../operator/customer-yaml/types'
import type { CapabilityName } from '../operator/capabilities/types'

export interface ConnectorView {
  capability: CapabilityName
  /** Backend prefix family: mcp / build / synthetic / native (ADR 0020), or 'unknown'. */
  backend: string
  backendKind: 'mcp' | 'build' | 'synthetic' | 'native' | 'unknown'
  scopes: string[]
  /** A credential reference is present (the connector has been wired). */
  configured: boolean
  custody: CredentialCustody
  /** Whether SMD staff can reach/rotate the secret (delegated only). */
  smdCanReach: boolean
}

/**
 * Parse the connector bindings for the connectors surface. `clientDefault` is
 * the client-level credential_custody_default (already resolved by the projection).
 * Returns one view per capability binding, in a stable order; infra keys are
 * skipped. Defensive: a malformed connectors_json yields an empty list rather
 * than throwing (the surface renders "no connectors configured").
 */
export function parseConnectorViews(
  connectorsJson: unknown,
  clientDefault: CredentialCustody
): ConnectorView[] {
  if (typeof connectorsJson !== 'object' || connectorsJson === null) return []
  const rec = connectorsJson as Record<string, unknown>
  const views: ConnectorView[] = []
  for (const key of Object.keys(rec)) {
    if (!ACCEPTED_CAPABILITY_NAMES.has(key as CapabilityName)) continue
    const view = parseOneConnector(key as CapabilityName, rec[key], clientDefault)
    if (view) views.push(view)
  }
  return views.sort((a, b) => a.capability.localeCompare(b.capability))
}

function parseOneConnector(
  capability: CapabilityName,
  raw: unknown,
  clientDefault: CredentialCustody
): ConnectorView | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = raw as Record<string, unknown>
  const backend = typeof c.backend === 'string' ? c.backend : ''
  const perConnector = parseCredentialCustody(c.credential_custody)
  const custody = resolveCredentialCustody(perConnector, clientDefault)
  return {
    capability,
    backend,
    backendKind: backendKind(backend),
    scopes: Array.isArray(c.scopes)
      ? c.scopes.filter((s): s is string => typeof s === 'string')
      : [],
    configured: typeof c.token_ref === 'string' && c.token_ref.length > 0,
    custody,
    smdCanReach: smdCanReachSecret(custody),
  }
}

function backendKind(backend: string): ConnectorView['backendKind'] {
  if (backend.startsWith('mcp:')) return 'mcp'
  if (backend.startsWith('build:')) return 'build'
  if (backend.startsWith('synthetic:')) return 'synthetic'
  if (backend.startsWith('native:')) return 'native'
  return 'unknown'
}

// ===========================================================================
// Pure display helpers
// ===========================================================================

export interface CustodyBadge {
  label: string
  classes: string
  /** One-line explanation of what this custody means for re-establishment. */
  detail: string
}

const BADGE_STRUCTURE =
  'inline-flex items-center px-2 py-0.5 rounded-[var(--ss-radius-badge)] ' +
  'text-[10px] font-medium uppercase tracking-wide whitespace-nowrap'

export function custodyBadge(custody: CredentialCustody): CustodyBadge {
  if (custody === 'delegated') {
    return {
      label: 'Delegated',
      classes: `${BADGE_STRUCTURE} bg-[color:var(--ss-color-primary)] text-white`,
      detail: 'SMD monitors and drives re-establishment.',
    }
  }
  return {
    label: 'Self-held',
    classes: `${BADGE_STRUCTURE} bg-[color:var(--ss-color-complete)] text-white`,
    detail: 'SMD cannot reach the value; the client re-establishes it.',
  }
}

export function backendLabel(kind: ConnectorView['backendKind']): string {
  switch (kind) {
    case 'mcp':
      return 'MCP server'
    case 'build':
      return 'Built adapter'
    case 'synthetic':
      return 'Synthetic (no-PM)'
    case 'native':
      return 'Native provider'
    case 'unknown':
      return 'Unknown backend'
  }
}

/** Connection state from the authored binding (not live health). */
export function connectionStateLabel(configured: boolean): string {
  return configured ? 'Configured' : 'Not connected'
}
