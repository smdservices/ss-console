import { describe, expect, it } from 'vitest'
import { validateJobMonitor, validateReviewMining } from '../src/lib/generators/validate'
import { DEFAULTS } from '../src/lib/generators/types'

describe('generator config validators', () => {
  describe('validateJobMonitor', () => {
    it('errors when search_queries is empty', () => {
      const { value, errors } = validateJobMonitor({ search_queries: [] })
      expect(errors).toContain('search_queries cannot be empty')
      // still returns defaults so the worker never gets a crippled list
      expect(value.search_queries.length).toBeGreaterThan(0)
    })

    it('filters out non-string entries', () => {
      const { value, errors } = validateJobMonitor({
        search_queries: ['office manager', 123, '', 'dispatcher'],
      })
      expect(errors.some((e) => e.startsWith('search_queries contains invalid'))).toBe(true)
      expect(value.search_queries).toEqual(['office manager', 'dispatcher'])
    })

    it('returns defaults on completely empty input', () => {
      const { value, errors } = validateJobMonitor({})
      expect(errors).toEqual([])
      expect(value.search_queries).toEqual(DEFAULTS.job_monitor.search_queries)
    })
  })

  describe('validateReviewMining', () => {
    it('errors when geo_radius_km is out of range', () => {
      const { errors } = validateReviewMining({ geo_radius_km: 9999 })
      expect(errors).toContain('geo_radius_km must be > 0 and <= 500')
    })

    it('errors on lat/lon out of range', () => {
      const { errors } = validateReviewMining({
        geo_center: { lat: 999, lon: -500 },
      })
      expect(errors).toContain('geo_center out of range')
    })

    it('accepts a valid review-mining config', () => {
      const { errors } = validateReviewMining({
        discovery_queries: ['plumber Arizona'],
        geo_center: { lat: 34.0, lon: -111.5 },
        geo_radius_km: 25,
      })
      expect(errors).toEqual([])
    })

    it('fills missing fields with defaults and never errors on absent keys', () => {
      // Schema-evolution case: stored config written before a field existed.
      // Validator must NOT error on the missing key.
      const { value, errors } = validateReviewMining({})
      expect(errors).toEqual([])
      expect(value.discovery_queries).toEqual(DEFAULTS.review_mining.discovery_queries)
      expect(value.geo_center).toEqual(DEFAULTS.review_mining.geo_center)
    })
  })
})
