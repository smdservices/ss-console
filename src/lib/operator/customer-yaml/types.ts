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
 * Vertical-pack add-on registry — per ADR 0022 §"Properties of the vertical
 * model" bullet 3 (cross-vertical add-on composition is supported).
 *
 * Each entry maps a vertical to the add-on slugs that may legally appear in
 * `customer.yaml.addons[]` under `<vertical>/<addon>@<semver>`. Customers
 * subscribe to one vertical plus zero or more add-ons; add-ons are namespaced
 * by their origin vertical for provenance.
 *
 * `law-firm` declares the `pi` add-on in its contract; the vertical pack that
 * implements it is built separately (ADR 0022). Add-ons append to this map as
 * their packs land; no inheritance machinery in v1 (ADR 0022 §"Flat manifest
 * in v1").
 */
export const ACCEPTED_ADDONS: Readonly<Record<Vertical, readonly string[]>> = {
  'law-firm': ['pi'],
  'marketing-agency': [],
  'real-estate': [],
  manufacturing: [],
  insurance: [],
  mixed: [],
} as const

/**
 * Semver pattern accepted in `vertical:` (pinned form) and `addons[]` entries.
 * Restricted to MAJOR.MINOR.PATCH — no pre-release or build-metadata suffixes
 * in v1 to keep the substrate's parsing surface small.
 *
 * The version pin is opt-in: bare `vertical: law-firm` continues to work for
 * back-compat. Pinned form `vertical: law-firm@1.4.0` is required once a
 * customer is bound to a specific vertical-pack release (see ADR 0022
 * §"Properties of the vertical model" bullet 5).
 */
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/

/**
 * Parsed addon-spec produced by `checkAddons`. The pinned-vertical equivalent
 * lives on `CustomerYaml.vertical_version`.
 */
export interface AddonSpec {
  vertical: Vertical
  addon: string
  version: string
}

/**
 * Materialization-event source for `customer_config_history` rows
 * (per ADR 0022 Stream 3). Lives in shared types so PR 3 can wire the enum
 * into `src/lib/portal/customer-config.ts` without circular imports.
 *
 * - `manual` — Captain-initiated sync from the admin portal.
 * - `ci` — automatic sync from the canonical configs repo's CI job.
 * - `drift-repair` — drift-cron re-sync; exempt from the no-op check so the
 *   audit trail of repair runs is always recorded even on identical SHA.
 * - `bootstrap` — initial sync at Machine provisioning time.
 */
export const SYNC_SOURCES = ['manual', 'ci', 'drift-repair', 'bootstrap'] as const
export type SyncSource = (typeof SYNC_SOURCES)[number]

/**
 * Per-vertical audit-log retention defaults (days). See
 * docs/specs/operator/audit-retention.md §"Per-vertical defaults" for the
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

/**
 * Action classes a tool call is categorized into, mirroring the Python
 * `ActionClass` enum in `operator/adapter/trust_ceiling.py`. Per ADR 0025,
 * autonomy is enforced as a configurable ceiling **per action class** rather
 * than one scalar applied to the whole skill — splitting the exposure axis
 * (external_send) from the initiation and internal axes.
 *
 * The values must stay byte-identical to the Python enum's `.value` strings;
 * the overlay materializer (`hermes-smd bootstrap`) carries this map across
 * the seam to the runtime `enforce()` call.
 */
export const ACCEPTED_ACTION_CLASSES = [
  'read',
  'internal_write',
  'external_send',
  'commitment',
  'destructive',
] as const
export type ActionClass = (typeof ACCEPTED_ACTION_CLASSES)[number]

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

export const ACCEPTED_BACKEND_PREFIXES = ['mcp:', 'build:', 'synthetic:'] as const

export const ACCEPTED_SCHEMA_VERSIONS = [1] as const
export type SchemaVersion = (typeof ACCEPTED_SCHEMA_VERSIONS)[number]

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

/**
 * Wake-policy values for per-skill cron schedules. Hermes cron supports a
 * pre-run script that emits `{"wakeAgent": false}` to skip LLM inference
 * when nothing changed. ADR 0021 Stream B leverages this for watcher skills.
 *
 * - `always` — Hermes invokes the agent on every scheduled tick. No pre-run
 *   script is invoked. Equivalent to omitting `pre_run` entirely.
 * - `pre_run_decides` — the pre-run script's stdout JSON drives the
 *   wakeAgent decision. ADR 0021 Stream B requires the pre-run script also
 *   emit an `audit_action="suppressed_wake"` row when it returns wakeAgent
 *   false; audit-write failure forces fallback to wake.
 */
export const ACCEPTED_WAKE_POLICIES = ['always', 'pre_run_decides'] as const
export type WakePolicy = (typeof ACCEPTED_WAKE_POLICIES)[number]

/**
 * Cron schedule expression families accepted in `personas[].cron[].schedule`.
 * Mirrors the Hermes cron-skill schedule grammar documented at
 * https://hermes-agent.nousresearch.com/docs/user-guide/features/cron:
 *   - cron expression (5 fields, e.g. "0 9 * * *")
 *   - interval (e.g. "every 30m", "every 2h")
 *   - relative delay (e.g. "30m", "2h", "1d")
 *   - ISO timestamp (e.g. "2026-03-15T09:00:00")
 *
 * The validator accepts any of these shapes via a permissive structural
 * check; the runtime cron daemon performs the authoritative parse.
 */
const CRON_EXPR_RE = /^(\S+\s+){4}\S+$/
const CRON_INTERVAL_RE = /^every\s+\d+\s*[smhdw]$/i
const CRON_DELAY_RE = /^\d+\s*[smhdw]$/i
const CRON_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export function isAcceptedCronSchedule(s: string): boolean {
  return (
    CRON_EXPR_RE.test(s) || CRON_INTERVAL_RE.test(s) || CRON_DELAY_RE.test(s) || CRON_ISO_RE.test(s)
  )
}

/**
 * Webhook URL pattern enforced on `connectors[].webhook_url`. The URL must
 * point to the customer's own Fly Machine — cross-customer leakage vector
 * if it ever points elsewhere (see ADR 0009). Capability slug is
 * lower-snake (e.g. "practice_management", "email").
 */
export const WEBHOOK_URL_PATTERN =
  /^https:\/\/hermes-([a-z0-9][a-z0-9-]{0,31})\.fly\.dev\/webhooks\/[a-z_]+$/

/**
 * Base recipient-cohort taxonomy used by Layer 2 voice transform and
 * the blind-test gate (PRD §9.3 Layer 3 + §9.6 Gate 3). Customers may
 * extend this set via `voice_cohorts:` on customer.yaml; the base set
 * is what every customer ships with by default when the field is
 * omitted.
 *
 * Slug names line up with the voice-gate harness
 * (`operator/voice-gate/types.ts :: RecipientCohort`). The harness
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
  /**
   * Skill-level scalar ceiling. Governs `internal_write` and acts as the
   * cap the per-action overrides resolve under. Retained from the
   * pre-ADR-0025 schema for back-compat: a skill with only `trust_ceiling`
   * set keeps its previous meaning, and `external_send` stays at the safe
   * `draft_for_review` default (reviewer-as-sender) unless explicitly raised
   * in `action_ceilings`.
   */
  trust_ceiling: TrustCeiling
  /**
   * Per-action-class ceiling overrides (ADR 0025). Optional and sparse —
   * only the classes a customer wants to set explicitly appear. The runtime
   * `enforce()` resolves the effective ceiling for an action as the most
   * restrictive of {vertical floor, this override if present, the safe
   * class default}. Setting `external_send: autonomous` here is what grants
   * autonomous external send; it can never raise above a vertical-pack floor.
   * `null`/absent means "no overrides — use safe class defaults."
   */
  action_ceilings: Partial<Record<ActionClass, TrustCeiling>> | null
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

/**
 * Skill bundle declaration. Hermes ships skill bundles natively
 * (`~/.hermes/skill-bundles/<slug>.yaml`) — multiple skills load under one
 * slash command. ADR 0021 Stream D wires three bundles per persona:
 * `/pi-intake`, `/pi-matter-prep`, `/weekly-client-pulse`.
 *
 * The `hermes-smd bootstrap` CLI (overlay) translates this entry into the
 * per-profile `~/.hermes/skill-bundles/<slug>.yaml` file at Machine boot.
 *
 * Validation rules:
 *   - `slug` matches SLUG_PATTERN; unique within the persona's bundles[]
 *   - `skills[]` non-empty; each entry must reference an enabled skill
 *     declared on the same persona
 *   - `description` required, max 200 chars
 *   - `instruction` optional shared context prepended to all bundled skill
 *     invocations (the Hermes bundle `instruction:` field)
 */
export interface PersonaBundle {
  slug: string
  description: string
  skills: string[]
  instruction: string | null
}

/**
 * Per-skill cron schedule for a persona. ADR 0021 Stream B leverages
 * Hermes' built-in cron-skill attachment with a pre-run script that can
 * emit `{"wakeAgent": false}` to skip LLM inference when nothing changed.
 *
 * Validation rules:
 *   - `skill` must reference a skill declared on the same persona
 *   - `schedule` parseable per `isAcceptedCronSchedule` (cron expr,
 *     interval, delay, or ISO timestamp)
 *   - `pre_run` is an OPTIONAL path (relative to the skill directory) to
 *     the pre-run script. When set, `wake_policy` MUST be
 *     `pre_run_decides`; when null, `wake_policy` MUST be `always`.
 *   - `wake_policy` one of WakePolicy
 */
export interface PersonaCron {
  skill: string
  schedule: string
  pre_run: string | null
  wake_policy: WakePolicy
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
  // Free-form per-persona override blobs (object or absent). Typed as an object
  // map rather than `unknown` so the validator can gate them to plain-object /
  // null — a malformed scalar is rejected, not silently carried. Their internal
  // shape is deliberately open; no consumer destructures them today, so
  // structuring is a future change for when one does.
  voice_overrides: Record<string, unknown> | null
  escalation_overrides: Record<string, unknown> | null
  channel_bindings: PersonaChannelBinding[]
  /** Skill bundles declared by this persona — ADR 0021 Stream D. */
  bundles: PersonaBundle[]
  /** Per-skill cron schedules with optional no-agent pre-run — ADR 0021 Stream B. */
  cron: PersonaCron[]
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
  /**
   * Outbound webhook URL the connector's vendor pushes events to. ADR 0021
   * Stream E wires Filevine/Clio matter-created and document-added webhooks
   * through Hermes' `pre_gateway_dispatch` hook (handled by the overlay's
   * `hermes-smd-webhook-router` plugin).
   *
   * URL pattern: `https://hermes-{customer_id}.fly.dev/webhooks/{capability_slug}`.
   * The validator enforces that the `{customer_id}` embedded in the URL
   * matches the document's `customer_id` — cross-customer leakage vector
   * if it ever doesn't (ADR 0009).
   *
   * Null when the connector is pull-only (no vendor push events configured).
   */
  webhook_url: string | null
}

/**
 * Top-level webhook trigger mapping. ADR 0021 Stream E uses this to route
 * inbound webhook payloads (from `connectors[].webhook_url`) to a specific
 * skill invocation on a specific persona via the overlay's
 * `hermes-smd-webhook-router` plugin.
 *
 * Validation rules:
 *   - `source` must match one of the customer's connector adapters
 *     (so e.g. `source: "filevine"` only validates when a connector with
 *     `adapter: "filevine"` exists)
 *   - `event_type` is opaque to the validator — the source vendor defines
 *     it (e.g. `matter.created`, `document.added`). Must be a non-empty
 *     string.
 *   - `skill` must reference a skill declared on the target persona
 *   - `persona` must reference a persona declared on the customer
 */
export interface WebhookTrigger {
  source: string
  event_type: string
  skill: string
  persona: string
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
 * integer" — see docs/specs/operator/audit-retention.md for the override-up-only
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
  /**
   * R2 bucket and key prefix where the audit plugin persists agent-authored
   * skill bodies (ADR 0022 Stream 2). Both are OPTIONAL in the schema —
   * populated at customer bootstrap time, never authored by hand. PR 1
   * declares them as known-optional so PR 2 can consume them without
   * amending the validator.
   *
   * - `r2_skill_bodies_bucket` — the bucket name. Shared-bucket model uses
   *   `smd-operator-skill-bodies` (Captain default); per-customer model
   *   uses `ss-operator-<customer_id>-skills`.
   * - `r2_skill_bodies_prefix` — the customer's key prefix within the
   *   bucket. Shared-bucket model uses `<customer_id>/`; per-customer
   *   bucket uses empty string.
   *
   * See ADR 0022 §"Captain decision to reconfirm before PR 2 opens" and
   * the approved plan §"R2 bucket model."
   */
  r2_skill_bodies_bucket: string | null
  r2_skill_bodies_prefix: string | null
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

/**
 * Observability block — added by ADR 0023 Wave 1.
 *
 * All fields are optional with documented defaults. Defaults are filled in
 * by `checkObservability` on read so consumers can always assume the full
 * shape is present.
 */
export interface Observability {
  sentry: { enabled: boolean }
  health: { period_seconds: number; grace_minutes: number }
}

export const OBSERVABILITY_DEFAULTS: Observability = {
  sentry: { enabled: true },
  health: { period_seconds: 60, grace_minutes: 5 },
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
  /**
   * Pinned vertical-pack version when `vertical:` is authored in pinned form
   * (`law-firm@1.4.0`). `null` when authored in bare form (`law-firm`) —
   * back-compat for customers not yet bound to a specific pack release.
   * Per ADR 0022 §"Properties of the vertical model" bullet 5.
   */
  vertical_version: string | null
  /**
   * Add-on packs the customer subscribes to. Empty array when the customer
   * uses only the vertical defaults. Each entry parsed from
   * `<vertical>/<addon>@<semver>`; cross-vertical composition allowed
   * (e.g. a `law-firm` customer can subscribe to `accounting/bookkeeping`
   * once that pack ships). Per ADR 0022 §"Properties of the vertical model"
   * bullet 3.
   */
  addons: AddonSpec[]
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
  /**
   * Observability block — added by ADR 0023 Wave 1. Always non-null on a
   * validated CustomerYaml; defaults are filled in by `checkObservability`
   * when the block is absent or partially populated.
   */
  observability: Observability
  /**
   * Inbound webhook → skill trigger map — ADR 0021 Stream E. Empty array
   * when no connector exposes a webhook_url.
   */
  webhook_triggers: WebhookTrigger[]
  /**
   * Whether the Compliance dashboard view is enabled for this firm.
   *
   * Defaults to `false` when the field is omitted. Sub-50-attorney PI
   * firms typically don't retain ethics counsel, so the Compliance role
   * is folded into the principal. When `false`, users with the
   * `compliance` product_role still authenticate and can hit the audit
   * surface (RBAC unchanged), but the dedicated Compliance dashboard
   * view does NOT render — the firm has not opted in to the separation
   * of duties this view represents.
   *
   * When `true`, the Compliance dashboard view is the primary surface
   * for compliance-role users: audit log entry, evidence packet
   * generation, retention controls. The principal can see it too as a
   * read-only summary.
   *
   * Wiring this through customer.yaml (rather than auto-deriving from
   * "does any user have role: compliance") preserves the explicit-config
   * posture: separation of duties is a deliberate firm decision, not a
   * side effect of seat provisioning.
   */
  compliance_enabled: boolean
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
  | 'DuplicateBundleSlug'
  | 'UnknownBundleSkill'
  | 'InvalidCronSchedule'
  | 'UnknownCronSkill'
  | 'InvalidCronWakePolicy'
  | 'UnknownWebhookSource'
  | 'UnknownWebhookPersona'
  | 'UnknownWebhookSkill'
  | 'InvalidWebhookUrl'
  | 'ExtendsReserved'
  | 'InvalidVerticalSpec'
  | 'InvalidAddonSpec'
  | 'UnknownAddon'
  | 'InvalidActionClass'
  | 'InvalidActionCeiling'

export interface ValidationError {
  code: ValidationErrorCode
  path: string
  message: string
}

export type ValidationResult =
  | { ok: true; value: CustomerYaml }
  | { ok: false; errors: ValidationError[] }
