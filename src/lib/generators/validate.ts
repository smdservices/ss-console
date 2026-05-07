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
 * with 4 configs, Zod is more overhead than the 4 functions here.
 */

import {
  DEFAULTS,
  type JobMonitorConfig,
  type NewBusinessConfig,
  type PipelineId,
  type ReviewMiningConfig,
  type RevenueRange,
  type SocialListeningConfig,
  type SodaCity,
  type SodaSource,
} from './types.js'

export type ValidationResult<T> = { value: T; errors: string[] }

const SODA_CITIES: readonly SodaCity[] = [
  'phoenix',
  'scottsdale_licenses',
  'scottsdale_permits',
  'mesa',
  'tempe',
] as const

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function validateVerticals(raw: unknown, errors: string[]): string[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) errors.push('target_verticals must be an array')
    return [...DEFAULTS.new_business.target_verticals]
  }
  const out: string[] = []
  for (const v of raw) {
    if (typeof v === 'string' && v.trim().length > 0) {
      out.push(v.trim())
    } else {
      errors.push(`target_verticals contains invalid entry: ${JSON.stringify(v)}`)
    }
  }
  return out.length > 0 ? out : [...DEFAULTS.new_business.target_verticals]
}

function validateRevenueRange(raw: unknown, errors: string[]): RevenueRange {
  if (!isObject(raw)) {
    if (raw !== undefined) errors.push('revenue_range must be an object')
    return { ...DEFAULTS.new_business.revenue_range }
  }
  const min = typeof raw.min_usd === 'number' ? raw.min_usd : null
  const max = typeof raw.max_usd === 'number' ? raw.max_usd : null
  if (min === null) errors.push('revenue_range.min_usd must be a number')
  if (max === null) errors.push('revenue_range.max_usd must be a number')
  if (min !== null && max !== null && min > max) {
    errors.push('revenue_range: min_usd must be <= max_usd')
  }
  return {
    min_usd: min ?? DEFAULTS.new_business.revenue_range.min_usd,
    max_usd: max ?? DEFAULTS.new_business.revenue_range.max_usd,
  }
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

function validateSodaSources(raw: unknown, errors: string[]): SodaSource[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined) errors.push('soda_sources must be an array')
    return [...DEFAULTS.new_business.soda_sources]
  }
  const out: SodaSource[] = []
  for (const entry of raw) {
    if (!isObject(entry)) {
      errors.push('soda_sources entry must be an object')
      continue
    }
    const city = entry.city
    if (typeof city !== 'string' || !(SODA_CITIES as readonly string[]).includes(city)) {
      errors.push(`soda_sources: invalid city ${JSON.stringify(city)}`)
      continue
    }
    out.push({ city: city as SodaCity, enabled: entry.enabled !== false })
  }
  return out.length > 0 ? out : [...DEFAULTS.new_business.soda_sources]
}

// ---------------------------------------------------------------------------
// Per-pipeline validators
// ---------------------------------------------------------------------------

export function validateNewBusiness(raw: unknown): ValidationResult<NewBusinessConfig> {
  const errors: string[] = []
  const obj = isObject(raw) ? raw : {}
  return {
    value: {
      target_verticals: validateVerticals(obj.target_verticals, errors),
      revenue_range: validateRevenueRange(obj.revenue_range, errors),
      geos: validateStringArray(obj.geos, 'geos', DEFAULTS.new_business.geos, errors),
      soda_sources: validateSodaSources(obj.soda_sources, errors),
    },
    errors,
  }
}

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
      target_verticals: validateVerticals(obj.target_verticals, errors),
      revenue_range: validateRevenueRange(obj.revenue_range, errors),
      geos: validateStringArray(obj.geos, 'geos', DEFAULTS.job_monitor.geos, errors),
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
      target_verticals: validateVerticals(obj.target_verticals, errors),
      revenue_range: validateRevenueRange(obj.revenue_range, errors),
      geos: validateStringArray(obj.geos, 'geos', DEFAULTS.review_mining.geos, errors),
      discovery_queries:
        queries.length > 0 ? queries : [...DEFAULTS.review_mining.discovery_queries],
      geo_center: validateGeoCenter(obj.geo_center, errors),
      geo_radius_km: validateGeoRadius(obj.geo_radius_km, errors),
    },
    errors,
  }
}

export function validateSocialListening(raw: unknown): ValidationResult<SocialListeningConfig> {
  const errors: string[] = []
  const obj = isObject(raw) ? raw : {}
  const queries = validateStringArray(
    obj.search_queries,
    'search_queries',
    DEFAULTS.social_listening.search_queries,
    errors
  )
  if (queries.length === 0) {
    errors.push('search_queries cannot be empty')
  }
  return {
    value: {
      target_verticals: validateVerticals(obj.target_verticals, errors),
      revenue_range: validateRevenueRange(obj.revenue_range, errors),
      geos: validateStringArray(obj.geos, 'geos', DEFAULTS.social_listening.geos, errors),
      search_queries: queries.length > 0 ? queries : [...DEFAULTS.social_listening.search_queries],
    },
    errors,
  }
}

export function validateByPipeline(pipeline: PipelineId, raw: unknown): ValidationResult<unknown> {
  switch (pipeline) {
    case 'new_business':
      return validateNewBusiness(raw)
    case 'job_monitor':
      return validateJobMonitor(raw)
    case 'review_mining':
      return validateReviewMining(raw)
    case 'social_listening':
      return validateSocialListening(raw)
  }
}
