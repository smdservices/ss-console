/**
 * Hand-written validators for generator configs.
 *
 * Design intent:
 *   - Missing fields take from defaults. Never error on "field absent."
 *   - Invalid values (wrong type, negative numbers, empty arrays where
 *     a value is required) produce a string error in `errors[]`.
 *   - A parse result with errors still returns a usable config (merged
 *     with defaults). The UI surfaces errors as a warning banner — we
 *     never silently revert.
 *
 * This is deliberately not Zod. For a single-tenant single-editor app
 * with 2 configs, Zod is more overhead than the functions here.
 */

import {
  DEFAULTS,
  type JobMonitorConfig,
  type PipelineId,
  type ReviewMiningConfig,
} from './types.js'

export type ValidationResult<T> = { value: T; errors: string[] }

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function validateStringArray(
  raw: unknown,
  fieldName: string,
  fallback: string[],
  errors: string[]
): string[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) errors.push(`${fieldName} must be an array`)
    return [...fallback]
  }
  const out: string[] = []
  for (const v of raw) {
    if (typeof v === 'string' && v.trim().length > 0) {
      out.push(v.trim())
    } else {
      errors.push(`${fieldName} contains invalid entry: ${JSON.stringify(v)}`)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Per-pipeline validators
// ---------------------------------------------------------------------------

export function validateJobMonitor(raw: unknown): ValidationResult<JobMonitorConfig> {
  const errors: string[] = []
  const obj = isObject(raw) ? raw : {}
  const queries = validateStringArray(
    obj.search_queries,
    'search_queries',
    DEFAULTS.job_monitor.search_queries,
    errors
  )
  if (queries.length === 0) {
    errors.push('search_queries cannot be empty')
  }
  return {
    value: {
      search_queries: queries.length > 0 ? queries : [...DEFAULTS.job_monitor.search_queries],
    },
    errors,
  }
}

function validateGeoCenter(raw: unknown, errors: string[]): { lat: number; lon: number } {
  if (!isObject(raw)) {
    if (raw !== undefined) errors.push('geo_center must be an object with lat/lon')
    return { ...DEFAULTS.review_mining.geo_center }
  }
  const lat = typeof raw.lat === 'number' ? raw.lat : null
  const lon = typeof raw.lon === 'number' ? raw.lon : null
  if (lat === null || lon === null) {
    errors.push('geo_center must have numeric lat and lon')
    return { ...DEFAULTS.review_mining.geo_center }
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    errors.push('geo_center out of range')
    return { ...DEFAULTS.review_mining.geo_center }
  }
  return { lat, lon }
}

function validateGeoRadius(raw: unknown, errors: string[]): number {
  if (raw === undefined) return DEFAULTS.review_mining.geo_radius_km
  if (typeof raw !== 'number') {
    errors.push('geo_radius_km must be a number')
    return DEFAULTS.review_mining.geo_radius_km
  }
  if (raw <= 0 || raw > 500) {
    errors.push('geo_radius_km must be > 0 and <= 500')
    return DEFAULTS.review_mining.geo_radius_km
  }
  return raw
}

export function validateReviewMining(raw: unknown): ValidationResult<ReviewMiningConfig> {
  const errors: string[] = []
  const obj = isObject(raw) ? raw : {}
  const queries = validateStringArray(
    obj.discovery_queries,
    'discovery_queries',
    DEFAULTS.review_mining.discovery_queries,
    errors
  )
  if (queries.length === 0) errors.push('discovery_queries cannot be empty')

  return {
    value: {
      discovery_queries:
        queries.length > 0 ? queries : [...DEFAULTS.review_mining.discovery_queries],
      geo_center: validateGeoCenter(obj.geo_center, errors),
      geo_radius_km: validateGeoRadius(obj.geo_radius_km, errors),
    },
    errors,
  }
}

export function validateByPipeline(pipeline: PipelineId, raw: unknown): ValidationResult<unknown> {
  switch (pipeline) {
    case 'job_monitor':
      return validateJobMonitor(raw)
    case 'review_mining':
      return validateReviewMining(raw)
  }
}
