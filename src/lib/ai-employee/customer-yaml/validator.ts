/**
 * customer.yaml structural validator.
 *
 * Consumes the parsed YAML as an `unknown` (the consumer chooses its YAML
 * parser — portal and Hermes each parse independently per ADR 0012 §4) and
 * returns a tagged-union ValidationResult: `ok` carries a typed CustomerYaml,
 * `err` carries a list of ValidationError entries.
 *
 * Hand-rolled rather than zod/valibot for three reasons:
 *   1. The contract is small enough that explicit checks read better than a
 *      schema declaration whose semantics the reader translates back to docs.
 *   2. The error shape we need (typed `code`, JSONPath, no-echo for secrets)
 *      is awkward to retrofit onto a schema library's error format.
 *   3. Zero dependencies. The Worker bundle already has no schema lib.
 *
 * Section validators live in sections-*.ts to keep individual files under the
 * 500/75/15 ceiling. This file is the entrypoint and the orchestrator.
 *
 * Aligned with docs/specs/ai-employee/customer-yaml-schema.md (#790).
 */

import { scanParsedValue, scanRawYaml, type ScanOptions } from './secret-detector'
import {
  checkEnum,
  checkHermesRef,
  checkRequiredString,
  isPlainObject,
  secretFindingToError,
} from './helpers'
import {
  ACCEPTED_VERTICALS,
  type CustomerYaml,
  type MachineSpec,
  type Memory,
  type SchemaVersion,
  type ValidationError,
  type ValidationResult,
  type Vertical,
} from './types'
import {
  checkCustomerId,
  checkMachine,
  checkPracticeAreas,
  checkSchemaVersion,
  checkUsers,
} from './sections-identity'
import { checkPersonas } from './sections-personas'
import { checkConnectors } from './sections-connectors'
import {
  checkBusinessHours,
  checkComplianceEnabled,
  checkEscalation,
  checkLogging,
  checkMemory,
  checkPause,
  checkScope,
  checkVoiceLibrary,
} from './sections-other'
import { checkVoiceCohorts } from './sections-voice'
import { checkWebhookTriggers } from './sections-webhook-triggers'

export type {
  CustomerYaml,
  ValidationError,
  ValidationErrorCode,
  ValidationResult,
  Persona,
  PersonaSkill,
  PersonaStatus,
  PersonaSendAs,
  PersonaChannelBinding,
  PersonaBundle,
  PersonaCron,
  WebhookTrigger,
  WakePolicy,
  User,
  UserRole,
  Connector,
  Scope,
  Escalation,
  Memory,
  MemoryRetention,
  VoiceLibrary,
  VoiceCohorts,
  BaseVoiceCohort,
  BusinessHours,
  Logging,
  Pause,
  MachineSpec,
  CostEstimate,
  Vertical,
  TrustCeiling,
  Pronouns,
  LogLevel,
  LogShip,
  SchemaVersion,
} from './types'
export {
  ACCEPTED_VERTICALS,
  ACCEPTED_TRUST_CEILINGS,
  ACCEPTED_USER_ROLES,
  ACCEPTED_PERSONA_STATUSES,
  ACCEPTED_PRONOUNS,
  ACCEPTED_LOG_LEVELS,
  ACCEPTED_LOG_SHIPS,
  ACCEPTED_BACKEND_PREFIXES,
  ACCEPTED_SCHEMA_VERSIONS,
  ACCEPTED_WAKE_POLICIES,
  AUDIT_LOG_DAYS_MAX,
  BASE_VOICE_COHORTS,
  VERTICAL_AUDIT_LOG_DAYS_DEFAULTS,
  WEBHOOK_URL_PATTERN,
  isAcceptedCronSchedule,
} from './types'
export { resolveCohortVocabulary } from './sections-voice'

export interface ValidateOptions {
  /** Raw YAML text. When provided, scanRawYaml runs as the first pass so a
   * malformed structural shape still fails closed on a leaked secret. */
  rawText?: string
  /** Forwarded to the secret detector. */
  scanOptions?: ScanOptions
}

/**
 * Validate a parsed customer.yaml object.
 *
 * The validator never throws. All structural and policy violations are
 * collected and returned as a flat list. Authors see every error in one
 * pass rather than fixing one and re-running.
 */
export function validate(input: unknown, options: ValidateOptions = {}): ValidationResult {
  const errors: ValidationError[] = []

  if (typeof options.rawText === 'string') {
    for (const f of scanRawYaml(options.rawText, options.scanOptions)) {
      errors.push(secretFindingToError(f))
    }
  }

  if (!isPlainObject(input)) {
    errors.push({
      code: 'TypeMismatch',
      path: '$',
      message: 'customer.yaml must parse to an object at the root',
    })
    return { ok: false, errors }
  }

  for (const f of scanParsedValue(input, '', options.scanOptions)) {
    errors.push(secretFindingToError(f))
  }

  const parsed = validateSections(input, errors)
  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, value: assembleCustomerYaml(input, parsed) }
}

interface ParsedSections {
  schemaVersion: number
  customerId: string | null
  vertical: Vertical | null
  practiceAreas: string[]
  machine: MachineSpec | null
  users: ReturnType<typeof checkUsers>
  personas: ReturnType<typeof checkPersonas>
  connectors: ReturnType<typeof checkConnectors>
  scope: ReturnType<typeof checkScope>
  escalation: ReturnType<typeof checkEscalation>
  memory: Memory | null
  voiceLibrary: ReturnType<typeof checkVoiceLibrary>
  voiceCohorts: ReturnType<typeof checkVoiceCohorts>
  businessHours: ReturnType<typeof checkBusinessHours>
  logging: ReturnType<typeof checkLogging>
  pause: ReturnType<typeof checkPause>
  webhookTriggers: ReturnType<typeof checkWebhookTriggers>
  complianceEnabled: boolean
}

function validateSections(
  root: Record<string, unknown>,
  errors: ValidationError[]
): ParsedSections {
  const schemaVersion = checkSchemaVersion(root, errors)
  const customerId = checkCustomerId(root, errors)
  checkRequiredString(root, 'customer_name', errors)
  const vertical = checkEnum(root, 'vertical', ACCEPTED_VERTICALS, errors)
  const practiceAreas = checkPracticeAreas(root, vertical, errors)
  checkRequiredString(root, 'fly_region', errors)
  checkRequiredString(root, 'model', errors)
  checkRequiredString(root, 'hermes_ref', errors)
  checkHermesRef(root, errors)
  const machine = checkMachine(root, errors)
  const users = checkUsers(root, errors)
  const personas = checkPersonas(root, errors)
  const connectors = checkConnectors(root, customerId, errors)
  const scope = checkScope(root, errors)
  const escalation = checkEscalation(root, errors)
  const memory = checkMemory(root, customerId, vertical, errors)
  const webhookTriggers = checkWebhookTriggers(root, personas, connectors, errors)
  return {
    schemaVersion,
    customerId,
    vertical,
    practiceAreas,
    machine,
    users,
    personas,
    connectors,
    scope,
    escalation,
    memory,
    voiceLibrary: checkVoiceLibrary(root, errors),
    voiceCohorts: checkVoiceCohorts(root, errors),
    businessHours: checkBusinessHours(root, errors),
    logging: checkLogging(root, errors),
    pause: checkPause(root, errors),
    webhookTriggers,
    complianceEnabled: checkComplianceEnabled(root, errors),
  }
}

function assembleCustomerYaml(root: Record<string, unknown>, p: ParsedSections): CustomerYaml {
  // Every nullable section here is guaranteed non-null by the caller — we
  // early-returned on errors.length > 0 before reaching this point.
  return {
    schema_version: p.schemaVersion as SchemaVersion,
    customer_id: p.customerId as string,
    customer_name: root['customer_name'] as string,
    vertical: p.vertical as Vertical,
    practice_areas: p.practiceAreas,
    fly_region: root['fly_region'] as string,
    model: root['model'] as string,
    hermes_ref: root['hermes_ref'] as string,
    machine: p.machine as MachineSpec,
    users: p.users,
    personas: p.personas,
    connectors: p.connectors,
    scope: p.scope,
    escalation: p.escalation,
    voice_library: p.voiceLibrary,
    voice_cohorts: p.voiceCohorts,
    business_hours: p.businessHours,
    memory: p.memory as Memory,
    logging: p.logging,
    pause: p.pause,
    webhook_triggers: p.webhookTriggers,
    compliance_enabled: p.complianceEnabled,
  }
}
