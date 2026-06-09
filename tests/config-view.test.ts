/**
 * Tests for the config-display helpers (src/lib/admin/config-view.ts) —
 * admin Operator console §5.2.
 *
 * sectionPresence answers the one honest question the surface can ask of an
 * opaque projected section ("is it configured?") without guessing structure.
 */

import { describe, it, expect } from 'vitest'
import { sectionPresence, presenceBadge, toneSummary } from '../src/lib/admin/config-view'

describe('sectionPresence', () => {
  it('treats null / undefined / empty as not set', () => {
    expect(sectionPresence(null)).toBe('not set')
    expect(sectionPresence(undefined)).toBe('not set')
    expect(sectionPresence({})).toBe('not set')
    expect(sectionPresence([])).toBe('not set')
    expect(sectionPresence('')).toBe('not set')
  })

  it('treats any populated value as configured', () => {
    expect(sectionPresence({ a: 1 })).toBe('configured')
    expect(sectionPresence([1])).toBe('configured')
    expect(sectionPresence('x')).toBe('configured')
    expect(sectionPresence(0)).toBe('configured') // a scalar 0 is a value
  })
})

describe('presenceBadge', () => {
  it('maps presence to a token-based badge', () => {
    expect(presenceBadge('configured').label).toBe('Configured')
    expect(presenceBadge('configured').classes).toContain('--ss-color-complete')
    expect(presenceBadge('not set').label).toBe('Not set')
  })
})

describe('toneSummary', () => {
  it('joins tone entries and handles empty', () => {
    expect(toneSummary(['warm', 'professional'])).toBe('warm, professional')
    expect(toneSummary([])).toBe('—')
    expect(toneSummary(null)).toBe('—')
    expect(toneSummary(undefined)).toBe('—')
  })
})
