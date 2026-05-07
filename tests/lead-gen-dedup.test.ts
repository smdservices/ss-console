import { describe, expect, it } from 'vitest'
import { computeSlug, jaroWinklerSimilarity, normalizeBusinessName } from '../src/lib/entities/slug'

describe('lead-gen dedup normalization', () => {
  it('strips common business suffixes from slug normalization', () => {
    expect(computeSlug('ProGuard Roofing LLC', 'Phoenix, AZ')).toBe('proguard-roofing-phoenix-az')
    expect(computeSlug('Acme Electric Co.', 'Mesa, AZ')).toBe('acme-electric-mesa-az')
  })

  it('normalizes names for fuzzy comparison', () => {
    expect(normalizeBusinessName('Arizona Comfort Solutions, Inc.')).toBe(
      'arizona comfort solutions'
    )
  })

  it('produces high similarity for near-match Arizona business names', () => {
    const score = jaroWinklerSimilarity(
      normalizeBusinessName('AZ Comfort Solutions LLC'),
      normalizeBusinessName('Arizona Comfort Solutions Inc')
    )
    expect(score).toBeGreaterThan(0.88)
  })

  it('produces lower similarity for unrelated businesses', () => {
    const score = jaroWinklerSimilarity(
      normalizeBusinessName('Sonoran Electric LLC'),
      normalizeBusinessName('High Desert Veterinary Group')
    )
    expect(score).toBeLessThan(0.88)
  })
})
