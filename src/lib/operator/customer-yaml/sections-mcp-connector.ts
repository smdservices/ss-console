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
  type DataPosture,
  type McpConnector,
  type McpConnectorAccess,
  type Persona,
  type User,
  type ValidationError,
} from './types'

const MCP_CONNECTOR_DEFAULT: McpConnector = {
  enabled: false,
  data_posture: 'open',
  access: [],
}

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

interface AccessValidationContext {
  authoredEmails: Set<string>
  activeProfiles: Set<string>
  seenEmails: Set<string>
  errors: ValidationError[]
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
  const clerkSubject = entry['clerk_subject']
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
  if (
    clerkSubject !== undefined &&
    (typeof clerkSubject !== 'string' || !/^user_[A-Za-z0-9]+$/.test(clerkSubject))
  ) {
    context.errors.push({
      code: 'TypeMismatch',
      path: `${path}.clerk_subject`,
      message: `${path}.clerk_subject must be a Clerk user ID`,
    })
    return null
  }
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
    ...(typeof clerkSubject === 'string' ? { clerk_subject: clerkSubject } : {}),
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

  return {
    enabled: parseEnabled(raw['enabled'], errors),
    data_posture: parseDataPosture(raw['data_posture'], errors),
    access: parseAccess(raw['access'], authoredEmails, activeProfiles, errors),
  }
}
