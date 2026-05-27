/**
 * Validator for the `observability:` block.
 *
 * Added by ADR 0023 Wave 1. Optional; partial. Returns a fully-populated
 * Observability with defaults filled for any missing field. Consumers can
 * always read `result.sentry.enabled`, `result.health.period_seconds`, etc.
 * without null-checking.
 *
 * Validation is structural only — TypeMismatch when fields are present
 * with wrong types. No `alert_webhook` field in Wave 1; see ADR 0023
 * §"Cross-cutting calls" #9 for deferral rationale.
 *
 * Lives in its own file (not `sections-other.ts`) so the per-block check
 * logic can split into helpers without bumping the orchestrator file
 * past the 500-line ceiling.
 */

import { OBSERVABILITY_DEFAULTS, type Observability, type ValidationError } from './types'
import { isPlainObject } from './helpers'

export function checkObservability(
  root: Record<string, unknown>,
  errors: ValidationError[]
): Observability {
  const raw = root['observability']
  if (raw === undefined || raw === null) return cloneDefaults()
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'observability',
      message: 'observability must be an object when present',
    })
    return cloneDefaults()
  }

  const result = cloneDefaults()
  applySentry(raw['sentry'], result, errors)
  applyHealth(raw['health'], result, errors)
  return result
}

function cloneDefaults(): Observability {
  return {
    sentry: { ...OBSERVABILITY_DEFAULTS.sentry },
    health: { ...OBSERVABILITY_DEFAULTS.health },
  }
}

function applySentry(raw: unknown, result: Observability, errors: ValidationError[]): void {
  if (raw === undefined || raw === null) return
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'observability.sentry',
      message: 'observability.sentry must be an object when present',
    })
    return
  }
  const enabled = raw['enabled']
  if (enabled === undefined) return
  if (typeof enabled !== 'boolean') {
    errors.push({
      code: 'TypeMismatch',
      path: 'observability.sentry.enabled',
      message: 'observability.sentry.enabled must be a boolean',
    })
    return
  }
  result.sentry.enabled = enabled
}

function applyHealth(raw: unknown, result: Observability, errors: ValidationError[]): void {
  if (raw === undefined || raw === null) return
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'observability.health',
      message: 'observability.health must be an object when present',
    })
    return
  }
  applyPositiveIntField(raw, 'period_seconds', result.health, 'period_seconds', errors)
  applyPositiveIntField(raw, 'grace_minutes', result.health, 'grace_minutes', errors)
}

function applyPositiveIntField(
  raw: Record<string, unknown>,
  rawKey: string,
  target: { period_seconds: number; grace_minutes: number },
  targetKey: 'period_seconds' | 'grace_minutes',
  errors: ValidationError[]
): void {
  const value = raw[rawKey]
  if (value === undefined) return
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    errors.push({
      code: 'TypeMismatch',
      path: `observability.health.${rawKey}`,
      message: `observability.health.${rawKey} must be a positive integer`,
    })
    return
  }
  target[targetKey] = value
}
