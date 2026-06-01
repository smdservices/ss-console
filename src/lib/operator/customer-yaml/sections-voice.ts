/**
 * Voice-cohort section validator for customer.yaml. Issue #857.
 *
 * Extracted from sections-other.ts when the cohort-taxonomy additions
 * pushed that file over the 500-line ceiling. Voice-related validators
 * stay together so future Layer-2 / Layer-3 schema work has one home.
 */

import { isPlainObject } from './helpers'
import { BASE_VOICE_COHORTS, SLUG_PATTERN, type ValidationError, type VoiceCohorts } from './types'

/**
 * Validate the optional `voice_cohorts:` block. Issue #857.
 *
 * Schema rules in types.ts :: VoiceCohorts. The block is OPTIONAL —
 * omission means the customer accepts BASE_VOICE_COHORTS. When
 * present, the `cohorts:` list MUST contain at least one entry, every
 * entry MUST be a slug, and entries MUST be unique.
 *
 * Returns null on absence so the consumer can render the
 * "BASE_VOICE_COHORTS" default at call time. Returns a populated
 * VoiceCohorts otherwise; partial-error cases that we can't recover
 * from also return null and push errors.
 */
export function checkVoiceCohorts(
  root: Record<string, unknown>,
  errors: ValidationError[]
): VoiceCohorts | null {
  const raw = root['voice_cohorts']
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'voice_cohorts',
      message: 'voice_cohorts must be an object when present',
    })
    return null
  }
  const cohorts = checkCohortList(raw['cohorts'], errors)
  const min = checkMinSamplesPerCohort(raw['min_samples_per_cohort'], errors)
  if (cohorts === null) return null
  return { cohorts, min_samples_per_cohort: min }
}

function checkCohortList(raw: unknown, errors: ValidationError[]): string[] | null {
  if (raw === undefined || raw === null) {
    errors.push({
      code: 'MissingField',
      path: 'voice_cohorts.cohorts',
      message: 'voice_cohorts.cohorts is required when voice_cohorts is present',
    })
    return null
  }
  if (!Array.isArray(raw)) {
    errors.push({
      code: 'TypeMismatch',
      path: 'voice_cohorts.cohorts',
      message: 'voice_cohorts.cohorts must be a list of slug strings',
    })
    return null
  }
  if (raw.length === 0) {
    errors.push({
      code: 'EmptyList',
      path: 'voice_cohorts.cohorts',
      message: 'voice_cohorts.cohorts must contain at least one entry',
    })
    return null
  }
  return collectCohortSlugs(raw, errors)
}

function collectCohortSlugs(raw: unknown[], errors: ValidationError[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i]
    if (typeof item !== 'string' || item.length === 0) {
      errors.push({
        code: 'TypeMismatch',
        path: `voice_cohorts.cohorts[${i}]`,
        message: 'voice_cohorts.cohorts entries must be non-empty slug strings',
      })
      continue
    }
    if (!SLUG_PATTERN.test(item)) {
      errors.push({
        code: 'InvalidSlug',
        path: `voice_cohorts.cohorts[${i}]`,
        message: 'voice_cohorts.cohorts entry must match ^[a-z0-9][a-z0-9-]{0,31}$',
      })
      continue
    }
    if (seen.has(item)) {
      errors.push({
        code: 'DuplicateVoiceCohort',
        path: `voice_cohorts.cohorts[${i}]`,
        message: `voice_cohorts.cohorts entry "${item}" is duplicated`,
      })
      continue
    }
    seen.add(item)
    out.push(item)
  }
  return out
}

function checkMinSamplesPerCohort(raw: unknown, errors: ValidationError[]): number | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    errors.push({
      code: 'TypeMismatch',
      path: 'voice_cohorts.min_samples_per_cohort',
      message: 'voice_cohorts.min_samples_per_cohort must be a positive integer when present',
    })
    return null
  }
  return raw
}

/**
 * Resolved cohort vocabulary for the customer. When `voice_cohorts:`
 * was omitted, returns the BASE_VOICE_COHORTS literal so downstream
 * consumers don't have to branch.
 */
export function resolveCohortVocabulary(voiceCohorts: VoiceCohorts | null): readonly string[] {
  if (voiceCohorts === null) return BASE_VOICE_COHORTS
  return voiceCohorts.cohorts
}
