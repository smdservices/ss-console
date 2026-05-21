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
