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

import { parseAuthorityPosture, type AuthorityPosture } from '../operator/authority'
import {
  DEFAULT_CREDENTIAL_CUSTODY,
  parseCredentialCustody,
  type CredentialCustody,
} from '../operator/credential-custody'
import {
  ACCEPTED_DATA_POSTURES,
  type DataPosture,
  type McpConnector,
  type McpConnectorAccess,
} from '../operator/customer-yaml/types'

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
  /**
   * Resolved authority posture (ADR 0041) — per-domain client-self-serve
   * switches over SMD's always-present full control. Always present: a null
   * `authority_json` column resolves to the launch default
   * (`{ default: 'managed', overrides: {} }`) via parseAuthorityPosture, so
   * portals never special-case absence. The resolver + domain contract live
   * in src/lib/operator/authority.ts.
   */
  authority: AuthorityPosture
  /**
   * Resolved client-level default credential custody (ADR 0042). Always
   * present: a null `credential_custody_default` column resolves to
   * `delegated`. Per-connector overrides live inside `connectors`. The
   * resolver `resolveCredentialCustody` lives in
   * src/lib/operator/credential-custody.ts.
   */
  credential_custody_default: CredentialCustody
  /**
   * Resolved `mcp_connector` block (Operator ⇄ Claude connector, Phase 1) —
   * projected from `customer.yaml.mcp_connector`. Always present: a null
   * `mcp_connector_json` column (a row predating the column, or a customer.yaml
   * with no block) resolves to the fail-closed default (disabled, empty access)
   * via {@link parseMcpConnector}. The MCP endpoint reads this for the per-user
   * `access[]` mapping; the Clerk binding lives separately in mcp_clerk_bindings.
   */
  mcp_connector: McpConnector
  git_sha: string
  synced_at: string
}

export interface CustomerConfigDbRow {
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
  authority_json: string | null
  credential_custody_default: string | null
  mcp_connector_json: string | null
  git_sha: string
  synced_at: string
}

/**
 * Parse a JSON column that may be null. Returns `null` when the column is
 * null. Throws on malformed JSON — drift detection / CI sync are responsible
 * for ensuring the projection is well-formed; a malformed JSON column is a
 * corruption signal, not a routine condition to recover from.
 */
function parseJsonNullable<T>(value: string | null | undefined): T | null {
  // null = column is SQL NULL; undefined = column absent from the row (e.g. a
  // freshly-added projection column a row predates, or a partial test row).
  // Both mean "no value" — only a present, malformed JSON string is corruption.
  if (value === null || value === undefined) return null
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

/** Fail-closed `mcp_connector`: no user reaches the Operator through Claude. */
const MCP_CONNECTOR_FAIL_CLOSED: McpConnector = {
  enabled: false,
  data_posture: 'open',
  access: [],
}

/**
 * Parse the projected `mcp_connector_json` column into a runtime `McpConnector`.
 *
 * DEFENSIVE / FAIL-CLOSED, unlike `parseJsonRequired`: a null column, malformed
 * JSON, or a shape-wrong value all resolve to the disabled default rather than
 * throwing. Two reasons: (1) this column is read on the live client portal, and
 * a corrupt value must not 500 the page the way a corrupt `personas_json` does;
 * (2) for the MCP endpoint, "config we can't trust" must mean "grant nothing",
 * never "open up". A well-formed enabled block with valid `access[]` entries is
 * honored exactly; anything else collapses to disabled + empty access.
 */
export function parseMcpConnector(json: string | null | undefined): McpConnector {
  if (json === null || json === undefined) return { ...MCP_CONNECTOR_FAIL_CLOSED, access: [] }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ...MCP_CONNECTOR_FAIL_CLOSED, access: [] }
  }
  if (raw === null || typeof raw !== 'object') return { ...MCP_CONNECTOR_FAIL_CLOSED, access: [] }
  const o = raw as Record<string, unknown>
  const data_posture: DataPosture = ACCEPTED_DATA_POSTURES.includes(o.data_posture as DataPosture)
    ? (o.data_posture as DataPosture)
    : 'open'
  const access: McpConnectorAccess[] = Array.isArray(o.access)
    ? o.access.flatMap((e) => {
        if (e === null || typeof e !== 'object') return []
        const entry = e as Record<string, unknown>
        if (typeof entry.email !== 'string' || typeof entry.profile !== 'string') return []
        return [{ email: entry.email, profile: entry.profile }]
      })
    : []
  return { enabled: o.enabled === true, data_posture, access }
}

export function projectRow(row: CustomerConfigDbRow): CustomerConfigRow {
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
    // JSON-syntax corruption throws like any other projected column; semantic
    // shape (unknown override keys/values) is tolerated by parseAuthorityPosture,
    // and a null column resolves to the launch-default posture.
    authority: parseAuthorityPosture(parseJsonNullable(row.authority_json)),
    credential_custody_default:
      parseCredentialCustody(row.credential_custody_default) ?? DEFAULT_CREDENTIAL_CUSTODY,
    mcp_connector: parseMcpConnector(row.mcp_connector_json),
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

// ===========================================================================
// customer_config_history — ADR 0022 Stream 3 (substrate gap B)
// ===========================================================================
//
// The history table records materialization events independently of git.
// Wherever the actual sync code path lives (CI workflow, drift-repair cron,
// manual portal action, bootstrap script), it should call
// `recordCustomerConfigSync` after writing customer_configs so the audit
// trail accumulates from day one.
//
// PR 3 ships the substrate (table + helpers + admin page). The sync code
// path itself lives where it already lives — this module does not own it.

/**
 * Source of a customer_config_history event. Mirrors the SyncSource enum
 * exported from src/lib/operator/customer-yaml (added in PR 1). Kept as
 * a literal-union here so the portal-side modules don't need to pull in
 * the validator just for the enum.
 */
export type SyncSource = 'manual' | 'ci' | 'drift-repair' | 'bootstrap'

export interface CustomerConfigHistoryRow {
  id: number
  customer_slug: string
  git_sha: string
  synced_at: string
  synced_by: SyncSource
  actor: string | null
  prev_git_sha: string | null
  r2_shadow_key: string | null
  created_at: string
}

interface PreviousSyncMeta {
  git_sha: string
  synced_by: SyncSource
}

/**
 * Decide whether a new sync event should record a history row.
 *
 * Rule (per ADR 0022 Stream 3 plan §"shouldRecordSync"):
 *   - First sync for the slug: always record.
 *   - SHA differs from previous: always record (the customer.yaml content changed).
 *   - SHA is identical AND source === 'drift-repair': record. The drift-cron
 *     is allowed to recover from out-of-band edits, and we want the audit
 *     trail of that recovery.
 *   - SHA is identical AND source !== 'drift-repair': no-op. Re-running CI
 *     against an already-synced commit shouldn't pollute the audit trail.
 *
 * Pure function — own unit test. The caller passes the previous row's
 * pointer fields; this module never touches D1 for the decision.
 */
export function shouldRecordSync(
  prev: PreviousSyncMeta | null,
  currentSha: string,
  source: SyncSource
): boolean {
  if (prev === null) return true
  if (prev.git_sha !== currentSha) return true
  return source === 'drift-repair'
}

interface PreviousSyncDbRow {
  git_sha: string
  synced_by: string
}

/**
 * Load the most-recent prior sync's pointer fields for the slug. Used by
 * recordCustomerConfigSync to feed shouldRecordSync.
 */
export async function getLatestSyncMeta(
  db: D1Database,
  customerSlug: string
): Promise<PreviousSyncMeta | null> {
  const row = await db
    .prepare(
      'SELECT git_sha, synced_by FROM customer_config_history ' +
        'WHERE customer_slug = ? ORDER BY synced_at DESC LIMIT 1'
    )
    .bind(customerSlug)
    .first<PreviousSyncDbRow>()
  if (!row) return null
  return { git_sha: row.git_sha, synced_by: row.synced_by as SyncSource }
}

export interface RecordSyncOptions {
  customer_slug: string
  git_sha: string
  /**
   * ISO-8601 timestamp the sync code was executed. Distinct from
   * created_at (which is set by the DB on INSERT) and from the git commit
   * timestamp (which is opaque to D1).
   */
  synced_at: string
  synced_by: SyncSource
  /**
   * Actor handle: email for `manual`, `'system:<job>'` for `drift-repair`,
   * `null` for fully-automated sources (`ci`, `bootstrap`).
   */
  actor: string | null
  /**
   * Optional R2 shadow key produced by the sync code path. The substrate
   * accepts but does not produce — the actual shadow write lives in the
   * sync code path, which can pass the key it produced or pass `null`
   * when no shadow was written.
   */
  r2_shadow_key: string | null
}

export interface RecordSyncResult {
  recorded: boolean
  /**
   * Reason the helper no-op'd. `null` when recorded === true. Useful for
   * the caller's logs without re-deriving the policy.
   */
  skipped_reason: string | null
}

/**
 * Record a sync event. No-ops cleanly when the policy says skip
 * (shouldRecordSync returned false). The helper does NOT UPSERT
 * customer_configs — that's the caller's responsibility, and it must
 * happen AFTER this helper so a corrupted live row always has a clean
 * predecessor history row at the prior git_sha.
 *
 * Caller flow:
 *   ```ts
 *   const prev = await getLatestSyncMeta(db, slug)
 *   const result = await recordCustomerConfigSync(db, {
 *     customer_slug: slug, git_sha: newSha, synced_at: now,
 *     synced_by: 'ci', actor: null, r2_shadow_key: shadowKey,
 *   })
 *   if (result.recorded) {
 *     // UPSERT customer_configs here
 *   }
 *   ```
 */
export async function recordCustomerConfigSync(
  db: D1Database,
  opts: RecordSyncOptions
): Promise<RecordSyncResult> {
  const prev = await getLatestSyncMeta(db, opts.customer_slug)
  if (!shouldRecordSync(prev, opts.git_sha, opts.synced_by)) {
    return {
      recorded: false,
      skipped_reason:
        `identical git_sha=${opts.git_sha} as previous sync ` +
        `(synced_by=${prev?.synced_by ?? 'unknown'}); only drift-repair re-records on identical SHA`,
    }
  }
  await db
    .prepare(
      'INSERT INTO customer_config_history ' +
        '(customer_slug, git_sha, synced_at, synced_by, actor, prev_git_sha, r2_shadow_key) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(
      opts.customer_slug,
      opts.git_sha,
      opts.synced_at,
      opts.synced_by,
      opts.actor,
      prev?.git_sha ?? null,
      opts.r2_shadow_key
    )
    .run()
  return { recorded: true, skipped_reason: null }
}

/**
 * List the most-recent N history rows for a customer slug. Powers the
 * admin /admin/operator/config-history/<slug>.astro page.
 */
export async function listCustomerConfigHistory(
  db: D1Database,
  customerSlug: string,
  limit = 20
): Promise<CustomerConfigHistoryRow[]> {
  const { results } = await db
    .prepare(
      'SELECT id, customer_slug, git_sha, synced_at, synced_by, actor, ' +
        'prev_git_sha, r2_shadow_key, created_at ' +
        'FROM customer_config_history ' +
        'WHERE customer_slug = ? ORDER BY synced_at DESC LIMIT ?'
    )
    .bind(customerSlug, limit)
    .all<CustomerConfigHistoryRow>()
  return results ?? []
}
