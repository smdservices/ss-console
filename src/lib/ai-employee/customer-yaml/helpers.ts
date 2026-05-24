/**
 * Small shared helpers used by the section validators. Each is narrow and
 * stateless; they push to a passed-in errors array and return a typed value
 * (or null on failure). The pattern keeps section validators readable while
 * not requiring exception flow.
 */

import type { SecretFinding } from './secret-detector'
import type { ValidationError, ValidationErrorCode } from './types'

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function checkRequiredString(
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

// Fork-tag pattern per ADR 0015 (docs/adr/0015-hermes-fork-vs-upstream.md).
// hermes_ref MUST pin a fork tag of the form v{semver}-smd.{n}:
//   - {semver} is a SemVer-2.0 core version (X.Y.Z, with optional pre-release
//     and build metadata). The fork's tag scheme uses date-based upstream
//     references (e.g. v2026.5.7); SemVer accommodates that since each
//     dot-separated identifier is numeric.
//   - {n} is a non-negative integer SMD revision counter (0 for "fork exists,
//     no SMD code yet"; increments per SMD-side change).
// Bare upstream tags (no -smd.N suffix) are rejected: per ADR 0015 §Decision,
// customer.yaml pins the fork ref, not the upstream ref.
const FORK_TAG_PATTERN =
  /^v(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?-smd\.(?:0|[1-9]\d*)$/

export function checkHermesRef(root: Record<string, unknown>, errors: ValidationError[]): void {
  const v = root['hermes_ref']
  // Required-string check already runs upstream of this; no-op cleanly when
  // the field is absent or wrong-typed so we don't duplicate that error.
  if (typeof v !== 'string' || v.length === 0) return
  if (!FORK_TAG_PATTERN.test(v)) {
    errors.push({
      code: 'InvalidFormat',
      path: 'hermes_ref',
      message:
        'hermes_ref must pin a fork tag of the form v{upstream}-smd.{n} ' +
        '(e.g. v2026.5.7-smd.0); bare upstream tags are not accepted. ' +
        'See ADR 0015 and venturecrane/hermes-agent releases.',
    })
  }
}

export function checkEnum<T extends string>(
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

export function optionalString(
  rec: Record<string, unknown>,
  key: string,
  path: string,
  errors: ValidationError[]
): string | null {
  const v = rec[key]
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') {
    errors.push({ code: 'TypeMismatch', path, message: `${path} must be a string when present` })
    return null
  }
  return v
}

export function optionalEnum<T extends string>(
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

export function requireStringList(
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
  return v
}

export function optionalStringList(
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
  return v
}

/**
 * Convert a SecretFinding (from secret-detector) into a ValidationError.
 * CRITICAL: never includes the matched substring in the message — the
 * detector intentionally drops the value and the validator must not
 * resurrect it from f.reason or f.path.
 */
export function secretFindingToError(f: SecretFinding): ValidationError {
  const code: ValidationErrorCode =
    f.category === 'banned_field_name' ? 'BannedFieldName' : 'SecretDetected'
  const parts: string[] = []
  if (f.line !== null) parts.push(`line ${f.line}`)
  if (f.path !== null) parts.push(`path ${f.path}`)
  const location = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return {
    code,
    path: f.path ?? (f.line !== null ? `line:${f.line}` : '$'),
    message: `${f.reason}${location}; rotate the value and replace with an infisical: token_ref`,
  }
}
