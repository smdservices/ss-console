/**
 * Validator for the optional `mcp_connector:` block — the Operator ⇄ Claude MCP
 * connector (Phase 1, console-hosted). Lets authored org users reach this
 * Operator from inside their own Claude.
 *
 * Fail-closed: an absent block, or `enabled: false`, resolves to OFF — no user
 * reaches the Operator through Claude. Each `access[]` entry binds an authored
 * `users[]` email to an active persona slug (the per-user → profile seam). A
 * user with no entry reaches nothing.
 *
 * Deliberately minimal for Phase 1 (Simplifier critique): no `port` (deployment
 * constant), no `authority_mode` / `access_map` (seated in the design, authored
 * when a second principal exists). See
 * docs/design/operator/03-mcp-server-exposure.md.
 */

import { isPlainObject } from './helpers'
import {
  ACCEPTED_DATA_POSTURES,
  ACCEPTED_MCP_POLICIES,
  MCP_GRANT_TTL_DEFAULT_DAYS,
  MCP_GRANT_TTL_MAX_DAYS,
  type DataPosture,
  type McpConnector,
  type McpConnectorAccess,
  type McpIssuancePolicy,
  type Persona,
  type User,
  type ValidationError,
} from './types'

const MCP_CONNECTOR_DEFAULT: McpConnector = {
  enabled: false,
  data_posture: 'open',
  policy: 'allowlist',
  allowed_domains: [],
  default_profile: null,
  ttl_days: MCP_GRANT_TTL_DEFAULT_DAYS,
  access: [],
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

function parseEnabled(raw: unknown, errors: ValidationError[]): boolean {
  if (raw === undefined || raw === null) return false
  if (typeof raw === 'boolean') return raw
  errors.push({
    code: 'TypeMismatch',
    path: 'mcp_connector.enabled',
    message: 'mcp_connector.enabled must be a boolean',
  })
  return false
}

function parseDataPosture(raw: unknown, errors: ValidationError[]): DataPosture {
  if (raw === undefined || raw === null) return 'open'
  if (typeof raw !== 'string' || !ACCEPTED_DATA_POSTURES.includes(raw as DataPosture)) {
    errors.push({
      code: 'EnumViolation',
      path: 'mcp_connector.data_posture',
      message: `mcp_connector.data_posture must be one of: ${ACCEPTED_DATA_POSTURES.join(', ')}`,
    })
    return 'open'
  }
  return raw as DataPosture
}

function parsePolicy(raw: unknown, errors: ValidationError[]): McpIssuancePolicy {
  if (raw === undefined || raw === null) return 'allowlist'
  if (typeof raw !== 'string' || !ACCEPTED_MCP_POLICIES.includes(raw as McpIssuancePolicy)) {
    errors.push({
      code: 'EnumViolation',
      path: 'mcp_connector.policy',
      message: `mcp_connector.policy must be one of: ${ACCEPTED_MCP_POLICIES.join(', ')}`,
    })
    return 'allowlist'
  }
  return raw as McpIssuancePolicy
}

function parseAllowedDomains(raw: unknown, errors: ValidationError[]): string[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'mcp_connector.allowed_domains',
      message: 'mcp_connector.allowed_domains must be a list when present',
    })
    return []
  }
  const out: string[] = []
  raw.forEach((entry, i) => {
    const value = typeof entry === 'string' ? entry.trim().toLowerCase() : ''
    if (!value || !DOMAIN_RE.test(value)) {
      errors.push({
        code: 'TypeMismatch',
        path: `mcp_connector.allowed_domains[${i}]`,
        message: `mcp_connector.allowed_domains[${i}] must be a bare email domain (e.g. firm.com)`,
      })
      return
    }
    out.push(value)
  })
  return out
}

function parseDefaultProfile(
  raw: unknown,
  activeProfiles: Set<string>,
  errors: ValidationError[]
): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string' || raw.trim() === '') {
    errors.push({
      code: 'TypeMismatch',
      path: 'mcp_connector.default_profile',
      message: 'mcp_connector.default_profile must be a non-empty string when present',
    })
    return null
  }
  if (!activeProfiles.has(raw)) {
    errors.push({
      code: 'EnumViolation',
      path: 'mcp_connector.default_profile',
      message: `mcp_connector.default_profile "${raw}" does not match any active persona slug`,
    })
    return null
  }
  return raw
}

function parseTtlDays(raw: unknown, errors: ValidationError[]): number {
  if (raw === undefined || raw === null) return MCP_GRANT_TTL_DEFAULT_DAYS
  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > MCP_GRANT_TTL_MAX_DAYS
  ) {
    errors.push({
      code: 'TypeMismatch',
      path: 'mcp_connector.ttl_days',
      message: `mcp_connector.ttl_days must be an integer in [1, ${MCP_GRANT_TTL_MAX_DAYS}] (never infinite, ADR 0057)`,
    })
    return MCP_GRANT_TTL_DEFAULT_DAYS
  }
  return raw
}

interface AccessValidationContext {
  authoredEmails: Set<string>
  activeProfiles: Set<string>
  seenEmails: Set<string>
  errors: ValidationError[]
}

function parseClerkSubjects(
  entry: Record<string, unknown>,
  path: string,
  errors: ValidationError[]
): Pick<McpConnectorAccess, 'clerk_subject' | 'clerk_subjects'> | null {
  const clerkSubject = entry['clerk_subject']
  if (
    clerkSubject !== undefined &&
    (typeof clerkSubject !== 'string' || !/^user_[A-Za-z0-9]+$/.test(clerkSubject))
  ) {
    errors.push({
      code: 'TypeMismatch',
      path: `${path}.clerk_subject`,
      message: `${path}.clerk_subject must be a Clerk user ID`,
    })
    return null
  }

  const clerkSubjects = entry['clerk_subjects']
  const validClerkSubjects =
    Array.isArray(clerkSubjects) &&
    clerkSubjects.length > 0 &&
    clerkSubjects.every(
      (subject): subject is string =>
        typeof subject === 'string' && /^user_[A-Za-z0-9]+$/.test(subject)
    ) &&
    new Set(clerkSubjects).size === clerkSubjects.length
      ? clerkSubjects
      : null
  if (clerkSubjects !== undefined && validClerkSubjects === null) {
    errors.push({
      code: 'TypeMismatch',
      path: `${path}.clerk_subjects`,
      message: `${path}.clerk_subjects must be a non-empty list of unique Clerk user IDs`,
    })
    return null
  }

  return {
    ...(typeof clerkSubject === 'string' ? { clerk_subject: clerkSubject } : {}),
    ...(validClerkSubjects ? { clerk_subjects: validClerkSubjects } : {}),
  }
}

function parseAccessEntry(
  entry: unknown,
  index: number,
  context: AccessValidationContext
): McpConnectorAccess | null {
  const path = `mcp_connector.access[${index}]`
  if (!isPlainObject(entry)) {
    context.errors.push({ code: 'TypeMismatch', path, message: `${path} must be a mapping` })
    return null
  }

  const email = entry['email']
  const profile = entry['profile']
  if (typeof email !== 'string' || email.trim() === '') {
    context.errors.push({
      code: 'MissingField',
      path: `${path}.email`,
      message: `${path}.email is required`,
    })
    return null
  }
  if (typeof profile !== 'string' || profile.trim() === '') {
    context.errors.push({
      code: 'MissingField',
      path: `${path}.profile`,
      message: `${path}.profile is required`,
    })
    return null
  }
  const subjects = parseClerkSubjects(entry, path, context.errors)
  if (!subjects) return null
  if (!context.authoredEmails.has(email)) {
    context.errors.push({
      code: 'EnumViolation',
      path: `${path}.email`,
      message: `${path}.email "${email}" does not match any declared users[] email`,
    })
    return null
  }
  if (!context.activeProfiles.has(profile)) {
    context.errors.push({
      code: 'EnumViolation',
      path: `${path}.profile`,
      message: `${path}.profile "${profile}" does not match any active persona slug`,
    })
    return null
  }
  if (context.seenEmails.has(email)) {
    context.errors.push({
      code: 'EnumViolation',
      path: `${path}.email`,
      message: `${path}.email "${email}" is bound more than once`,
    })
    return null
  }

  context.seenEmails.add(email)
  return {
    email,
    profile,
    ...subjects,
  }
}

function parseAccess(
  raw: unknown,
  authoredEmails: Set<string>,
  activeProfiles: Set<string>,
  errors: ValidationError[]
): McpConnectorAccess[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'mcp_connector.access',
      message: 'mcp_connector.access must be a list when present',
    })
    return []
  }

  const out: McpConnectorAccess[] = []
  const context: AccessValidationContext = {
    authoredEmails,
    activeProfiles,
    seenEmails: new Set<string>(),
    errors,
  }
  raw.forEach((entry, i) => {
    const parsed = parseAccessEntry(entry, i, context)
    if (parsed) out.push(parsed)
  })
  return out
}

export function checkMcpConnector(
  root: Record<string, unknown>,
  users: User[],
  personas: Persona[],
  errors: ValidationError[]
): McpConnector {
  const raw = root['mcp_connector']
  if (raw === undefined || raw === null) return { ...MCP_CONNECTOR_DEFAULT, access: [] }
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'mcp_connector',
      message: 'mcp_connector must be a mapping when present',
    })
    return { ...MCP_CONNECTOR_DEFAULT, access: [] }
  }

  const authoredEmails = new Set(users.map((u) => u.email))
  const activeProfiles = new Set(personas.filter((p) => p.status === 'active').map((p) => p.slug))

  const policy = parsePolicy(raw['policy'], errors)
  const allowedDomains = parseAllowedDomains(raw['allowed_domains'], errors)
  const defaultProfile = parseDefaultProfile(raw['default_profile'], activeProfiles, errors)

  // Open-policy preconditions (ADR 0057 §3): a verified firm-domain identity is
  // JIT-granted, so an open connector with no domain to match or no profile to
  // mint into would either grant nothing or fail at runtime. Require both up front.
  if (policy === 'open' && allowedDomains.length === 0) {
    errors.push({
      code: 'MissingField',
      path: 'mcp_connector.allowed_domains',
      message: "mcp_connector.allowed_domains must be non-empty when policy is 'open'",
    })
  }
  if (policy === 'open' && defaultProfile === null) {
    errors.push({
      code: 'MissingField',
      path: 'mcp_connector.default_profile',
      message:
        "mcp_connector.default_profile is required (and must be an active persona) when policy is 'open'",
    })
  }

  return {
    enabled: parseEnabled(raw['enabled'], errors),
    data_posture: parseDataPosture(raw['data_posture'], errors),
    policy,
    allowed_domains: allowedDomains,
    default_profile: defaultProfile,
    ttl_days: parseTtlDays(raw['ttl_days'], errors),
    access: parseAccess(raw['access'], authoredEmails, activeProfiles, errors),
  }
}
