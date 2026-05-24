/**
 * Shared types + accepted-value constants for the customer.yaml validator.
 *
 * Kept in its own module so validator.ts stays under the 500-line ceiling
 * and so consumers (portal projection, test fixtures) can import just
 * the types without pulling the validation logic.
 */

import type { CapabilityName } from '../capabilities/types'

export const ACCEPTED_CAPABILITY_NAMES: ReadonlySet<CapabilityName> = new Set<CapabilityName>([
  'PracticeManagement',
  'Email',
  'Calendar',
  'DocumentStorage',
  'ESign',
  'CourtAccess',
  'Payments',
  'Accounting',
  'IntakeCRM',
  'CallTracking',
  'InternalComms',
])

export const ACCEPTED_VERTICALS = [
  'marketing-agency',
  'law-firm',
  'real-estate',
  'manufacturing',
  'insurance',
  'mixed',
] as const
export type Vertical = (typeof ACCEPTED_VERTICALS)[number]

/**
 * Per-vertical audit-log retention defaults (days). See
 * docs/specs/ai-employee/audit-retention.md §"Per-vertical defaults" for the
 * rationale per vertical. The customer.yaml override (`memory.retention.audit_log_days`)
 * is enforced override-up-only against this table — the supplied value MUST
 * be ≥ the vertical's default.
 */
export const VERTICAL_AUDIT_LOG_DAYS_DEFAULTS: Readonly<Record<Vertical, number>> = {
  'law-firm': 2555,
  'marketing-agency': 1095,
  'real-estate': 2555,
  manufacturing: 2555,
  insurance: 2555,
  mixed: 2555,
} as const

/**
 * Absolute upper bound on `audit_log_days` overrides. Values past this are
 * almost always typos (day-vs-year confusion). 100 years comfortably covers
 * the realistic litigation horizon for every supported vertical.
 */
export const AUDIT_LOG_DAYS_MAX = 36500

export const ACCEPTED_TRUST_CEILINGS = ['autonomous', 'draft_for_review', 'refused'] as const
export type TrustCeiling = (typeof ACCEPTED_TRUST_CEILINGS)[number]

export const ACCEPTED_USER_ROLES = ['principal', 'operator', 'compliance'] as const
export type UserRole = (typeof ACCEPTED_USER_ROLES)[number]

export const ACCEPTED_PERSONA_STATUSES = ['active', 'archived'] as const
export type PersonaStatus = (typeof ACCEPTED_PERSONA_STATUSES)[number]

export const ACCEPTED_PRONOUNS = ['they/them', 'he/him', 'she/her'] as const
export type Pronouns = (typeof ACCEPTED_PRONOUNS)[number]

export const ACCEPTED_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof ACCEPTED_LOG_LEVELS)[number]

export const ACCEPTED_LOG_SHIPS = ['cloudflare-d1', 'fly-logs'] as const
export type LogShip = (typeof ACCEPTED_LOG_SHIPS)[number]

export const ACCEPTED_BACKEND_PREFIXES = ['composio:', 'mcp:', 'build:', 'synthetic:'] as const

export const ACCEPTED_SCHEMA_VERSIONS = [1] as const
export type SchemaVersion = (typeof ACCEPTED_SCHEMA_VERSIONS)[number]

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

/**
 * Base recipient-cohort taxonomy used by Layer 2 voice transform and
 * the blind-test gate (PRD §9.3 Layer 3 + §9.6 Gate 3). Customers may
 * extend this set via `voice_cohorts:` on customer.yaml; the base set
 * is what every customer ships with by default when the field is
 * omitted.
 *
 * Slug names line up with the voice-gate harness
 * (`ai-employee/voice-gate/types.ts :: RecipientCohort`). The harness
 * historically shipped three cohorts (`client`, `opposing-counsel`,
 * `internal-team`); #857 lifts the cohort vocabulary into the schema
 * and adds `court` as the fourth base cohort to match the PRD §17.1
 * cohort framing.
 */
export const BASE_VOICE_COHORTS = ['client', 'opposing-counsel', 'court', 'internal'] as const
export type BaseVoiceCohort = (typeof BASE_VOICE_COHORTS)[number]

export interface CostEstimate {
  tokens_in_per_run: number
  tokens_out_per_run: number
  tool_calls_per_run: number
  runs_per_day_typical: number
}

export interface PersonaSkill {
  name: string
  version: string
  trust_ceiling: TrustCeiling
  enabled: boolean
  cost_estimate: CostEstimate | null
  scope: string[]
}

export interface PersonaSendAs {
  agentmail_identity: string
}

export interface PersonaChannelBinding {
  integration: string
  channels: string[]
}

export interface Persona {
  slug: string
  status: PersonaStatus
  name: string
  title: string | null
  signature_html: string | null
  avatar_url: string | null
  tone: string[]
  pronouns: Pronouns | null
  send_as: PersonaSendAs | null
  skills: PersonaSkill[]
  voice_overrides: unknown
  escalation_overrides: unknown
  channel_bindings: PersonaChannelBinding[]
}

export interface User {
  email: string
  role: UserRole
  full_name: string
  /**
   * Optional per-user voice profile slug. When set, Layer 2 voice transform
   * selects this user's profile (samples tagged with this slug) for any
   * draft attributed to this reviewer. When null, the user inherits the
   * customer-level general voice profile.
   *
   * Distinct from persona (ADR 0011): persona is the AI agent's identity
   * (Marcus); voice_profile_id is the human reviewer's writing voice
   * (Partner Sarah vs. Associate Mike vs. Paralegal Jane). One persona,
   * multiple per-user voices.
   *
   * Slug rules match SLUG_PATTERN: ^[a-z0-9][a-z0-9-]{0,31}$. Slugs are
   * unique within users[] — two users cannot share a voice_profile_id
   * (sharing a profile would defeat the per-user attribution model).
   */
  voice_profile_id: string | null
}

export interface Connector {
  adapter: string
  backend: string
  enabled: boolean
  scopes: string[]
  token_ref: string | null
  /** Composio connection ID for Composio-managed connectors
   * (`backend: composio:*`). Required when backend is composio:, must be
   * absent for other backends. Shape is enforced as `conn_{customer_id}_{suffix}`
   * — see ai-employee/adapter/connectors/composio_assertion.py for the
   * runtime backstop (issue #850). */
  composio_connection_id: string | null
}

export interface Scope {
  email_folders_visible: string[]
  email_folders_blind: string[]
  email_keyword_blocks: string[]
  domain_blocks: string[]
  matter_blocks: string[]
}

export interface Escalation {
  red_flag_recipients: string[]
  failure_recipients: string[]
  acknowledgement_window_minutes: number | null
}

export interface BusinessHours {
  timezone: string
  days: string[]
  start: string
  end: string
}

/**
 * Per-data-type retention windows declared on `customer.yaml.memory.retention.*`.
 * Every field is optional; missing fields fall back to module-level defaults
 * defined by the runtime retention runner (Python: `MemoryRetentionPolicy`).
 *
 * `audit_log_days` is the one field this validator enforces beyond "positive
 * integer" — see docs/specs/ai-employee/audit-retention.md for the override-up-only
 * rules and the vertical-default minimums.
 */
export interface MemoryRetention {
  matters_days: number | null
  documents_days: number | null
  recipients_days: number | null
  voice_samples_days: number | null
  audit_log_days: number | null
  drafts_days: number | null
}

export interface Memory {
  d1_namespace: string
  r2_vault_path: string
  vectorize_index: string
  retention: MemoryRetention | null
}

export interface VoiceLibrary {
  samples_path: string | null
}

/**
 * Voice cohort taxonomy declared on customer.yaml. Drives
 * Layer 2 voice transform's per-cohort selection and the blind-test
 * gate's per-cohort scoring. Source-of-truth for which cohorts the
 * customer's sent folder is partitioned into.
 *
 * Schema rules:
 *   - `cohorts:` is an OPTIONAL list of slugs. Omission means the
 *     customer accepts the base taxonomy (BASE_VOICE_COHORTS).
 *   - When present, the list is the canonical cohort vocabulary for
 *     this customer. It MAY add custom cohorts beyond the base set
 *     (e.g. `expert-witness`, `mediator`), and it MAY drop cohorts
 *     the customer's practice does not use (e.g. a transactional
 *     firm with no `court` cohort). It MUST include at least one slug
 *     when the field is present.
 *   - Each cohort slug must match COHORT_SLUG_PATTERN.
 *   - Cohort slugs must be unique within `voice_cohorts.cohorts[]`.
 *   - `min_samples_per_cohort` overrides the per-cohort floor for the
 *     Layer 2 transform's fallback ladder (per-(user,cohort) →
 *     per-user → general). When omitted the module default applies.
 */
export interface VoiceCohorts {
  cohorts: string[]
  min_samples_per_cohort: number | null
}

export interface Logging {
  level: LogLevel
  ship_to: LogShip[]
}

export interface Pause {
  active: boolean
  reason: string | null
}

export interface MachineSpec {
  size: string
  memory_mb: number
}

export interface CustomerYaml {
  schema_version: SchemaVersion
  customer_id: string
  customer_name: string
  vertical: Vertical
  practice_areas: string[]
  fly_region: string
  model: string
  hermes_ref: string
  machine: MachineSpec
  users: User[]
  personas: Persona[]
  connectors: Partial<Record<CapabilityName, Connector>>
  scope: Scope
  escalation: Escalation
  voice_library: VoiceLibrary | null
  voice_cohorts: VoiceCohorts | null
  business_hours: BusinessHours | null
  memory: Memory
  logging: Logging | null
  pause: Pause | null
}

export type ValidationErrorCode =
  | 'MissingField'
  | 'EmptyField'
  | 'EnumViolation'
  | 'InvalidSlug'
  | 'TypeMismatch'
  | 'MissingActivePersona'
  | 'DuplicatePersonaSlug'
  | 'UnknownCapability'
  | 'TrustCeilingExceeded'
  | 'SecretDetected'
  | 'BannedFieldName'
  | 'InvalidTokenRef'
  | 'IsolationViolation'
  | 'InvalidBackend'
  | 'EmptyList'
  | 'SchemaVersionUnsupported'
  | 'InvalidFormat'
  | 'RetentionOverrideBelowDefault'
  | 'RetentionOverrideUnreasonable'
  | 'DuplicateVoiceProfileId'
  | 'DuplicateVoiceCohort'

export interface ValidationError {
  code: ValidationErrorCode
  path: string
  message: string
}

export type ValidationResult =
  | { ok: true; value: CustomerYaml }
  | { ok: false; errors: ValidationError[] }
