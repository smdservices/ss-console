/**
 * Connections surface model (client-portal §5.8). Joins the connector status
 * rows (settings.ts) with each connector's resolved credential custody
 * (ADR 0042) so the /connections surface can show, per connector: status,
 * health, and whether SMD can reach the secret.
 *
 * Pure — no I/O. Reuses connectorRowsFromCustomerYaml for the base rows
 * (capability, adapter, health) and layers custody on top by re-reading the
 * per-connector `credential_custody` from the same projected YAML, resolved
 * against the client-level default.
 */

import { connectorRowsFromCustomerYaml, type ConnectorStatusRow } from './settings'
import {
  resolveCredentialCustody,
  smdCanReachSecret,
  parseCredentialCustody,
  type CredentialCustody,
} from '../../operator/credential-custody'

export interface ConnectionRow extends ConnectorStatusRow {
  /** Resolved custody: per-connector value → client default → delegated. */
  custody: CredentialCustody
  /** True when SMD staff may reach/rotate the secret (delegated only). */
  smdReachable: boolean
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Build the connections rows for a customer: the connector status rows plus
 * each connector's resolved custody. `connectorsYaml` is the projected
 * `connectors` map (Partial<Record<CapabilityName, Connector>>); the per-row
 * custody is read back from it by capability key.
 */
export function buildConnectionRows(
  connectorsYaml: unknown,
  clientDefault: CredentialCustody
): ConnectionRow[] {
  const base = connectorRowsFromCustomerYaml(connectorsYaml)
  return base.map((row) => {
    const entry = isRecord(connectorsYaml) ? connectorsYaml[row.capabilityName] : undefined
    const perConnector = isRecord(entry)
      ? parseCredentialCustody(entry['credential_custody'])
      : null
    const custody = resolveCredentialCustody(perConnector, clientDefault)
    return { ...row, custody, smdReachable: smdCanReachSecret(custody) }
  })
}

/** Client-facing label for a custody mode. */
export function formatCustody(custody: CredentialCustody): string {
  return custody === 'self_held' ? 'Self-held' : 'Delegated to SMD'
}

/**
 * One-line explanation of what a custody mode means for help/recovery, shown at
 * the connector. Honest about the trade (ADR 0042 §boundaries).
 */
export function describeCustody(custody: CredentialCustody): string {
  return custody === 'self_held'
    ? 'Only you can re-establish this connection. SMD cannot read or rotate the secret.'
    : 'SMD monitors this connection and can re-establish it for you.'
}
