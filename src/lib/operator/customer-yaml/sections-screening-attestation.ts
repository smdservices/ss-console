/**
 * Validator for the optional `screening_attestation:` block — the firm-level
 * no-active-screens attestation (ADR 0057 §4).
 *
 * A required, fail-closed precondition to authoring ANY live inbound channel.
 * The cross-block gate (an enabled `mcp_connector` or a non-empty
 * `scope.inbound_allow_from` requires `attested: true`) lives in validator.ts,
 * which can see both blocks. This module owns the block's own shape + the pure
 * freshness helper.
 *
 * Absent block ⇒ `{ attested: false, attested_by: null, attested_at: null }`.
 */

import { isPlainObject } from './helpers'
import { type ScreeningAttestation, type ValidationError } from './types'

const SCREENING_DEFAULT: ScreeningAttestation = {
  attested: false,
  attested_by: null,
  attested_at: null,
}

/** ISO-8601 UTC instant, e.g. 2026-06-27T12:00:00.000Z or 2026-06-27T12:00:00Z. */
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

function isValidIsoUtc(value: string): boolean {
  return ISO_UTC_RE.test(value) && !Number.isNaN(Date.parse(value))
}

/** Trimmed non-empty string, or null. */
function optionalTrimmed(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null
}

/** Field-level checks split out to keep checkScreeningAttestation under the complexity ceiling. */
function pushAttestationFieldErrors(
  attested: boolean,
  attestedBy: string | null,
  attestedAt: string | null,
  errors: ValidationError[]
): void {
  if (attestedAt !== null && !isValidIsoUtc(attestedAt)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'screening_attestation.attested_at',
      message: 'screening_attestation.attested_at must be an ISO-8601 UTC timestamp (…Z)',
    })
  }
  // An attestation is only meaningful with an accountable signer and a date —
  // both are required when attested, so freshness can be computed and the audit
  // trail names who attested.
  if (attested && attestedBy === null) {
    errors.push({
      code: 'MissingField',
      path: 'screening_attestation.attested_by',
      message: 'screening_attestation.attested_by is required when attested is true',
    })
  }
  if (attested && attestedAt === null) {
    errors.push({
      code: 'MissingField',
      path: 'screening_attestation.attested_at',
      message: 'screening_attestation.attested_at is required when attested is true',
    })
  }
}

export function checkScreeningAttestation(
  root: Record<string, unknown>,
  errors: ValidationError[]
): ScreeningAttestation {
  const raw = root['screening_attestation']
  if (raw === undefined || raw === null) return { ...SCREENING_DEFAULT }
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'screening_attestation',
      message: 'screening_attestation must be a mapping when present',
    })
    return { ...SCREENING_DEFAULT }
  }

  const attestedRaw = raw['attested']
  if (attestedRaw !== undefined && typeof attestedRaw !== 'boolean') {
    errors.push({
      code: 'TypeMismatch',
      path: 'screening_attestation.attested',
      message: 'screening_attestation.attested must be a boolean',
    })
    return { ...SCREENING_DEFAULT }
  }

  const attested = attestedRaw === true
  const attestedBy = optionalTrimmed(raw['attested_by'])
  const attestedAt = optionalTrimmed(raw['attested_at'])
  pushAttestationFieldErrors(attested, attestedBy, attestedAt, errors)
  return { attested, attested_by: attestedBy, attested_at: attestedAt }
}

/**
 * Pure freshness test (no implicit clock): an attestation is fresh only when it
 * is attested, carries a valid timestamp, and that timestamp is within
 * `maxAgeDays` of `nowIso`. A missing/false/undated/stale attestation is NOT
 * fresh — every inbound channel fails closed (goes dark) until re-attested.
 * `nowIso` is injected so callers in the Worker pass `new Date().toISOString()`
 * and tests pass a fixed instant.
 */
export function isAttestationFresh(
  attestation: ScreeningAttestation,
  nowIso: string,
  maxAgeDays: number
): boolean {
  if (!attestation.attested || attestation.attested_at === null) return false
  const at = Date.parse(attestation.attested_at)
  const now = Date.parse(nowIso)
  if (Number.isNaN(at) || Number.isNaN(now)) return false
  const ageMs = now - at
  if (ageMs < 0) return false
  return ageMs <= maxAgeDays * 24 * 60 * 60 * 1000
}
