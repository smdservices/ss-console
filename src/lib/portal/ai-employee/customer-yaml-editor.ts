/**
 * customer.yaml editor — resolver, locked-field policy, diff, and validation.
 *
 * Per ADR 0012, `customer.yaml` lives in a canonical git repository and is
 * the authoritative source of truth. The portal D1 `customer_configs` table
 * is a read replica (see `src/lib/portal/customer-config.ts`). This module
 * sits above that read replica and provides the editor-side surface for
 * the principal-only advanced settings page (#877):
 *
 *   1. A resolver (`resolveEditableConfigFromRow`) that returns the
 *      current configuration projected to the form's shape, with the
 *      customer-side mutable fields broken out from the Captain-only
 *      locked fields. The locked fields are always returned for display
 *      (with a "Captain-managed" badge) but never accepted as input.
 *
 *   2. A locked-field policy (`LOCKED_FIELD_PATHS`, `isLockedFieldPath`)
 *      that enumerates which JSONPath-style field paths the customer
 *      side may never write. Drawn from the issue + the schema spec at
 *      `docs/specs/ai-employee/customer-yaml-schema.md`.
 *
 *   3. A merger (`applyEditableChanges`) that takes a current full YAML
 *      and an `EditableCustomerConfig` and returns the next full YAML.
 *      The merger NEVER writes locked paths even if they appear in the
 *      input — defense in depth against a malformed POST body smuggling
 *      a field name the route forgot to strip.
 *
 *   4. A diff helper (`computeChangedFields`) that produces the list of
 *      JSONPath strings whose values changed between two snapshots. Used
 *      by the audit emission pathway (`customer_yaml_updated`) to record
 *      what shifted without echoing values.
 *
 *   5. A validation pass (`validateEditableChanges`) that surfaces both
 *      lock-violation errors (the input carried a Captain-only field)
 *      and structural errors (after merging, the YAML fails the shared
 *      `src/lib/ai-employee/customer-yaml/` validator).
 *
 * Write-back to git (ADR 0012 §2) is OUT OF SCOPE at v1; the audit log +
 * validation are the customer-side guarantees while the configs-repo
 * write path lands in a follow-on.
 */

import {
  validate,
  type CustomerYaml,
  type Persona,
  type PersonaSkill,
  type ValidationError,
  type ValidationResult,
} from '../../ai-employee/customer-yaml'
import type { CustomerConfigRow } from '../customer-config'

// ============================================================================
// Locked-field policy
// ============================================================================

/**
 * JSONPath-style field paths whose customer-side mutation is rejected.
 * Some entries reference structures that v1 does not yet ship
 * (`safety.sticky_stop.*`); they are listed defensively so the
 * cross-cutting concern is in one place when those structures land.
 *
 *   - Plain dotted paths target a single field.
 *   - `prefix.*` matches any direct child of `prefix`.
 *   - `prefix.*.suffix` matches any direct child whose nested path
 *     completes with `suffix`.
 */
export const LOCKED_FIELD_PATHS: readonly string[] = [
  'schema_version',
  'customer_id',
  'customer_name',
  'vertical',
  'practice_areas',
  'fly_region',
  'model',
  'hermes_ref',
  'machine.size',
  'machine.memory_mb',
  'memory.d1_namespace',
  'memory.r2_vault_path',
  'memory.vectorize_index',
  'connectors.*.token_ref',
  'connectors.*.tenant_id',
  'safety.sticky_stop.*',
] as const

const LOCKED_PATH_SET: ReadonlySet<string> = new Set(LOCKED_FIELD_PATHS)

export function isLockedFieldPath(path: string): boolean {
  if (LOCKED_PATH_SET.has(path)) return true
  for (const locked of LOCKED_FIELD_PATHS) {
    if (locked.includes('*') && matchesWildcard(locked, path)) return true
  }
  return false
}

function matchesWildcard(pattern: string, candidate: string): boolean {
  const patternSegments = pattern.split('.')
  const candidateSegments = candidate.split('.')
  if (patternSegments.length !== candidateSegments.length) return false
  for (let i = 0; i < patternSegments.length; i++) {
    if (patternSegments[i] !== '*' && patternSegments[i] !== candidateSegments[i]) return false
  }
  return true
}

// ============================================================================
// Public types — editable + locked surfaces
// ============================================================================

export interface EditablePersonaSkill {
  name: string
  trust_ceiling: 'autonomous' | 'draft_for_review' | 'refused'
  enabled: boolean
}

export interface EditablePersona {
  slug: string
  status: 'active' | 'archived'
  name: string
  title: string | null
  tone: string[]
  pronouns: 'they/them' | 'he/him' | 'she/her' | null
  send_as: { agentmail_identity: string } | null
  skills: EditablePersonaSkill[]
  channel_bindings: { integration: string; channels: string[] }[]
}

export interface EditableConnector {
  adapter: string
  backend: string
  enabled: boolean
  scopes: string[]
  // token_ref intentionally omitted — locked Captain-only field.
  // tenant_id intentionally omitted — locked Captain-only field (M365 hosted MCPs, #1056).
}

export interface EditableEscalation {
  red_flag_recipients: string[]
  failure_recipients: string[]
  acknowledgement_window_minutes: number | null
}

export interface EditableBusinessHours {
  timezone: string
  days: string[]
  start: string
  end: string
}

export interface EditableScope {
  email_folders_visible: string[]
  email_folders_blind: string[]
  email_keyword_blocks: string[]
  domain_blocks: string[]
  matter_blocks: string[]
}

export interface EditableCustomerConfig {
  personas: EditablePersona[]
  voiceLibrary: { samples_path: string | null }
  escalation: EditableEscalation
  businessHours: EditableBusinessHours | null
  connectors: Record<string, EditableConnector>
  scope: EditableScope
  logging: { level: string; ship_to: string[] } | null
  pause: { active: boolean; reason: string | null } | null
}

export interface LockedFieldsView {
  schema_version: number
  customer_id: string
  customer_name: string
  vertical: string
  practice_areas: string[]
  fly_region: string
  model: string
  hermes_ref: string
  machine: { size: string; memory_mb: number }
  memory: { d1_namespace: string; r2_vault_path: string; vectorize_index: string }
  connector_token_refs: Record<string, string | null>
  connector_tenant_ids: Record<string, string | null>
}

export interface ResolvedEditableConfig {
  editable: EditableCustomerConfig
  locked: LockedFieldsView
}

// ============================================================================
// Projection — CustomerYaml → editor surface
// ============================================================================

export function projectEditableConfig(yaml: CustomerYaml): ResolvedEditableConfig {
  const connectorTokenRefs: Record<string, string | null> = {}
  const connectorTenantIds: Record<string, string | null> = {}
  const editableConnectors: Record<string, EditableConnector> = {}
  for (const [capability, connector] of Object.entries(yaml.connectors)) {
    if (!connector) continue
    connectorTokenRefs[capability] = connector.token_ref
    connectorTenantIds[capability] = connector.tenant_id
    editableConnectors[capability] = {
      adapter: connector.adapter,
      backend: connector.backend,
      enabled: connector.enabled,
      scopes: connector.scopes,
    }
  }
  return {
    editable: projectEditable(yaml, editableConnectors),
    locked: projectLocked(yaml, connectorTokenRefs, connectorTenantIds),
  }
}

function projectEditable(
  yaml: CustomerYaml,
  editableConnectors: Record<string, EditableConnector>
): EditableCustomerConfig {
  return {
    personas: yaml.personas.map(projectPersona),
    voiceLibrary: { samples_path: yaml.voice_library?.samples_path ?? null },
    escalation: { ...yaml.escalation },
    businessHours: yaml.business_hours ? { ...yaml.business_hours } : null,
    connectors: editableConnectors,
    scope: { ...yaml.scope },
    logging: yaml.logging ? { level: yaml.logging.level, ship_to: yaml.logging.ship_to } : null,
    pause: yaml.pause ? { active: yaml.pause.active, reason: yaml.pause.reason } : null,
  }
}

function projectLocked(
  yaml: CustomerYaml,
  connectorTokenRefs: Record<string, string | null>,
  connectorTenantIds: Record<string, string | null>
): LockedFieldsView {
  return {
    schema_version: yaml.schema_version,
    customer_id: yaml.customer_id,
    customer_name: yaml.customer_name,
    vertical: yaml.vertical,
    practice_areas: yaml.practice_areas,
    fly_region: yaml.fly_region,
    model: yaml.model,
    hermes_ref: yaml.hermes_ref,
    machine: yaml.machine,
    memory: yaml.memory,
    connector_token_refs: connectorTokenRefs,
    connector_tenant_ids: connectorTenantIds,
  }
}

function projectPersona(p: Persona): EditablePersona {
  return {
    slug: p.slug,
    status: p.status,
    name: p.name,
    title: p.title,
    tone: p.tone,
    pronouns: p.pronouns,
    send_as: p.send_as,
    skills: p.skills.map((s: PersonaSkill) => ({
      name: s.name,
      trust_ceiling: s.trust_ceiling,
      enabled: s.enabled,
    })),
    channel_bindings: p.channel_bindings,
  }
}

// ============================================================================
// Diff — compute changed field paths between two snapshots
// ============================================================================

/**
 * Compute the JSONPath-style paths whose value differs between two
 * `EditableCustomerConfig` snapshots. Section-level granularity:
 * auditors see "this section moved" — values live in git history per
 * ADR 0012.
 */
export function computeChangedFields(
  before: EditableCustomerConfig,
  after: EditableCustomerConfig
): string[] {
  const changed: string[] = []
  diffPersonas(before.personas, after.personas, changed)
  if (before.voiceLibrary.samples_path !== after.voiceLibrary.samples_path) {
    changed.push('voice_library.samples_path')
  }
  diffEscalation(before.escalation, after.escalation, changed)
  if (JSON.stringify(before.businessHours) !== JSON.stringify(after.businessHours)) {
    changed.push('business_hours')
  }
  diffConnectors(before.connectors, after.connectors, changed)
  diffScope(before.scope, after.scope, changed)
  if (JSON.stringify(before.logging) !== JSON.stringify(after.logging)) changed.push('logging')
  if (JSON.stringify(before.pause) !== JSON.stringify(after.pause)) changed.push('pause')
  return changed
}

function diffPersonas(
  before: EditablePersona[],
  after: EditablePersona[],
  changed: string[]
): void {
  if (before.length !== after.length) {
    changed.push('personas.length')
    return
  }
  for (let i = 0; i < after.length; i++) {
    if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) {
      changed.push(`personas[${i}]`)
    }
  }
}

function diffEscalation(
  before: EditableEscalation,
  after: EditableEscalation,
  changed: string[]
): void {
  if (JSON.stringify(before.red_flag_recipients) !== JSON.stringify(after.red_flag_recipients)) {
    changed.push('escalation.red_flag_recipients')
  }
  if (JSON.stringify(before.failure_recipients) !== JSON.stringify(after.failure_recipients)) {
    changed.push('escalation.failure_recipients')
  }
  if (before.acknowledgement_window_minutes !== after.acknowledgement_window_minutes) {
    changed.push('escalation.acknowledgement_window_minutes')
  }
}

function diffConnectors(
  before: Record<string, EditableConnector>,
  after: Record<string, EditableConnector>,
  changed: string[]
): void {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed.push(`connectors.${key}`)
    }
  }
}

function diffScope(before: EditableScope, after: EditableScope, changed: string[]): void {
  const fields: (keyof EditableScope)[] = [
    'email_folders_visible',
    'email_folders_blind',
    'email_keyword_blocks',
    'domain_blocks',
    'matter_blocks',
  ]
  for (const field of fields) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      changed.push(`scope.${field}`)
    }
  }
}

// ============================================================================
// Hash — deterministic short fingerprint for audit before/after
// ============================================================================

/**
 * 8-char hex fingerprint of an `EditableCustomerConfig` for the audit
 * payload. FNV-1a 32-bit hash over stable JSON serialization. NOT
 * cryptographic; suitable only for "did this snapshot change?" checks.
 */
export function hashEditableConfig(config: EditableCustomerConfig): string {
  const serialized = JSON.stringify(config)
  let hash = 0x811c9dc5
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

// ============================================================================
// Merger — produce next CustomerYaml from current + editor input
// ============================================================================

/**
 * Apply an `EditableCustomerConfig` to a current `CustomerYaml` to
 * produce the next full YAML object. Locked fields are pulled from the
 * current document — the input is IGNORED at those paths even if it
 * carries values. ADR 0011: v1 personas length is exactly 1; the
 * merger truncates the input defensively.
 */
export function applyEditableChanges(
  current: CustomerYaml,
  changes: EditableCustomerConfig
): CustomerYaml {
  const editablePersonas = changes.personas.slice(0, 1)
  const mergedPersonas: Persona[] = current.personas.map((cur, idx) => {
    const next = editablePersonas[idx]
    return next ? mergePersona(cur, next) : cur
  })

  return {
    ...lockedFromCurrent(current),
    personas: mergedPersonas,
    connectors: mergeConnectors(current.connectors, changes.connectors),
    scope: { ...changes.scope },
    escalation: { ...changes.escalation },
    voice_library:
      changes.voiceLibrary.samples_path === null
        ? null
        : { samples_path: changes.voiceLibrary.samples_path },
    // voice_cohorts is not user-editable in the portal yet (#857
    // schema lands the field; in-product editor is a follow-on).
    // Preserve the current value verbatim.
    voice_cohorts: current.voice_cohorts,
    business_hours: changes.businessHours,
    logging: changes.logging
      ? {
          level: changes.logging.level as CustomerYaml['logging'] extends infer L
            ? L extends { level: infer V }
              ? V
              : never
            : never,
          ship_to: changes.logging.ship_to as CustomerYaml['logging'] extends infer L
            ? L extends { ship_to: infer V }
              ? V
              : never
            : never,
        }
      : null,
    pause: changes.pause ? { active: changes.pause.active, reason: changes.pause.reason } : null,
    // webhook_triggers is not user-editable in the portal yet (ADR 0021
    // Stream E lands the field; in-product editor is a follow-on).
    // Preserve the current value verbatim.
    webhook_triggers: current.webhook_triggers,
  }
}

function lockedFromCurrent(
  current: CustomerYaml
): Pick<
  CustomerYaml,
  | 'schema_version'
  | 'customer_id'
  | 'customer_name'
  | 'vertical'
  | 'practice_areas'
  | 'fly_region'
  | 'model'
  | 'hermes_ref'
  | 'machine'
  | 'memory'
  | 'users'
  | 'compliance_enabled'
> {
  return {
    schema_version: current.schema_version,
    customer_id: current.customer_id,
    customer_name: current.customer_name,
    vertical: current.vertical,
    practice_areas: current.practice_areas,
    fly_region: current.fly_region,
    model: current.model,
    hermes_ref: current.hermes_ref,
    machine: current.machine,
    memory: current.memory,
    users: current.users,
    compliance_enabled: current.compliance_enabled,
  }
}

function mergeConnectors(
  current: CustomerYaml['connectors'],
  changes: Record<string, EditableConnector>
): CustomerYaml['connectors'] {
  const merged: CustomerYaml['connectors'] = {}
  for (const [capability, existing] of Object.entries(current)) {
    if (!existing) continue
    const update = changes[capability]
    const key = capability as keyof CustomerYaml['connectors']
    if (!update) {
      merged[key] = existing
      continue
    }
    merged[key] = {
      adapter: update.adapter,
      backend: update.backend,
      enabled: update.enabled,
      scopes: update.scopes,
      // token_ref locked — pulled from current, never from input.
      token_ref: existing.token_ref,
      // composio_connection_id locked — issue #850, isolation enforcement
      // requires this stay bound to the customer slug at provisioning.
      composio_connection_id: existing.composio_connection_id,
      // webhook_url locked — ADR 0021 Stream E, embeds customer_id so
      // changing it via the editor would risk cross-customer routing.
      // Configured at provisioning time, never via portal.
      webhook_url: existing.webhook_url,
      // tenant_id locked — Captain-managed at provisioning (#1056). A
      // customer-side tenant swap would silently re-point an M365 MCP
      // connector at a different tenant's hosted server.
      tenant_id: existing.tenant_id,
    }
  }
  return merged
}

function mergePersona(current: Persona, update: EditablePersona): Persona {
  // Skill list: keep current entries the input did not touch (preserves
  // cost_estimate, scope, version); override trust_ceiling + enabled
  // from input. Editor cannot add or remove skills.
  const updateByName = new Map(update.skills.map((s) => [s.name, s]))
  const mergedSkills: PersonaSkill[] = current.skills.map((cur) => {
    const u = updateByName.get(cur.name)
    return u ? { ...cur, trust_ceiling: u.trust_ceiling, enabled: u.enabled } : cur
  })
  return {
    slug: current.slug,
    status: update.status,
    name: update.name,
    title: update.title,
    tone: update.tone,
    pronouns: update.pronouns,
    send_as: update.send_as,
    channel_bindings: update.channel_bindings,
    skills: mergedSkills,
    signature_html: current.signature_html,
    avatar_url: current.avatar_url,
    voice_overrides: current.voice_overrides,
    escalation_overrides: current.escalation_overrides,
    // bundles + cron are not user-editable in the portal yet (ADR 0021
    // Streams D + B land the schema; in-product editor is a follow-on).
    // Preserve the current values verbatim.
    bundles: current.bundles,
    cron: current.cron,
  }
}

// ============================================================================
// Validation — lock-check + structural validation
// ============================================================================

/**
 * Validate a proposed change. Composes a lock-check (input must not
 * carry any locked field) and a structural pass (the merged YAML must
 * pass the shared `src/lib/ai-employee/customer-yaml/` validator).
 */
export function validateEditableChanges(
  current: CustomerYaml,
  changes: EditableCustomerConfig
): ValidationResult {
  const errors: ValidationError[] = []

  if (changes.personas.length > 1) {
    errors.push({
      code: 'BannedFieldName',
      path: 'personas.length',
      message:
        'personas length cannot exceed 1 at v1 (ADR 0011). Contact Captain to provision a second persona.',
    })
  }

  for (const [capability, connector] of Object.entries(changes.connectors)) {
    const c = connector as unknown as Record<string, unknown>
    if (Object.prototype.hasOwnProperty.call(c, 'token_ref')) {
      errors.push({
        code: 'BannedFieldName',
        path: `connectors.${capability}.token_ref`,
        message: 'token_ref is a Captain-managed field; the customer-side editor cannot change it.',
      })
    }
    if (Object.prototype.hasOwnProperty.call(c, 'tenant_id')) {
      errors.push({
        code: 'BannedFieldName',
        path: `connectors.${capability}.tenant_id`,
        message: 'tenant_id is a Captain-managed field; the customer-side editor cannot change it.',
      })
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return validate(applyEditableChanges(current, changes))
}

// ============================================================================
// Resolver — read projection from D1, produce editor surface
// ============================================================================

/**
 * Read the projection from `customer_configs`, validate the
 * reconstructed shape against the shared validator, and project to
 * the editor surface.
 *
 * Returns the editor surface on success, or a `{ error }` discriminator
 * when the projection payload is structurally invalid. Callers render
 * the page's error state per `docs/style/empty-state-pattern.md`.
 */
export function resolveEditableConfigFromRow(
  row: CustomerConfigRow
): ResolvedEditableConfig | { error: 'invalid_projection'; errors: ValidationError[] } {
  const result = validate(reconstructFromProjection(row))
  if (!result.ok) return { error: 'invalid_projection', errors: result.errors }
  return projectEditableConfig(result.value)
}

/**
 * Reassemble the projection columns into the validator's expected root
 * shape. The projection is lossy at the column level (per-section JSON
 * blobs), so identity/runtime/memory fields are inferred from the row's
 * `customer_slug` plus schema-spec convention. Those inferred fields
 * are LOCKED — the editor never writes them, so the inferred value is
 * read-only display material only.
 */
function reconstructFromProjection(row: CustomerConfigRow): unknown {
  const escalation = (row.escalation as Partial<EditableEscalation> | null) ?? {
    red_flag_recipients: [],
    failure_recipients: [],
  }
  const scope = (row.scope as Partial<EditableScope> | null) ?? {}
  return {
    schema_version: Number(row.schema_version),
    customer_id: row.customer_slug,
    customer_name: row.customer_slug,
    vertical: 'mixed',
    fly_region: 'iad',
    model: 'unknown',
    // 'unknown' was the pre-ADR-0015 sentinel; the validator now enforces
    // the fork-tag pattern, so the placeholder needs to satisfy it. The
    // reconstructed projection has no real ref to point at (the DB row
    // doesn't carry hermes_ref yet); v0.0.0-smd.0 is the unambiguous
    // "no fork ref yet" sentinel within the fork-tag scheme.
    hermes_ref: 'v0.0.0-smd.0',
    machine: { size: 'unknown', memory_mb: 256 },
    users: [],
    personas: row.personas,
    connectors: row.connectors ?? {},
    scope: {
      email_folders_visible: scope.email_folders_visible ?? [],
      email_folders_blind: scope.email_folders_blind ?? [],
      email_keyword_blocks: scope.email_keyword_blocks ?? [],
      domain_blocks: scope.domain_blocks ?? [],
      matter_blocks: scope.matter_blocks ?? [],
    },
    escalation: {
      red_flag_recipients: escalation.red_flag_recipients ?? [],
      failure_recipients: escalation.failure_recipients ?? [],
      acknowledgement_window_minutes: escalation.acknowledgement_window_minutes ?? null,
    },
    voice_library: row.voice_library ?? null,
    voice_cohorts: null,
    business_hours: row.business_hours ?? null,
    memory: {
      d1_namespace: row.customer_slug,
      r2_vault_path: `vaults/${row.customer_slug}/`,
      vectorize_index: `hermes-${row.customer_slug}-vault`,
      retention: null,
    },
  }
}

// ============================================================================
// Audit metadata
// ============================================================================

export interface CustomerYamlAuditMetadata {
  changed_fields: string[]
  before_hash: string
  after_hash: string
  actor_id: string
}

export function buildAuditMetadata(
  before: EditableCustomerConfig,
  after: EditableCustomerConfig,
  actorId: string
): CustomerYamlAuditMetadata {
  return {
    changed_fields: computeChangedFields(before, after),
    before_hash: hashEditableConfig(before),
    after_hash: hashEditableConfig(after),
    actor_id: actorId,
  }
}

/**
 * Emit the audit event to Worker tail logs. Mirrors the
 * `recordSendApprovedAudit` pattern in `send-as.ts` (PR #960): a single
 * `console.info` line prefixed with `audit:customer_yaml_updated` so a
 * Hermes-side drain consumes it and persists to the per-customer D1.
 *
 * The audit fires even on validation failure — the attempt is itself
 * a recorded compliance event. Callers decide whether to emit on
 * failure (the route does, with `status: 'rejected'`).
 */
export async function recordCustomerYamlUpdateAudit(payload: {
  status: 'applied' | 'rejected'
  customer_id: string
  metadata: CustomerYamlAuditMetadata
}): Promise<void> {
  const line = JSON.stringify({ type: 'audit:customer_yaml_updated', ...payload })
  console.info(line)
  return Promise.resolve()
}
