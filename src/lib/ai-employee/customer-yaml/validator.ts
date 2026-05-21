/**
 * customer.yaml structural validator.
 *
 * Consumes the parsed YAML as an `unknown` (the consumer chooses its YAML
 * parser — portal and Hermes each parse independently per ADR 0012 §4) and
 * returns a tagged-union ValidationResult: `ok` carries a typed CustomerYaml,
 * `err` carries a list of ValidationError entries.
 *
 * Hand-rolled rather than zod/valibot for three reasons:
 *   1. The contract is small enough that a 400-line explicit validator reads
 *      better than a 60-line schema declaration whose semantics the reader
 *      has to translate back to docs.
 *   2. The error shape we need (typed `code`, JSONPath, no-echo for secrets)
 *      is awkward to retrofit onto a schema library's error format.
 *   3. Zero dependencies. The Worker bundle already has no schema lib; adding
 *      one for this single use site doesn't pay for itself.
 *
 * Aligned with docs/specs/ai-employee/customer-yaml-schema.md (#790).
 */

import type { CapabilityName } from '../capabilities/types'
import {
  scanParsedValue,
  scanRawYaml,
  type SecretFinding,
  type ScanOptions,
} from './secret-detector'

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

/** Capability names accepted by `connectors:` — the closed union from
 * src/lib/ai-employee/capabilities/types.ts. */
const ACCEPTED_CAPABILITY_NAMES: ReadonlySet<CapabilityName> = new Set<CapabilityName>([
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

/** The validator's typed output shape on success. Mirrors the schema spec.
 *
 * Optional fields are typed `T | null` rather than `T | undefined` because
 * YAML round-trips translate absence to null naturally; callers that want
 * the typed-optional shape can map at the call site. */
export interface PersonaSkill {
  name: string
  version: string
  trust_ceiling: TrustCeiling
  enabled: boolean
  cost_estimate: CostEstimate | null
  scope: string[]
}

export interface CostEstimate {
  tokens_in_per_run: number
  tokens_out_per_run: number
  tool_calls_per_run: number
  runs_per_day_typical: number
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
}

export interface Connector {
  adapter: string
  backend: string
  enabled: boolean
  scopes: string[]
  token_ref: string | null
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

export interface Memory {
  d1_namespace: string
  r2_vault_path: string
  vectorize_index: string
}

export interface VoiceLibrary {
  samples_path: string | null
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

export interface ValidationError {
  code: ValidationErrorCode
  path: string
  message: string
}

export type ValidationResult =
  | { ok: true; value: CustomerYaml }
  | { ok: false; errors: ValidationError[] }

/** Options accepted by `validate()`. */
export interface ValidateOptions {
  /** Raw YAML text. When provided, scanRawYaml runs as the first pass so a
   * malformed structural shape still fails closed on a leaked secret. */
  rawText?: string
  /** Forwarded to the secret detector. */
  scanOptions?: ScanOptions
}

// -----------------------------------------------------------------------------
// Validator
// -----------------------------------------------------------------------------

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/

/**
 * Validate a parsed customer.yaml object.
 *
 * The validator never throws. All structural and policy violations are
 * collected and returned as a flat list. Authors see every error in one
 * pass rather than fixing one and re-running.
 */
export function validate(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const errors: ValidationError[] = []

  // Phase 1: raw-text secret scan (when raw text supplied). Fails closed on
  // malformed-YAML-containing-a-secret. Findings become errors.
  if (typeof options.rawText === 'string') {
    const rawFindings = scanRawYaml(options.rawText, options.scanOptions)
    for (const f of rawFindings) {
      errors.push(secretFindingToError(f))
    }
  }

  // Phase 2: structural shape. If `input` is not a plain object, every
  // subsequent check would just emit TypeMismatch — emit one and bail.
  if (!isPlainObject(input)) {
    errors.push({
      code: 'TypeMismatch',
      path: '$',
      message: 'customer.yaml must parse to an object at the root',
    })
    return { ok: false, errors }
  }
  const root = input as Record<string, unknown>

  // Phase 3: parsed-value secret scan. This catches anything the raw scan
  // missed (block scalars, anchors, multi-line strings) and gives us
  // JSONPath context for findings.
  const parsedFindings = scanParsedValue(root, '', options.scanOptions)
  for (const f of parsedFindings) {
    errors.push(secretFindingToError(f))
  }

  // ---------- Identity ----------
  const schemaVersion = checkSchemaVersion(root, errors)
  const customerId = checkCustomerId(root, errors)
  checkRequiredString(root, 'customer_name', errors)
  const vertical = checkEnum(root, 'vertical', ACCEPTED_VERTICALS, errors)
  const practiceAreas = checkPracticeAreas(root, vertical, errors)
  checkRequiredString(root, 'fly_region', errors)

  // ---------- Runtime ----------
  checkRequiredString(root, 'model', errors)
  checkRequiredString(root, 'hermes_ref', errors)
  const machine = checkMachine(root, errors)

  // ---------- Humans ----------
  const users = checkUsers(root, errors)

  // ---------- Personas (array, length ≥ 1, ≥ 1 active, slugs unique) ----------
  const personas = checkPersonas(root, errors)

  // ---------- Connectors ----------
  const connectors = checkConnectors(root, errors)

  // ---------- Scope ----------
  const scope = checkScope(root, errors)

  // ---------- Escalation ----------
  const escalation = checkEscalation(root, errors)

  // ---------- Memory (isolation invariants) ----------
  const memory = checkMemory(root, customerId, errors)

  // ---------- Optional sections ----------
  const voiceLibrary = checkVoiceLibrary(root, errors)
  const businessHours = checkBusinessHours(root, errors)
  const logging = checkLogging(root, errors)
  const pause = checkPause(root, errors)

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  // All checks passed — assemble the typed output. We can assert non-null on
  // values guarded above because we early-returned on errors.length > 0.
  const value: CustomerYaml = {
    schema_version: schemaVersion as SchemaVersion,
    customer_id: customerId as string,
    customer_name: root['customer_name'] as string,
    vertical: vertical as Vertical,
    practice_areas: practiceAreas,
    fly_region: root['fly_region'] as string,
    model: root['model'] as string,
    hermes_ref: root['hermes_ref'] as string,
    machine: machine as MachineSpec,
    users,
    personas,
    connectors,
    scope,
    escalation,
    voice_library: voiceLibrary,
    business_hours: businessHours,
    memory: memory as Memory,
    logging,
    pause,
  }
  return { ok: true, value }
}

// -----------------------------------------------------------------------------
// Section validators
// -----------------------------------------------------------------------------

function checkSchemaVersion(root: Record<string, unknown>, errors: ValidationError[]): number | 0 {
  const v = root['schema_version']
  if (v === undefined || v === null) {
    errors.push({
      code: 'MissingField',
      path: 'schema_version',
      message: 'schema_version is required (must be 1)',
    })
    return 0
  }
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'schema_version',
      message: 'schema_version must be an integer',
    })
    return 0
  }
  if (!(ACCEPTED_SCHEMA_VERSIONS as readonly number[]).includes(v)) {
    errors.push({
      code: 'SchemaVersionUnsupported',
      path: 'schema_version',
      message: `schema_version ${v} is not in the accepted set [${ACCEPTED_SCHEMA_VERSIONS.join(', ')}]`,
    })
    return 0
  }
  return v
}

function checkCustomerId(root: Record<string, unknown>, errors: ValidationError[]): string | null {
  const id = root['customer_id']
  if (id === undefined || id === null) {
    errors.push({
      code: 'MissingField',
      path: 'customer_id',
      message: 'customer_id is required',
    })
    return null
  }
  if (typeof id !== 'string') {
    errors.push({
      code: 'TypeMismatch',
      path: 'customer_id',
      message: 'customer_id must be a string',
    })
    return null
  }
  if (id.length === 0) {
    errors.push({
      code: 'EmptyField',
      path: 'customer_id',
      message: 'customer_id must not be empty',
    })
    return null
  }
  if (!SLUG_PATTERN.test(id)) {
    errors.push({
      code: 'InvalidSlug',
      path: 'customer_id',
      message: 'customer_id must match ^[a-z0-9][a-z0-9-]{0,31}$',
    })
    return null
  }
  return id
}

function checkPracticeAreas(
  root: Record<string, unknown>,
  vertical: string | null,
  errors: ValidationError[]
): string[] {
  const raw = root['practice_areas']
  if (raw === undefined || raw === null) {
    if (vertical === 'law-firm') {
      errors.push({
        code: 'MissingField',
        path: 'practice_areas',
        message: 'practice_areas is required when vertical=law-firm',
      })
    }
    return []
  }
  if (!Array.isArray(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'practice_areas',
      message: 'practice_areas must be a list of strings',
    })
    return []
  }
  const out: string[] = []
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i]
    if (typeof item !== 'string' || item.length === 0) {
      errors.push({
        code: 'TypeMismatch',
        path: `practice_areas[${i}]`,
        message: 'practice_areas entries must be non-empty strings',
      })
      continue
    }
    out.push(item)
  }
  return out
}

function checkMachine(
  root: Record<string, unknown>,
  errors: ValidationError[]
): MachineSpec | null {
  const m = root['machine']
  if (m === undefined || m === null) {
    errors.push({
      code: 'MissingField',
      path: 'machine',
      message: 'machine is required',
    })
    return null
  }
  if (!isPlainObject(m)) {
    errors.push({ code: 'TypeMismatch', path: 'machine', message: 'machine must be an object' })
    return null
  }
  const mr = m as Record<string, unknown>
  const size = mr['size']
  const mem = mr['memory_mb']
  let ok = true
  if (typeof size !== 'string' || size.length === 0) {
    errors.push({
      code: 'MissingField',
      path: 'machine.size',
      message: 'machine.size is required',
    })
    ok = false
  }
  if (typeof mem !== 'number' || !Number.isInteger(mem)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'machine.memory_mb',
      message: 'machine.memory_mb must be an integer',
    })
    ok = false
  } else if (mem < 256 || mem > 8192) {
    errors.push({
      code: 'EnumViolation',
      path: 'machine.memory_mb',
      message: 'machine.memory_mb must be between 256 and 8192',
    })
    ok = false
  }
  return ok ? { size: size as string, memory_mb: mem as number } : null
}

function checkUsers(root: Record<string, unknown>, errors: ValidationError[]): User[] {
  const raw = root['users']
  if (raw === undefined || raw === null) {
    errors.push({ code: 'MissingField', path: 'users', message: 'users is required' })
    return []
  }
  if (!Array.isArray(raw)) {
    errors.push({ code: 'TypeMismatch', path: 'users', message: 'users must be a list' })
    return []
  }
  if (raw.length === 0) {
    errors.push({
      code: 'EmptyList',
      path: 'users',
      message: 'users must contain at least one entry',
    })
    return []
  }
  const out: User[] = []
  for (let i = 0; i < raw.length; i++) {
    const u = raw[i]
    if (!isPlainObject(u)) {
      errors.push({
        code: 'TypeMismatch',
        path: `users[${i}]`,
        message: 'users entries must be objects',
      })
      continue
    }
    const rec = u as Record<string, unknown>
    const email = rec['email']
    const role = rec['role']
    const fullName = rec['full_name']
    if (typeof email !== 'string' || email.length === 0) {
      errors.push({
        code: 'MissingField',
        path: `users[${i}].email`,
        message: 'users[].email is required',
      })
    }
    if (typeof role !== 'string' || !(ACCEPTED_USER_ROLES as readonly string[]).includes(role)) {
      errors.push({
        code: 'EnumViolation',
        path: `users[${i}].role`,
        message: `users[].role must be one of: ${ACCEPTED_USER_ROLES.join(', ')}`,
      })
    }
    if (typeof fullName !== 'string' || fullName.length === 0) {
      errors.push({
        code: 'MissingField',
        path: `users[${i}].full_name`,
        message: 'users[].full_name is required',
      })
    }
    if (
      typeof email === 'string' &&
      typeof role === 'string' &&
      typeof fullName === 'string' &&
      (ACCEPTED_USER_ROLES as readonly string[]).includes(role)
    ) {
      out.push({ email, role: role as UserRole, full_name: fullName })
    }
  }
  return out
}

function checkPersonas(root: Record<string, unknown>, errors: ValidationError[]): Persona[] {
  const raw = root['personas']
  if (raw === undefined || raw === null) {
    errors.push({ code: 'MissingField', path: 'personas', message: 'personas is required' })
    return []
  }
  if (!Array.isArray(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'personas',
      message: 'personas must be a list (ADR 0011)',
    })
    return []
  }
  if (raw.length === 0) {
    errors.push({
      code: 'EmptyList',
      path: 'personas',
      message: 'personas must contain at least one entry (ADR 0011)',
    })
    return []
  }
  const out: Persona[] = []
  const seenSlugs = new Set<string>()
  let activeCount = 0
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i]
    if (!isPlainObject(p)) {
      errors.push({
        code: 'TypeMismatch',
        path: `personas[${i}]`,
        message: 'personas entries must be objects',
      })
      continue
    }
    const rec = p as Record<string, unknown>
    const slug = rec['slug']
    const status = rec['status']
    const name = rec['name']
    const tone = rec['tone']

    if (typeof slug !== 'string' || slug.length === 0) {
      errors.push({
        code: 'MissingField',
        path: `personas[${i}].slug`,
        message: 'personas[].slug is required',
      })
    } else if (!SLUG_PATTERN.test(slug)) {
      errors.push({
        code: 'InvalidSlug',
        path: `personas[${i}].slug`,
        message: 'personas[].slug must match ^[a-z0-9][a-z0-9-]{0,31}$',
      })
    } else if (seenSlugs.has(slug)) {
      errors.push({
        code: 'DuplicatePersonaSlug',
        path: `personas[${i}].slug`,
        message: `personas[].slug "${slug}" is duplicated`,
      })
    } else {
      seenSlugs.add(slug)
    }

    if (
      typeof status !== 'string' ||
      !(ACCEPTED_PERSONA_STATUSES as readonly string[]).includes(status)
    ) {
      errors.push({
        code: 'EnumViolation',
        path: `personas[${i}].status`,
        message: `personas[].status must be one of: ${ACCEPTED_PERSONA_STATUSES.join(', ')}`,
      })
    } else if (status === 'active') {
      activeCount += 1
    }

    if (typeof name !== 'string' || name.length === 0) {
      errors.push({
        code: 'MissingField',
        path: `personas[${i}].name`,
        message: 'personas[].name is required',
      })
    }

    if (!Array.isArray(tone)) {
      errors.push({
        code: 'MissingField',
        path: `personas[${i}].tone`,
        message: 'personas[].tone must be a list of strings (3-5 entries)',
      })
    }

    const skills = checkPersonaSkills(rec['skills'], `personas[${i}].skills`, errors)
    const channelBindings = checkChannelBindings(
      rec['channel_bindings'],
      `personas[${i}].channel_bindings`,
      errors
    )

    // Optional fields — type-check only when present.
    const title = optionalString(rec, 'title', `personas[${i}].title`, errors)
    const signature = optionalString(rec, 'signature_html', `personas[${i}].signature_html`, errors)
    const avatar = optionalString(rec, 'avatar_url', `personas[${i}].avatar_url`, errors)
    const pronouns = optionalEnum(
      rec,
      'pronouns',
      ACCEPTED_PRONOUNS,
      `personas[${i}].pronouns`,
      errors
    )
    const sendAs = checkSendAs(rec['send_as'], `personas[${i}].send_as`, errors)

    out.push({
      slug: typeof slug === 'string' ? slug : '',
      status:
        typeof status === 'string' &&
        (ACCEPTED_PERSONA_STATUSES as readonly string[]).includes(status)
          ? (status as PersonaStatus)
          : 'archived',
      name: typeof name === 'string' ? name : '',
      title,
      signature_html: signature,
      avatar_url: avatar,
      tone: Array.isArray(tone) ? (tone.filter((t) => typeof t === 'string') as string[]) : [],
      pronouns: pronouns as Pronouns | null,
      send_as: sendAs,
      skills,
      voice_overrides: rec['voice_overrides'] ?? null,
      escalation_overrides: rec['escalation_overrides'] ?? null,
      channel_bindings: channelBindings,
    })
  }
  if (activeCount === 0 && out.length > 0) {
    errors.push({
      code: 'MissingActivePersona',
      path: 'personas',
      message: 'at least one persona must have status: active',
    })
  }
  return out
}

function checkPersonaSkills(raw: unknown, path: string, errors: ValidationError[]): PersonaSkill[] {
  if (raw === undefined || raw === null) {
    errors.push({
      code: 'MissingField',
      path,
      message: `${path} is required`,
    })
    return []
  }
  if (!Array.isArray(raw)) {
    errors.push({ code: 'TypeMismatch', path, message: `${path} must be a list` })
    return []
  }
  const out: PersonaSkill[] = []
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i]
    if (!isPlainObject(s)) {
      errors.push({
        code: 'TypeMismatch',
        path: `${path}[${i}]`,
        message: 'skill entries must be objects',
      })
      continue
    }
    const rec = s as Record<string, unknown>
    const name = rec['name']
    const ceiling = rec['trust_ceiling']
    const version = rec['version']
    const enabled = rec['enabled']

    if (typeof name !== 'string' || name.length === 0) {
      errors.push({
        code: 'MissingField',
        path: `${path}[${i}].name`,
        message: 'skill.name is required',
      })
    }
    if (
      typeof ceiling !== 'string' ||
      !(ACCEPTED_TRUST_CEILINGS as readonly string[]).includes(ceiling)
    ) {
      errors.push({
        code: 'EnumViolation',
        path: `${path}[${i}].trust_ceiling`,
        message: `trust_ceiling must be one of: ${ACCEPTED_TRUST_CEILINGS.join(', ')}`,
      })
    }
    if (version !== undefined && version !== null && typeof version !== 'string') {
      errors.push({
        code: 'TypeMismatch',
        path: `${path}[${i}].version`,
        message: 'skill.version must be a string when present',
      })
    }
    if (enabled !== undefined && enabled !== null && typeof enabled !== 'boolean') {
      errors.push({
        code: 'TypeMismatch',
        path: `${path}[${i}].enabled`,
        message: 'skill.enabled must be a boolean when present',
      })
    }
    const cost = checkCostEstimate(rec['cost_estimate'], `${path}[${i}].cost_estimate`, errors)
    const scope = optionalStringList(rec, 'scope', `${path}[${i}].scope`, errors)

    out.push({
      name: typeof name === 'string' ? name : '',
      version: typeof version === 'string' ? version : 'pending',
      trust_ceiling:
        typeof ceiling === 'string' &&
        (ACCEPTED_TRUST_CEILINGS as readonly string[]).includes(ceiling)
          ? (ceiling as TrustCeiling)
          : 'refused',
      enabled: typeof enabled === 'boolean' ? enabled : true,
      cost_estimate: cost,
      scope,
    })
  }
  return out
}

function checkCostEstimate(
  raw: unknown,
  path: string,
  errors: ValidationError[]
): CostEstimate | null {
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path, message: `${path} must be an object` })
    return null
  }
  const rec = raw as Record<string, unknown>
  const fields: Array<keyof CostEstimate> = [
    'tokens_in_per_run',
    'tokens_out_per_run',
    'tool_calls_per_run',
    'runs_per_day_typical',
  ]
  const out: Partial<CostEstimate> = {}
  let ok = true
  for (const f of fields) {
    const v = rec[f]
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      errors.push({
        code: 'TypeMismatch',
        path: `${path}.${f}`,
        message: `${f} must be a non-negative integer`,
      })
      ok = false
    } else {
      out[f] = v
    }
  }
  return ok ? (out as CostEstimate) : null
}

function checkSendAs(raw: unknown, path: string, errors: ValidationError[]): PersonaSendAs | null {
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path, message: `${path} must be an object` })
    return null
  }
  const rec = raw as Record<string, unknown>
  const id = rec['agentmail_identity']
  if (typeof id !== 'string' || id.length === 0) {
    errors.push({
      code: 'MissingField',
      path: `${path}.agentmail_identity`,
      message: 'send_as.agentmail_identity is required when send_as is set',
    })
    return null
  }
  return { agentmail_identity: id }
}

function checkChannelBindings(
  raw: unknown,
  path: string,
  errors: ValidationError[]
): PersonaChannelBinding[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    errors.push({ code: 'TypeMismatch', path, message: `${path} must be a list` })
    return []
  }
  const out: PersonaChannelBinding[] = []
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i]
    if (!isPlainObject(b)) {
      errors.push({
        code: 'TypeMismatch',
        path: `${path}[${i}]`,
        message: 'channel_bindings entries must be objects',
      })
      continue
    }
    const rec = b as Record<string, unknown>
    const integration = rec['integration']
    const channels = rec['channels']
    if (typeof integration !== 'string' || integration.length === 0) {
      errors.push({
        code: 'MissingField',
        path: `${path}[${i}].integration`,
        message: 'integration is required',
      })
      continue
    }
    if (!Array.isArray(channels) || !channels.every((c) => typeof c === 'string')) {
      errors.push({
        code: 'TypeMismatch',
        path: `${path}[${i}].channels`,
        message: 'channels must be a list of strings',
      })
      continue
    }
    out.push({ integration, channels: channels as string[] })
  }
  return out
}

function checkConnectors(
  root: Record<string, unknown>,
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
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ACCEPTED_CAPABILITY_NAMES.has(key as CapabilityName)) {
      errors.push({
        code: 'UnknownCapability',
        path: `connectors.${key}`,
        message: `unknown capability "${key}"; accepted: ${Array.from(ACCEPTED_CAPABILITY_NAMES).join(', ')}`,
      })
      continue
    }
    if (!isPlainObject(value)) {
      errors.push({
        code: 'TypeMismatch',
        path: `connectors.${key}`,
        message: 'connector entry must be an object',
      })
      continue
    }
    const rec = value as Record<string, unknown>
    const adapter = rec['adapter']
    const backend = rec['backend']
    const enabled = rec['enabled']
    const scopes = rec['scopes']
    const tokenRef = rec['token_ref']
    if (typeof adapter !== 'string' || adapter.length === 0) {
      errors.push({
        code: 'MissingField',
        path: `connectors.${key}.adapter`,
        message: 'connector.adapter is required',
      })
      continue
    }
    if (typeof backend !== 'string' || backend.length === 0) {
      errors.push({
        code: 'MissingField',
        path: `connectors.${key}.backend`,
        message: 'connector.backend is required',
      })
      continue
    }
    if (!ACCEPTED_BACKEND_PREFIXES.some((p) => backend.startsWith(p))) {
      errors.push({
        code: 'InvalidBackend',
        path: `connectors.${key}.backend`,
        message: `connector.backend must start with one of: ${ACCEPTED_BACKEND_PREFIXES.join(', ')}`,
      })
      continue
    }
    if (tokenRef !== undefined && tokenRef !== null) {
      if (typeof tokenRef !== 'string' || !tokenRef.startsWith('infisical:')) {
        errors.push({
          code: 'InvalidTokenRef',
          path: `connectors.${key}.token_ref`,
          message:
            'token_ref must be a string starting with "infisical:" (the only permitted secret-reference channel)',
        })
        continue
      }
      // Require at least three path segments after the prefix to avoid trivial refs.
      const refPath = tokenRef.slice('infisical:'.length)
      const segments = refPath.split('/').filter((s) => s.length > 0)
      if (segments.length < 3) {
        errors.push({
          code: 'InvalidTokenRef',
          path: `connectors.${key}.token_ref`,
          message: 'token_ref must have at least three path segments after "infisical:"',
        })
        continue
      }
    }
    let scopesList: string[] = []
    if (scopes !== undefined && scopes !== null) {
      if (!Array.isArray(scopes) || !scopes.every((s) => typeof s === 'string')) {
        errors.push({
          code: 'TypeMismatch',
          path: `connectors.${key}.scopes`,
          message: 'connector.scopes must be a list of strings',
        })
        continue
      }
      scopesList = scopes as string[]
    }
    out[key as CapabilityName] = {
      adapter,
      backend,
      enabled: typeof enabled === 'boolean' ? enabled : true,
      scopes: scopesList,
      token_ref: typeof tokenRef === 'string' ? tokenRef : null,
    }
  }
  return out
}

function checkScope(root: Record<string, unknown>, errors: ValidationError[]): Scope {
  const raw = root['scope']
  if (raw === undefined || raw === null) {
    errors.push({ code: 'MissingField', path: 'scope', message: 'scope is required' })
    return emptyScope()
  }
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path: 'scope', message: 'scope must be an object' })
    return emptyScope()
  }
  const rec = raw as Record<string, unknown>
  const visible = requireStringList(
    rec,
    'email_folders_visible',
    'scope.email_folders_visible',
    errors
  )
  const blind = requireStringList(rec, 'email_folders_blind', 'scope.email_folders_blind', errors)
  const keywords = requireStringList(
    rec,
    'email_keyword_blocks',
    'scope.email_keyword_blocks',
    errors
  )
  const domains = requireStringList(rec, 'domain_blocks', 'scope.domain_blocks', errors)
  const matters = optionalStringList(rec, 'matter_blocks', 'scope.matter_blocks', errors)
  return {
    email_folders_visible: visible,
    email_folders_blind: blind,
    email_keyword_blocks: keywords,
    domain_blocks: domains,
    matter_blocks: matters,
  }
}

function emptyScope(): Scope {
  return {
    email_folders_visible: [],
    email_folders_blind: [],
    email_keyword_blocks: [],
    domain_blocks: [],
    matter_blocks: [],
  }
}

function checkEscalation(root: Record<string, unknown>, errors: ValidationError[]): Escalation {
  const raw = root['escalation']
  if (raw === undefined || raw === null) {
    errors.push({
      code: 'MissingField',
      path: 'escalation',
      message: 'escalation is required',
    })
    return { red_flag_recipients: [], failure_recipients: [], acknowledgement_window_minutes: null }
  }
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'escalation',
      message: 'escalation must be an object',
    })
    return { red_flag_recipients: [], failure_recipients: [], acknowledgement_window_minutes: null }
  }
  const rec = raw as Record<string, unknown>
  const reds = requireStringList(
    rec,
    'red_flag_recipients',
    'escalation.red_flag_recipients',
    errors
  )
  if (reds.length === 0) {
    errors.push({
      code: 'EmptyList',
      path: 'escalation.red_flag_recipients',
      message: 'escalation.red_flag_recipients must contain at least one address',
    })
  }
  const fails = requireStringList(
    rec,
    'failure_recipients',
    'escalation.failure_recipients',
    errors
  )
  if (fails.length === 0) {
    errors.push({
      code: 'EmptyList',
      path: 'escalation.failure_recipients',
      message: 'escalation.failure_recipients must contain at least one address',
    })
  }
  let ack: number | null = null
  const a = rec['acknowledgement_window_minutes']
  if (a !== undefined && a !== null) {
    if (typeof a !== 'number' || !Number.isInteger(a) || a <= 0) {
      errors.push({
        code: 'TypeMismatch',
        path: 'escalation.acknowledgement_window_minutes',
        message: 'acknowledgement_window_minutes must be a positive integer',
      })
    } else {
      ack = a
    }
  }
  return {
    red_flag_recipients: reds,
    failure_recipients: fails,
    acknowledgement_window_minutes: ack,
  }
}

function checkMemory(
  root: Record<string, unknown>,
  customerId: string | null,
  errors: ValidationError[]
): Memory | null {
  const raw = root['memory']
  if (raw === undefined || raw === null) {
    errors.push({ code: 'MissingField', path: 'memory', message: 'memory is required' })
    return null
  }
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path: 'memory', message: 'memory must be an object' })
    return null
  }
  const rec = raw as Record<string, unknown>
  const d1 = rec['d1_namespace']
  const r2 = rec['r2_vault_path']
  const vec = rec['vectorize_index']
  if (typeof d1 !== 'string' || d1.length === 0) {
    errors.push({
      code: 'MissingField',
      path: 'memory.d1_namespace',
      message: 'memory.d1_namespace is required',
    })
  } else if (customerId !== null && d1 !== customerId) {
    errors.push({
      code: 'IsolationViolation',
      path: 'memory.d1_namespace',
      message: `memory.d1_namespace must equal customer_id (got "${d1}", expected "${customerId}")`,
    })
  }
  if (typeof r2 !== 'string' || r2.length === 0) {
    errors.push({
      code: 'MissingField',
      path: 'memory.r2_vault_path',
      message: 'memory.r2_vault_path is required',
    })
  } else if (customerId !== null && r2 !== `vaults/${customerId}/`) {
    errors.push({
      code: 'IsolationViolation',
      path: 'memory.r2_vault_path',
      message: `memory.r2_vault_path must equal "vaults/${customerId}/"`,
    })
  }
  if (typeof vec !== 'string' || vec.length === 0) {
    errors.push({
      code: 'MissingField',
      path: 'memory.vectorize_index',
      message: 'memory.vectorize_index is required',
    })
  } else if (customerId !== null && vec !== `hermes-${customerId}-vault`) {
    errors.push({
      code: 'IsolationViolation',
      path: 'memory.vectorize_index',
      message: `memory.vectorize_index must equal "hermes-${customerId}-vault"`,
    })
  }
  if (typeof d1 === 'string' && typeof r2 === 'string' && typeof vec === 'string') {
    return { d1_namespace: d1, r2_vault_path: r2, vectorize_index: vec }
  }
  return null
}

function checkVoiceLibrary(
  root: Record<string, unknown>,
  errors: ValidationError[]
): VoiceLibrary | null {
  const raw = root['voice_library']
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'voice_library',
      message: 'voice_library must be an object when present',
    })
    return null
  }
  const rec = raw as Record<string, unknown>
  const samples = rec['samples_path']
  if (samples !== undefined && samples !== null && typeof samples !== 'string') {
    errors.push({
      code: 'TypeMismatch',
      path: 'voice_library.samples_path',
      message: 'samples_path must be a string when present',
    })
    return { samples_path: null }
  }
  return { samples_path: typeof samples === 'string' ? samples : null }
}

function checkBusinessHours(
  root: Record<string, unknown>,
  errors: ValidationError[]
): BusinessHours | null {
  const raw = root['business_hours']
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'business_hours',
      message: 'business_hours must be an object when present',
    })
    return null
  }
  const rec = raw as Record<string, unknown>
  const tz = rec['timezone']
  const days = rec['days']
  const start = rec['start']
  const end = rec['end']
  let ok = true
  if (typeof tz !== 'string' || tz.length === 0) {
    errors.push({
      code: 'MissingField',
      path: 'business_hours.timezone',
      message: 'timezone is required when business_hours is present',
    })
    ok = false
  }
  if (!Array.isArray(days) || !days.every((d) => typeof d === 'string')) {
    errors.push({
      code: 'TypeMismatch',
      path: 'business_hours.days',
      message: 'days must be a list of strings',
    })
    ok = false
  }
  if (typeof start !== 'string' || !/^\d{2}:\d{2}$/.test(start)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'business_hours.start',
      message: 'start must be HH:MM',
    })
    ok = false
  }
  if (typeof end !== 'string' || !/^\d{2}:\d{2}$/.test(end)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'business_hours.end',
      message: 'end must be HH:MM',
    })
    ok = false
  }
  return ok
    ? {
        timezone: tz as string,
        days: days as string[],
        start: start as string,
        end: end as string,
      }
    : null
}

function checkLogging(root: Record<string, unknown>, errors: ValidationError[]): Logging | null {
  const raw = root['logging']
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'logging',
      message: 'logging must be an object when present',
    })
    return null
  }
  const rec = raw as Record<string, unknown>
  const level = rec['level']
  const shipTo = rec['ship_to']
  let ok = true
  if (typeof level !== 'string' || !(ACCEPTED_LOG_LEVELS as readonly string[]).includes(level)) {
    errors.push({
      code: 'EnumViolation',
      path: 'logging.level',
      message: `level must be one of: ${ACCEPTED_LOG_LEVELS.join(', ')}`,
    })
    ok = false
  }
  if (
    !Array.isArray(shipTo) ||
    !shipTo.every(
      (s) => typeof s === 'string' && (ACCEPTED_LOG_SHIPS as readonly string[]).includes(s)
    )
  ) {
    errors.push({
      code: 'EnumViolation',
      path: 'logging.ship_to',
      message: `ship_to entries must be one of: ${ACCEPTED_LOG_SHIPS.join(', ')}`,
    })
    ok = false
  }
  return ok ? { level: level as LogLevel, ship_to: shipTo as LogShip[] } : null
}

function checkPause(root: Record<string, unknown>, errors: ValidationError[]): Pause | null {
  const raw = root['pause']
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'pause',
      message: 'pause must be an object when present',
    })
    return null
  }
  const rec = raw as Record<string, unknown>
  const active = rec['active']
  const reason = rec['reason']
  if (typeof active !== 'boolean') {
    errors.push({
      code: 'MissingField',
      path: 'pause.active',
      message: 'pause.active must be a boolean',
    })
    return null
  }
  if (active && (typeof reason !== 'string' || reason.length === 0)) {
    errors.push({
      code: 'MissingField',
      path: 'pause.reason',
      message: 'pause.reason is required when pause.active is true',
    })
    return { active, reason: null }
  }
  return { active, reason: typeof reason === 'string' ? reason : null }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function checkRequiredString(
  root: Record<string, unknown>,
  field: string,
  errors: ValidationError[]
): void {
  const v = root[field]
  if (v === undefined || v === null) {
    errors.push({ code: 'MissingField', path: field, message: `${field} is required` })
    return
  }
  if (typeof v !== 'string') {
    errors.push({ code: 'TypeMismatch', path: field, message: `${field} must be a string` })
    return
  }
  if (v.length === 0) {
    errors.push({ code: 'EmptyField', path: field, message: `${field} must not be empty` })
  }
}

function checkEnum<T extends string>(
  root: Record<string, unknown>,
  field: string,
  accepted: readonly T[],
  errors: ValidationError[]
): T | null {
  const v = root[field]
  if (v === undefined || v === null) {
    errors.push({ code: 'MissingField', path: field, message: `${field} is required` })
    return null
  }
  if (typeof v !== 'string' || !(accepted as readonly string[]).includes(v)) {
    errors.push({
      code: 'EnumViolation',
      path: field,
      message: `${field} must be one of: ${accepted.join(', ')}`,
    })
    return null
  }
  return v as T
}

function optionalString(
  rec: Record<string, unknown>,
  key: string,
  path: string,
  errors: ValidationError[]
): string | null {
  const v = rec[key]
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') {
    errors.push({
      code: 'TypeMismatch',
      path,
      message: `${path} must be a string when present`,
    })
    return null
  }
  return v
}

function optionalEnum<T extends string>(
  rec: Record<string, unknown>,
  key: string,
  accepted: readonly T[],
  path: string,
  errors: ValidationError[]
): T | null {
  const v = rec[key]
  if (v === undefined || v === null) return null
  if (typeof v !== 'string' || !(accepted as readonly string[]).includes(v)) {
    errors.push({
      code: 'EnumViolation',
      path,
      message: `${path} must be one of: ${accepted.join(', ')}`,
    })
    return null
  }
  return v as T
}

function requireStringList(
  rec: Record<string, unknown>,
  key: string,
  path: string,
  errors: ValidationError[]
): string[] {
  const v = rec[key]
  if (v === undefined || v === null) {
    errors.push({ code: 'MissingField', path, message: `${path} is required` })
    return []
  }
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    errors.push({ code: 'TypeMismatch', path, message: `${path} must be a list of strings` })
    return []
  }
  return v as string[]
}

function optionalStringList(
  rec: Record<string, unknown>,
  key: string,
  path: string,
  errors: ValidationError[]
): string[] {
  const v = rec[key]
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    errors.push({
      code: 'TypeMismatch',
      path,
      message: `${path} must be a list of strings when present`,
    })
    return []
  }
  return v as string[]
}

function secretFindingToError(f: SecretFinding): ValidationError {
  const code: ValidationErrorCode =
    f.category === 'banned_field_name' ? 'BannedFieldName' : 'SecretDetected'
  // CRITICAL: never echo the matched substring. The reason describes the
  // category, not the value.
  const locationParts: string[] = []
  if (f.line !== null) locationParts.push(`line ${f.line}`)
  if (f.path !== null) locationParts.push(`path ${f.path}`)
  const location = locationParts.length > 0 ? ` (${locationParts.join(', ')})` : ''
  return {
    code,
    path: f.path ?? (f.line !== null ? `line:${f.line}` : '$'),
    message: `${f.reason}${location}; rotate the value and replace with an infisical: token_ref`,
  }
}
