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

/**
 * Like checkRequiredString but the field may be absent. Absent/null is fine
 * (no error); present means it must be a non-empty string. Used for optional
 * top-level scalars such as `escalation_model` (ADR 0049).
 */
export function checkOptionalString(
  root: Record<string, unknown>,
  field: string,
  errors: ValidationError[]
): void {
  const v = root[field]
  if (v === undefined || v === null) return
  if (typeof v !== 'string') {
    errors.push({ code: 'TypeMismatch', path: field, message: `${field} must be a string` })
    return
  }
  if (v.length === 0) {
    errors.push({ code: 'EmptyField', path: field, message: `${field} must not be empty` })
  }
}

// Upstream-pin pattern per ADR 0024 (docs/adr/0024-hermes-consumption-and-update-cadence.md).
// hermes_ref pins an UPSTREAM Hermes release by date-tag AND commit SHA:
//   v{YYYY}.{M}.{D}@{40-hex-sha}
//   (e.g. v2026.5.16@a91a57fa5a13d516c38b07a141a9ce8a3daabeb0)
//   - {YYYY}.{M}.{D} is Hermes' date-based upstream version, present for human
//     readability. Legacy SemVer tags (v0.14.0) are not accepted; Hermes
//     switched to date-based tagging in 2026.
//   - The @{sha} is the immutable pin. A commit SHA is content-addressed, so
//     upstream cannot mutate what it points at — this is the immutability the
//     retired fork only claimed to provide. Carrying the SHA in the ref also
//     means provisioning never resolves it from a live upstream lookup
//     (closes the availability defect documented in ADR 0024).
// ADR 0024 retired the venturecrane/hermes-agent fork and its v...-smd.N tag
// scheme. Bare date-tags (no @sha), bare SHAs (no v-tag), -smd.N fork tags,
// and legacy SemVer tags are all rejected. Security patches are applied in the
// base-image build and tracked by image digest, not by a ref suffix.
const UPSTREAM_PIN_PATTERN = /^v\d{4}\.\d{1,2}\.\d{1,2}@[0-9a-f]{40}$/

export function checkHermesRef(root: Record<string, unknown>, errors: ValidationError[]): void {
  const v = root['hermes_ref']
  // Required-string check already runs upstream of this; no-op cleanly when
  // the field is absent or wrong-typed so we don't duplicate that error.
  if (typeof v !== 'string' || v.length === 0) return
  if (!UPSTREAM_PIN_PATTERN.test(v)) {
    errors.push({
      code: 'InvalidFormat',
      path: 'hermes_ref',
      message:
        'hermes_ref must pin an upstream Hermes release of the form ' +
        'v{YYYY}.{M}.{D}@{40-hex-sha} ' +
        '(e.g. v2026.5.16@a91a57fa5a13d516c38b07a141a9ce8a3daabeb0). ' +
        'Bare tags, bare SHAs, -smd.N fork tags, and legacy SemVer tags are ' +
        'not accepted. See ADR 0024.',
    })
  }
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

/**
 * Like {@link optionalString} but rejects empty strings. Use for fields that
 * are optional in the schema but where empty string is always an authoring
 * typo — e.g. bootstrap-populated paths where blank means "the bootstrap
 * script failed half-way." Added by ADR 0022 Stream 1 for the
 * `memory.r2_skill_bodies_*` keys; reusable elsewhere.
 */
export function optionalNonEmptyString(
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
  if (v.length === 0) {
    errors.push({ code: 'EmptyField', path, message: `${path} must not be empty when present` })
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
