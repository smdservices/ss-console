/**
 * Authority-posture section validator (ADR 0041). The optional top-level
 * `authority` block declares, per switchable domain, whether the client org
 * may operate it (`client`) or only SMD does (`managed`). See
 * src/lib/operator/authority.ts for the resolved-side contract and semantics.
 *
 * Absent block → the launch posture (`default: managed`, no overrides): SMD
 * operates everything, every client self-serve switch off. This is the safe,
 * explicit default — a client never becomes operable by omission.
 *
 * Strict where the resolved-side parser (`parseAuthorityPosture`) is lenient:
 * here an unknown override key, an SMD-only domain used as a switch, or a bad
 * value is a hard authoring error. The lenient parser exists only to keep a
 * corrupt projected row from crashing a render; authoring must be clean.
 */

import {
  ACCEPTED_AUTHORITY_DEFAULTS,
  ACCEPTED_AUTHORITY_HOLDERS,
  DEFAULT_AUTHORITY_POSTURE,
  SMD_ONLY_AUTHORITY_DOMAINS,
  SWITCHABLE_AUTHORITY_DOMAINS,
  isSwitchableDomain,
  type AuthorityDefault,
  type AuthorityHolder,
  type AuthorityPosture,
  type SwitchableAuthorityDomain,
} from '../authority'
import type { ValidationError } from './types'
import { isPlainObject } from './helpers'

const SMD_ONLY_SET: ReadonlySet<string> = new Set(SMD_ONLY_AUTHORITY_DOMAINS)

export function checkAuthority(
  root: Record<string, unknown>,
  errors: ValidationError[]
): AuthorityPosture {
  const raw = root['authority']
  if (raw === undefined || raw === null) {
    return { ...DEFAULT_AUTHORITY_POSTURE }
  }
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'authority',
      message: 'authority must be an object when present',
    })
    return { ...DEFAULT_AUTHORITY_POSTURE }
  }
  const def = checkDefault(raw['default'], errors)
  const overrides = checkOverrides(raw['overrides'], errors)
  return { default: def, overrides }
}

function checkDefault(raw: unknown, errors: ValidationError[]): AuthorityDefault {
  if (raw === undefined || raw === null) return 'managed'
  if (
    typeof raw !== 'string' ||
    !(ACCEPTED_AUTHORITY_DEFAULTS as readonly string[]).includes(raw)
  ) {
    errors.push({
      code: 'EnumViolation',
      path: 'authority.default',
      message: `authority.default must be one of: ${ACCEPTED_AUTHORITY_DEFAULTS.join(', ')}`,
    })
    return 'managed'
  }
  return raw as AuthorityDefault
}

function checkOverrides(
  raw: unknown,
  errors: ValidationError[]
): Partial<Record<SwitchableAuthorityDomain, AuthorityHolder>> {
  const out: Partial<Record<SwitchableAuthorityDomain, AuthorityHolder>> = {}
  if (raw === undefined || raw === null) return out
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'authority.overrides',
      message: 'authority.overrides must be an object when present',
    })
    return out
  }
  for (const [key, value] of Object.entries(raw)) {
    const domain = checkOverrideKey(key, errors)
    const holder = checkOverrideValue(key, value, errors)
    if (domain !== null && holder !== null) out[domain] = holder
  }
  return out
}

function checkOverrideKey(
  key: string,
  errors: ValidationError[]
): SwitchableAuthorityDomain | null {
  if (isSwitchableDomain(key)) return key
  const reason = SMD_ONLY_SET.has(key)
    ? `"${key}" is SMD-only and can never be a client switch`
    : `unknown authority domain "${key}"`
  errors.push({
    code: 'UnknownAuthorityDomain',
    path: `authority.overrides.${key}`,
    message: `${reason}; switchable domains: ${SWITCHABLE_AUTHORITY_DOMAINS.join(', ')}`,
  })
  return null
}

function checkOverrideValue(
  key: string,
  value: unknown,
  errors: ValidationError[]
): AuthorityHolder | null {
  if (
    typeof value !== 'string' ||
    !(ACCEPTED_AUTHORITY_HOLDERS as readonly string[]).includes(value)
  ) {
    errors.push({
      code: 'EnumViolation',
      path: `authority.overrides.${key}`,
      message: `authority override value must be one of: ${ACCEPTED_AUTHORITY_HOLDERS.join(', ')}`,
    })
    return null
  }
  return value as AuthorityHolder
}
