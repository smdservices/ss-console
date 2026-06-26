/**
 * Shared types + accepted-value constants for the customer.yaml validator.
 *
 * Kept in its own module so validator.ts stays under the 500-line ceiling
 * and so consumers (portal projection, test fixtures) can import just
 * the types without pulling the validation logic.
 */

import type { CapabilityName } from '../capabilities/types'
import type { AuthorityPosture } from '../authority'
import type { CredentialCustody } from '../credential-custody'

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
  'veterinary',
  'dental',
  'med-spa',
  'accounting',
  'title',
  'mortgage',
  'ria',
  'property-management',
  'home-services',
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
  insurance: ['commercial'],
  veterinary: ['specialty-er'],
  dental: ['ortho'],
  'med-spa': [],
  accounting: ['bookkeeping'],
  title: [],
  mortgage: [],
  ria: [],
  'property-management': [],
  'home-services': [],
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
  veterinary: 1825,
  dental: 2555,
  'med-spa': 2555,
  accounting: 2555,
  title: 2555,
  mortgage: 2555,
  ria: 2555,
  'property-management': 1825,
  'home-services': 1095,
  mixed: 2555,
} as const

/**
 * Absolute upper bound on `audit_log_days` overrides. Values past this are
 * almost always typos (day-vs-year confusion). 100 years comfortably covers
 * the realistic litigation horizon for every supported vertical.
 */
export const AUDIT_LOG_DAYS_MAX = 36500

export const ACCEPTED_EXPOSURE_CEILINGS = ['autonomous', 'draft_for_review', 'refused'] as const
export type ExposureCeiling = (typeof ACCEPTED_EXPOSURE_CEILINGS)[number]

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
  'code_execution',
] as const
export type ActionClass = (typeof ACCEPTED_ACTION_CLASSES)[number]
export type AuthoredExposureActionClass = Exclude<ActionClass, 'read'>

export interface PersonaEntitlements {
  /**
   * Sparse persona-level exposure map. Missing action classes fail closed at
   * runtime and render as unconfigured in the UI. `read` is deliberately not
   * customer-authored; the enforcement layer always allows read.
   */
  exposure: Partial<Record<AuthoredExposureActionClass, ExposureCeiling>>
}

export interface SkillInitiation {
  manual: boolean
  scheduled: boolean
  webhook: boolean
}

export const ACCEPTED_USER_ROLES = ['principal', 'staff', 'compliance'] as const
export type UserRole = (typeof ACCEPTED_USER_ROLES)[number]

/**
 * Data-handling posture for the Operator ⇄ Claude MCP connector (`mcp_connector`
 * block). Governs which Claude surface entitled data may land in — NOT what a
 * user is entitled to see (that stays fail-closed and inherited; see ADR 0035
 * and docs/design/operator/03-mcp-server-exposure.md §4/§7).
 *
 * - `open` (default): entitled data may flow to the user's authenticated Claude,
 *   personal or firm-controlled. Honors the flexibility posture for orgs
 *   mid-adoption with a mix of personal and firm instances.
 * - `firm_only`: entitled data flows only to an enterprise/team Claude under the
 *   org's terms; personal-account tokens get a reduced surface.
 *
 * Note: privileged-class content (matter documents, work product) crossing into
 * a personal account requires an explicit recorded firm consent even under
 * `open` — enforced where the document-surfacing tools land, not here.
 */
export const ACCEPTED_DATA_POSTURES = ['open', 'firm_only'] as const
export type DataPosture = (typeof ACCEPTED_DATA_POSTURES)[number]

export const ACCEPTED_PERSONA_STATUSES = ['active', 'archived'] as const
export type PersonaStatus = (typeof ACCEPTED_PERSONA_STATUSES)[number]

export const ACCEPTED_PRONOUNS = ['they/them', 'he/him', 'she/her'] as const
export type Pronouns = (typeof ACCEPTED_PRONOUNS)[number]

export const ACCEPTED_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof ACCEPTED_LOG_LEVELS)[number]

export const ACCEPTED_LOG_SHIPS = ['cloudflare-d1', 'fly-logs'] as const
export type LogShip = (typeof ACCEPTED_LOG_SHIPS)[number]

export const ACCEPTED_BACKEND_PREFIXES = ['mcp:', 'build:', 'synthetic:'] as const

/**
 * Google credential mode for the optional top-level `google_auth.mode`
 * (ADR 0035; connector dispatch shipped in ss-console #1212, boot wiring #1213).
 *
 * Both modes are served by the ADR 0045 Workspace broker — the agent never holds
 * the Google credential and there is no connector CLI. Gmail/Calendar/Drive are
 * the governed `workspace_*` tools, not `connectors[]` entries.
 * - `user_oauth` — authorized-user token (`GOOGLE_TOKEN_JSON`) materialized into
 *   the broker-owned credential file; the broker's authorized-user branch loads it.
 * - `dwd` — service-account key (`GOOGLE_SERVICE_ACCOUNT_JSON`) with domain-wide
 *   delegation. The broker impersonates `google_auth.subject` (and any authored
 *   `managed_mailboxes`) at `google_auth.scopes` via its service-account branch.
 */
export const ACCEPTED_GOOGLE_AUTH_MODES = ['user_oauth', 'dwd'] as const
export type GoogleAuthMode = (typeof ACCEPTED_GOOGLE_AUTH_MODES)[number]

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
  initiation: SkillInitiation
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
  entitlements: PersonaEntitlements
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
  /**
   * Per-connector credential custody (ADR 0042). `null` ⇒ inherit the
   * client-level `credential_custody_default`. An explicit value pins this
   * connector: `delegated` (SMD can read/rotate or drive re-consent) or
   * `self_held` (only the client can re-establish; SMD cannot reach the
   * secret). The resolver + semantics live in
   * src/lib/operator/credential-custody.ts.
   */
  credential_custody: CredentialCustody | null
}

/**
 * Google credential selection for the customer's Operator (ADR 0035 / ADR 0045).
 * Optional top-level block; absent ⇒ user-OAuth.
 *
 * Modeled here rather than per-connector because ONE Google identity is shared
 * across Gmail (read by the inbox-triage skill via the broker `workspace_gmail_*`
 * tools), Calendar, and Drive — and Google is NOT a `connectors[]` entry. The
 * ADR 0045 Workspace broker holds the credential and serves the governed
 * `workspace_*` tools; the agent never holds the credential and there is no
 * connector CLI. The broker reads `mode` + `subject` + `scopes` (and any
 * `managed_mailboxes`) from this block to build domain-wide-delegation
 * credentials per operation.
 */
/**
 * A second mailbox (beyond `google_auth.subject`) the Operator is authored to
 * act on, the way a human executive assistant manages a principal's inbox in
 * addition to their own. The same domain-wide-delegation service account
 * impersonates this `address` per-operation; `address` MUST be the user's
 * primary Workspace email (Google rejects impersonation of an alias).
 *
 * `send_as` is the Gmail "Send mail as" allowlist — the identities the Operator
 * may place in the `From` header when drafting/sending from this mailbox (e.g.
 * the primary plus its account aliases). It is distinct from `PersonaSendAs`,
 * which is Crane's own AgentMail channel identity.
 *
 * The broker is the authorization boundary: it re-validates the requested
 * impersonation subject against the authored `address` set and the requested
 * `From` against this `send_as` list before building credentials. Authoring a
 * managed mailbox is the ONLY thing that lets the Operator reach it; absence is
 * fail-closed.
 */
export interface ManagedMailbox {
  /** Primary Workspace email to impersonate for this mailbox (never an alias). */
  address: string
  /** Gmail "Send mail as" identities permitted in the `From` header for this mailbox. */
  send_as: string[]
}

export interface GoogleAuth {
  mode: GoogleAuthMode
  /** Email to impersonate; required (non-null) for `dwd`, null for `user_oauth`. */
  subject: string | null
  /** OAuth scopes the DWD service account requests; non-empty for `dwd`, [] otherwise. */
  scopes: string[]
  /**
   * Additional mailboxes the Operator may act on beyond `subject`
   * (managed-mailbox capability). Empty for `user_oauth` and when unauthored.
   * Only valid under `mode: dwd` — the DWD service account can impersonate any
   * authored address in the Workspace.
   */
  managed_mailboxes: ManagedMailbox[]
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
  /** Senders allowed to trigger autonomous reply from crane's own inbox. */
  inbound_allow_from: string[]
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

/**
 * One person the Operator works with, as authored in the `relationship:` block
 * (ADR 0048). This is the **authored behavioral lane** of the relationship
 * model — standing, human-reviewed preferences for HOW to work with a specific
 * person. It is deliberately constrained:
 *
 *   - **Informational only (ADR 0048 §2c).** Preferences shape how the Operator
 *     drafts and helps; they NEVER grant capability or autonomy. Entitlements
 *     stay authored in `scope:`/`escalation:` and enforced in code
 *     (`trust_ceiling.enforce()`). A `prefers:` line that reads like an
 *     entitlement grant ("auto-send routine confirmations") changes nothing the
 *     agent is permitted to do — `enforce()` remains the only gate.
 *   - **Not the style lane (ADR 0048 §2d).** Greeting/sign-off/honorific/lexical
 *     STYLE corrections live in `voice_corrections` (migration 0010), read at
 *     transform time. This block must NOT duplicate them — keep it to behavioral
 *     working preferences (how someone likes to receive information, what they
 *     care about), not how a draft is phrased.
 */
export interface RelationshipPerson {
  /** Stable per-person key (kebab-case). Ideally matches the person's
   * `voice_corrections.reviewer_user_id` so the style and authored lanes compose
   * per-person on the relationship surface. */
  id: string
  /** Display name shown to the Operator and on the relationship surface. */
  name: string
  /** The person's role/title for context (e.g. "Managing partner"). `null`
   * when unauthored. */
  role: string | null
  /** Free-text working preferences — how this person likes to be worked with.
   * Authored, human-reviewed (so not subject to the runtime-fabrication ban —
   * this is engagement-authored config, the sanctioned source). */
  prefers: string[]
  /** Free-text things to avoid when working with this person. */
  avoid: string[]
}

/**
 * Authored behavioral lane of the relationship model (`relationship:` block,
 * ADR 0048). Per-person standing preferences, materialized by the overlay into
 * each persona's `SOUL.md` (so the Operator actually works the authored way) and
 * surfaced read-only on the admin relationship view. Absent block ⇒
 * `{ people: [] }`. See {@link RelationshipPerson} for the binding policies.
 */
export interface Relationship {
  people: RelationshipPerson[]
}

/**
 * One authored user → profile binding for the Operator ⇄ Claude MCP connector.
 * `email` MUST match a `users[]` entry; `profile` MUST match an active persona
 * slug. This is the per-user seam: the pilot authors exactly one, multi-user
 * orgs author more (and walled principals get distinct profiles per the
 * memory-wall rule — see docs/design/operator/03-mcp-server-exposure.md §4.3).
 */
export interface McpConnectorAccess {
  email: string
  profile: string
  clerk_subject?: string
  clerk_subjects?: string[]
}

/**
 * Operator ⇄ Claude MCP connector (`mcp_connector:` block) — lets authored org
 * users reach this Operator from inside their own Claude (claude.ai / Claude
 * Desktop) over a remote MCP server. Phase 1 is hosted console-side; see
 * docs/design/operator/03-mcp-server-exposure.md.
 *
 * Fail-closed: an absent block (or `enabled: false`) means the connector is off
 * and no user can reach the Operator through Claude. `access` with no entry for
 * a given user means that user reaches nothing.
 *
 * Deliberately minimal for Phase 1: `authority_mode`, `access_map`, and group
 * modes are seated in the design but NOT authored here until a second principal
 * exists. `port` is a deployment constant, not per-customer config.
 */
export interface McpConnector {
  enabled: boolean
  data_posture: DataPosture
  access: McpConnectorAccess[]
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
  /**
   * The seat's main model — the conversation and every in-line skill run on it
   * (ADR 0049). `escalation_model` is the optional second tier.
   */
  model: string
  /**
   * Optional escalate-up model (ADR 0049). When set, materialized into Hermes'
   * native `delegation` block so any skill that calls `delegate_task` runs the
   * heavy reasoning on this model while the seat's main model stays light.
   * `null` ⇒ no second tier; delegated work inherits the main model.
   */
  escalation_model: string | null
  hermes_ref: string
  machine: MachineSpec
  users: User[]
  personas: Persona[]
  connectors: Partial<Record<CapabilityName, Connector>>
  /**
   * Google credential mode (ADR 0035 / #1213). `null` ⇒ user-OAuth default
   * (today's behavior). When `{ mode: 'dwd', ... }`, bootstrap materializes the
   * impersonation subject + scopes as env so the connectors' service-account
   * branch runs instead of reading a relayed authorized-user token.
   */
  google_auth: GoogleAuth | null
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
  /**
   * Authority posture (ADR 0041) — per-domain client-self-serve switches over
   * SMD's always-present full control. Always non-null on a validated
   * CustomerYaml: an absent block resolves to the launch default
   * (`{ default: 'managed', overrides: {} }`) via `checkAuthority`. The
   * resolved-side contract and resolver live in src/lib/operator/authority.ts.
   */
  authority: AuthorityPosture
  /**
   * Client-level default credential custody (ADR 0042). Applies to every
   * connector whose own `credential_custody` is null. Defaults to `delegated`
   * when the field is absent. Per-connector values override it. The resolver
   * is `resolveCredentialCustody` in src/lib/operator/credential-custody.ts.
   */
  credential_custody_default: CredentialCustody
  /**
   * Operator ⇄ Claude MCP connector (Phase 1). Always non-null on a validated
   * CustomerYaml: an absent `mcp_connector:` block resolves to
   * `{ enabled: false, data_posture: 'open', access: [] }` via
   * `checkMcpConnector`. Fail-closed — see {@link McpConnector}.
   */
  mcp_connector: McpConnector
  /**
   * Authored behavioral lane of the relationship model (ADR 0048). Always
   * non-null on a validated CustomerYaml: an absent `relationship:` block
   * resolves to `{ people: [] }` via `checkRelationship`. Materialized by the
   * overlay into each persona's `SOUL.md`; surfaced read-only on the admin
   * relationship view via the `config_export` seam. See {@link Relationship}.
   */
  relationship: Relationship
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
  | 'LegacyEntitlementField'
  | 'UnknownAuthorityDomain'
  | 'DuplicateRelationshipPersonId'

export interface ValidationError {
  code: ValidationErrorCode
  path: string
  message: string
}

export type ValidationResult =
  | { ok: true; value: CustomerYaml }
  | { ok: false; errors: ValidationError[] }
