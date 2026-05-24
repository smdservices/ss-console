/**
 * Customer config — portal read path for the projection of `customer.yaml`.
 *
 * Per ADR 0012, `customer.yaml` lives in a canonical git repository and is
 * projected on every merge into two read replicas:
 *
 *   1. portal D1 `customer_configs` table  (this module reads from here)
 *   2. per-customer R2 prefix              (Hermes reads from there)
 *
 * Neither replica is hand-edited. Drift detection (a daily cron, lands in a
 * follow-on PR) reconciles them against git. This module is read-only on
 * principle: any write path that bypasses git breaks the source-of-truth
 * commitment in ADR 0012 §2.
 *
 * Per ADR 0011, `personas` is an array (length ≥1 at v1, with the v1
 * customer's sole persona at index 0). `getActivePersona` returns the first
 * persona whose `status === 'active'`. Phase 2 extends the selector when a
 * second persona ships — the function signature stays additive (Phase 2 adds
 * an optional selector parameter; v1 callers continue to work).
 */

export type PersonaStatus = 'active' | 'archived'

export interface PersonaSendAs {
  agentmail_identity: string
}

export interface PersonaSkill {
  name: string
  trust_ceiling: string
}

export interface PersonaChannelBinding {
  integration: string
  channels: string[]
}

export interface PersonaConfig {
  slug: string
  status: PersonaStatus
  name: string
  title: string | null
  signature_html: string | null
  tone: string[]
  send_as: PersonaSendAs | null
  skills: PersonaSkill[]
  channel_bindings: PersonaChannelBinding[]
}

export interface CustomerConfigRow {
  entity_id: string
  org_id: string
  customer_slug: string
  schema_version: string
  personas: PersonaConfig[]
  voice_library: unknown
  escalation: unknown
  business_hours: unknown
  connectors: unknown
  scope: unknown
  /**
   * Projected from `customer.yaml.compliance_enabled` per issue #895.
   * When `false`, the dedicated Compliance dashboard view does not
   * render even for users who hold the `compliance` product_role —
   * the firm has not opted in to the separation-of-duties posture this
   * view represents. RBAC on the existing audit surface is independent
   * of this flag.
   */
  compliance_enabled: boolean
  /**
   * Projected from `customer.yaml.vertical` per issue #895. Drives the
   * per-vertical audit retention default surfaced on the Compliance
   * dashboard. Distinct from the prospect-side `entities.vertical`
   * field (different taxonomy, different purpose). Nullable so the row
   * can backfill before CI sync writes the column.
   */
  vertical: string | null
  git_sha: string
  synced_at: string
}

interface CustomerConfigDbRow {
  entity_id: string
  org_id: string
  customer_slug: string
  schema_version: string
  personas_json: string
  voice_library_json: string | null
  escalation_json: string | null
  business_hours_json: string | null
  connectors_json: string | null
  scope_json: string | null
  compliance_enabled: number
  vertical: string | null
  git_sha: string
  synced_at: string
}

/**
 * Parse a JSON column that may be null. Returns `null` when the column is
 * null. Throws on malformed JSON — drift detection / CI sync are responsible
 * for ensuring the projection is well-formed; a malformed JSON column is a
 * corruption signal, not a routine condition to recover from.
 */
function parseJsonNullable<T>(value: string | null): T | null {
  if (value === null) return null
  return JSON.parse(value) as T
}

/**
 * Parse a required JSON column. Throws on null OR malformed JSON — both are
 * corruption signals at the projection layer.
 */
function parseJsonRequired<T>(value: string, column: string, entityId: string): T {
  try {
    return JSON.parse(value) as T
  } catch (err) {
    throw new Error(
      `customer_configs.${column} is malformed JSON for entity_id=${entityId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err }
    )
  }
}

function projectRow(row: CustomerConfigDbRow): CustomerConfigRow {
  return {
    entity_id: row.entity_id,
    org_id: row.org_id,
    customer_slug: row.customer_slug,
    schema_version: row.schema_version,
    personas: parseJsonRequired<PersonaConfig[]>(row.personas_json, 'personas_json', row.entity_id),
    voice_library: parseJsonNullable(row.voice_library_json),
    escalation: parseJsonNullable(row.escalation_json),
    business_hours: parseJsonNullable(row.business_hours_json),
    connectors: parseJsonNullable(row.connectors_json),
    scope: parseJsonNullable(row.scope_json),
    compliance_enabled: row.compliance_enabled === 1,
    vertical: row.vertical,
    git_sha: row.git_sha,
    synced_at: row.synced_at,
  }
}

/**
 * Read the projected customer config for an entity. Returns null when no row
 * exists — a meaningful state during alpha when CI sync has not been wired
 * up yet (rows are hand-seeded only).
 */
export async function getCustomerConfig(
  db: D1Database,
  entityId: string
): Promise<CustomerConfigRow | null> {
  const row = await db
    .prepare('SELECT * FROM customer_configs WHERE entity_id = ?')
    .bind(entityId)
    .first<CustomerConfigDbRow>()
  if (!row) return null
  return projectRow(row)
}

/**
 * Return the active persona for this customer, or null when no config row
 * exists or no persona's `status === 'active'`. At v1 the personas array is
 * length 1 (ADR 0011 §1), so this returns personas[0] when active.
 *
 * Phase 2 (multi-persona runtime) will extend the resolver with a selector
 * — likely a `persona_slug` argument backed by URL or session state. The
 * signature stays additive: v1 callers passing only (db, entityId) keep
 * working when the Phase 2 selector lands.
 */
export async function getActivePersona(
  db: D1Database,
  entityId: string
): Promise<PersonaConfig | null> {
  const config = await getCustomerConfig(db, entityId)
  if (!config) return null
  const active = config.personas.find((p) => p.status === 'active')
  return active ?? null
}
