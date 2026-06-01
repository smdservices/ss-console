/**
 * Personas section validator for customer.yaml. Splits the recursive
 * per-persona / per-skill / per-channel-binding checks into small functions
 * so each stays under the 75-line / 15-complexity ceilings.
 */

import {
  ACCEPTED_ACTION_CLASSES,
  ACCEPTED_PERSONA_STATUSES,
  ACCEPTED_PRONOUNS,
  ACCEPTED_TRUST_CEILINGS,
  SLUG_PATTERN,
  type ActionClass,
  type CostEstimate,
  type Persona,
  type PersonaChannelBinding,
  type PersonaSendAs,
  type PersonaSkill,
  type PersonaStatus,
  type TrustCeiling,
  type ValidationError,
} from './types'
import { isPlainObject, optionalEnum, optionalString, optionalStringList } from './helpers'
import { checkBundles, checkCron } from './sections-bundles-cron'

export function checkPersonas(root: Record<string, unknown>, errors: ValidationError[]): Persona[] {
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
  return buildPersonas(raw, errors)
}

function buildPersonas(raw: unknown[], errors: ValidationError[]): Persona[] {
  const out: Persona[] = []
  const seenSlugs = new Set<string>()
  let activeCount = 0
  for (let i = 0; i < raw.length; i++) {
    const built = checkOnePersona(raw[i], i, seenSlugs, errors)
    if (built !== null) {
      out.push(built)
      if (built.status === 'active') activeCount += 1
    }
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

function checkOnePersona(
  p: unknown,
  i: number,
  seenSlugs: Set<string>,
  errors: ValidationError[]
): Persona | null {
  if (!isPlainObject(p)) {
    errors.push({
      code: 'TypeMismatch',
      path: `personas[${i}]`,
      message: 'personas entries must be objects',
    })
    return null
  }
  const slug = checkPersonaSlug(p['slug'], i, seenSlugs, errors)
  const status = checkPersonaStatus(p['status'], i, errors)
  const name = checkPersonaName(p['name'], i, errors)
  checkPersonaTone(p['tone'], i, errors)
  const skills = checkPersonaSkills(p['skills'], `personas[${i}].skills`, errors)
  const channelBindings = checkChannelBindings(
    p['channel_bindings'],
    `personas[${i}].channel_bindings`,
    errors
  )
  const bundles = checkBundles(p['bundles'], `personas[${i}].bundles`, skills, errors)
  const cron = checkCron(p['cron'], `personas[${i}].cron`, skills, errors)
  const title = optionalString(p, 'title', `personas[${i}].title`, errors)
  const signature = optionalString(p, 'signature_html', `personas[${i}].signature_html`, errors)
  const avatar = optionalString(p, 'avatar_url', `personas[${i}].avatar_url`, errors)
  const pronouns = optionalEnum(p, 'pronouns', ACCEPTED_PRONOUNS, `personas[${i}].pronouns`, errors)
  const sendAs = checkSendAs(p['send_as'], `personas[${i}].send_as`, errors)
  return {
    slug,
    status,
    name,
    title,
    signature_html: signature,
    avatar_url: avatar,
    tone: extractToneList(p['tone']),
    pronouns: pronouns,
    send_as: sendAs,
    skills,
    voice_overrides: checkOverrideBlob(
      p['voice_overrides'],
      `personas[${i}].voice_overrides`,
      errors
    ),
    escalation_overrides: checkOverrideBlob(
      p['escalation_overrides'],
      `personas[${i}].escalation_overrides`,
      errors
    ),
    channel_bindings: channelBindings,
    bundles,
    cron,
  }
}

/**
 * Validate a free-form per-persona override blob. Absent → null. A plain
 * object is carried verbatim (internal shape is intentionally open). Any other
 * authored value (string, number, array) is a malformed override → push an
 * error and coerce to null rather than silently passing a scalar through, which
 * the prior `unknown` typing allowed.
 */
function checkOverrideBlob(
  value: unknown,
  path: string,
  errors: ValidationError[]
): Record<string, unknown> | null {
  if (value === undefined || value === null) return null
  if (isPlainObject(value)) return value
  errors.push({
    code: 'TypeMismatch',
    path,
    message: `${path} must be a mapping (object) or absent`,
  })
  return null
}

function checkPersonaSlug(
  slug: unknown,
  i: number,
  seenSlugs: Set<string>,
  errors: ValidationError[]
): string {
  if (typeof slug !== 'string' || slug.length === 0) {
    errors.push({
      code: 'MissingField',
      path: `personas[${i}].slug`,
      message: 'personas[].slug is required',
    })
    return ''
  }
  if (!SLUG_PATTERN.test(slug)) {
    errors.push({
      code: 'InvalidSlug',
      path: `personas[${i}].slug`,
      message: 'personas[].slug must match ^[a-z0-9][a-z0-9-]{0,31}$',
    })
    return ''
  }
  if (seenSlugs.has(slug)) {
    errors.push({
      code: 'DuplicatePersonaSlug',
      path: `personas[${i}].slug`,
      message: `personas[].slug "${slug}" is duplicated`,
    })
    return slug
  }
  seenSlugs.add(slug)
  return slug
}

function checkPersonaStatus(status: unknown, i: number, errors: ValidationError[]): PersonaStatus {
  if (
    typeof status !== 'string' ||
    !(ACCEPTED_PERSONA_STATUSES as readonly string[]).includes(status)
  ) {
    errors.push({
      code: 'EnumViolation',
      path: `personas[${i}].status`,
      message: `personas[].status must be one of: ${ACCEPTED_PERSONA_STATUSES.join(', ')}`,
    })
    return 'archived'
  }
  return status as PersonaStatus
}

function checkPersonaName(name: unknown, i: number, errors: ValidationError[]): string {
  if (typeof name !== 'string' || name.length === 0) {
    errors.push({
      code: 'MissingField',
      path: `personas[${i}].name`,
      message: 'personas[].name is required',
    })
    return ''
  }
  return name
}

function checkPersonaTone(tone: unknown, i: number, errors: ValidationError[]): void {
  if (!Array.isArray(tone)) {
    errors.push({
      code: 'MissingField',
      path: `personas[${i}].tone`,
      message: 'personas[].tone must be a list of strings (3-5 entries)',
    })
  }
}

function extractToneList(tone: unknown): string[] {
  if (!Array.isArray(tone)) return []
  return tone.filter((t): t is string => typeof t === 'string')
}

export function checkPersonaSkills(
  raw: unknown,
  path: string,
  errors: ValidationError[]
): PersonaSkill[] {
  if (raw === undefined || raw === null) {
    errors.push({ code: 'MissingField', path, message: `${path} is required` })
    return []
  }
  if (!Array.isArray(raw)) {
    errors.push({ code: 'TypeMismatch', path, message: `${path} must be a list` })
    return []
  }
  const out: PersonaSkill[] = []
  for (let i = 0; i < raw.length; i++) {
    const skill = checkOneSkill(raw[i], `${path}[${i}]`, errors)
    if (skill !== null) out.push(skill)
  }
  return out
}

function checkOneSkill(raw: unknown, path: string, errors: ValidationError[]): PersonaSkill | null {
  if (!isPlainObject(raw)) {
    errors.push({ code: 'TypeMismatch', path, message: 'skill entries must be objects' })
    return null
  }
  checkSkillName(raw['name'], path, errors)
  checkSkillCeiling(raw['trust_ceiling'], path, errors)
  checkSkillActionCeilings(raw['action_ceilings'], path, errors)
  checkSkillVersion(raw['version'], path, errors)
  checkSkillEnabled(raw['enabled'], path, errors)
  const cost = checkCostEstimate(raw['cost_estimate'], `${path}.cost_estimate`, errors)
  const scope = optionalStringList(raw, 'scope', `${path}.scope`, errors)
  return assembleSkill(raw, cost, scope)
}

function checkSkillName(name: unknown, path: string, errors: ValidationError[]): void {
  if (typeof name !== 'string' || name.length === 0) {
    errors.push({
      code: 'MissingField',
      path: `${path}.name`,
      message: 'skill.name is required',
    })
  }
}

function checkSkillCeiling(ceiling: unknown, path: string, errors: ValidationError[]): void {
  if (
    typeof ceiling !== 'string' ||
    !(ACCEPTED_TRUST_CEILINGS as readonly string[]).includes(ceiling)
  ) {
    errors.push({
      code: 'EnumViolation',
      path: `${path}.trust_ceiling`,
      message: `trust_ceiling must be one of: ${ACCEPTED_TRUST_CEILINGS.join(', ')}`,
    })
  }
}

/**
 * Validate the optional per-action-class ceiling override map (ADR 0025).
 * Absent/null is valid (skill uses safe class defaults). When present it must
 * be an object whose keys are known ActionClasses and whose values are
 * accepted TrustCeilings. The floor check (cannot raise above a vertical
 * floor) is a runtime/enforcement concern, not a static-shape concern, so it
 * is not done here.
 */
function checkSkillActionCeilings(raw: unknown, path: string, errors: ValidationError[]): void {
  if (raw === undefined || raw === null) return
  const fieldPath = `${path}.action_ceilings`
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: fieldPath,
      message: `${fieldPath} must be an object`,
    })
    return
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!(ACCEPTED_ACTION_CLASSES as readonly string[]).includes(key)) {
      errors.push({
        code: 'InvalidActionClass',
        path: `${fieldPath}.${key}`,
        message: `action_ceilings key must be one of: ${ACCEPTED_ACTION_CLASSES.join(', ')}`,
      })
      continue
    }
    if (
      typeof value !== 'string' ||
      !(ACCEPTED_TRUST_CEILINGS as readonly string[]).includes(value)
    ) {
      errors.push({
        code: 'InvalidActionCeiling',
        path: `${fieldPath}.${key}`,
        message: `action_ceilings.${key} must be one of: ${ACCEPTED_TRUST_CEILINGS.join(', ')}`,
      })
    }
  }
}

function checkSkillVersion(version: unknown, path: string, errors: ValidationError[]): void {
  if (version !== undefined && version !== null && typeof version !== 'string') {
    errors.push({
      code: 'TypeMismatch',
      path: `${path}.version`,
      message: 'skill.version must be a string when present',
    })
  }
}

function checkSkillEnabled(enabled: unknown, path: string, errors: ValidationError[]): void {
  if (enabled !== undefined && enabled !== null && typeof enabled !== 'boolean') {
    errors.push({
      code: 'TypeMismatch',
      path: `${path}.enabled`,
      message: 'skill.enabled must be a boolean when present',
    })
  }
}

function assembleSkill(
  raw: Record<string, unknown>,
  cost: CostEstimate | null,
  scope: string[]
): PersonaSkill {
  const name = raw['name']
  const ceiling = raw['trust_ceiling']
  const version = raw['version']
  const enabled = raw['enabled']
  return {
    name: typeof name === 'string' ? name : '',
    version: typeof version === 'string' ? version : 'pending',
    trust_ceiling:
      typeof ceiling === 'string' &&
      (ACCEPTED_TRUST_CEILINGS as readonly string[]).includes(ceiling)
        ? (ceiling as TrustCeiling)
        : 'refused',
    action_ceilings: extractActionCeilings(raw['action_ceilings']),
    enabled: typeof enabled === 'boolean' ? enabled : true,
    cost_estimate: cost,
    scope,
  }
}

/**
 * Build the validated per-action-class ceiling map, keeping only well-formed
 * entries. Returns null when no overrides are authored (the common case),
 * so consumers can treat null as "use safe class defaults."
 */
function extractActionCeilings(raw: unknown): Partial<Record<ActionClass, TrustCeiling>> | null {
  if (!isPlainObject(raw)) return null
  const out: Partial<Record<ActionClass, TrustCeiling>> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (
      (ACCEPTED_ACTION_CLASSES as readonly string[]).includes(key) &&
      typeof value === 'string' &&
      (ACCEPTED_TRUST_CEILINGS as readonly string[]).includes(value)
    ) {
      out[key as ActionClass] = value as TrustCeiling
    }
  }
  return Object.keys(out).length > 0 ? out : null
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
  const fields: Array<keyof CostEstimate> = [
    'tokens_in_per_run',
    'tokens_out_per_run',
    'tool_calls_per_run',
    'runs_per_day_typical',
  ]
  const out: Partial<CostEstimate> = {}
  let ok = true
  for (const f of fields) {
    const v = raw[f]
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
  const id = raw['agentmail_identity']
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

export function checkChannelBindings(
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
    const b = checkOneChannelBinding(raw[i], `${path}[${i}]`, errors)
    if (b !== null) out.push(b)
  }
  return out
}

function checkOneChannelBinding(
  raw: unknown,
  path: string,
  errors: ValidationError[]
): PersonaChannelBinding | null {
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path,
      message: 'channel_bindings entries must be objects',
    })
    return null
  }
  const integration = raw['integration']
  const channels = raw['channels']
  if (typeof integration !== 'string' || integration.length === 0) {
    errors.push({
      code: 'MissingField',
      path: `${path}.integration`,
      message: 'integration is required',
    })
    return null
  }
  if (!Array.isArray(channels) || !channels.every((c) => typeof c === 'string')) {
    errors.push({
      code: 'TypeMismatch',
      path: `${path}.channels`,
      message: 'channels must be a list of strings',
    })
    return null
  }
  return { integration, channels: channels }
}
