/**
 * Tests for the shared relative-age ladder (src/lib/portal/operator/
 * relative-age.ts) that formatDraftAge + formatNotificationAge delegate to.
 * The per-surface suites assert the wrappers; this pins the ladder + the
 * ISO/seconds entry points directly.
 */
import { describe, expect, it } from 'vitest'

import {
  formatRelativeAgeIso,
  formatRelativeAgeSeconds,
} from '../src/lib/portal/operator/relative-age'

describe('formatRelativeAgeSeconds', () => {
  it('renders sub-minute / invalid as "just now"', () => {
    expect(formatRelativeAgeSeconds(0)).toBe('just now')
    expect(formatRelativeAgeSeconds(45)).toBe('just now')
    expect(formatRelativeAgeSeconds(-100)).toBe('just now')
    expect(formatRelativeAgeSeconds(Number.NaN)).toBe('just now')
  })

  it('climbs the m/h/d/mo/y ladder', () => {
    expect(formatRelativeAgeSeconds(60)).toBe('1m ago')
    expect(formatRelativeAgeSeconds(60 * 30)).toBe('30m ago')
    expect(formatRelativeAgeSeconds(3600)).toBe('1h ago')
    expect(formatRelativeAgeSeconds(3600 * 5)).toBe('5h ago')
    expect(formatRelativeAgeSeconds(86400)).toBe('1d ago')
    expect(formatRelativeAgeSeconds(86400 * 10)).toBe('10d ago')
    expect(formatRelativeAgeSeconds(86400 * 60)).toBe('2mo ago')
    expect(formatRelativeAgeSeconds(86400 * 400)).toBe('1y ago')
  })
})

describe('formatRelativeAgeIso', () => {
  const now = Date.parse('2026-06-01T00:00:00Z')

  it('parses ISO and applies the ladder', () => {
    expect(formatRelativeAgeIso('2026-06-01T00:00:00Z', now)).toBe('just now')
    expect(formatRelativeAgeIso('2026-05-31T23:55:00Z', now)).toBe('5m ago')
    expect(formatRelativeAgeIso('2026-05-31T22:00:00Z', now)).toBe('2h ago')
  })

  it('returns the raw string verbatim when unparseable', () => {
    expect(formatRelativeAgeIso('not-a-date', now)).toBe('not-a-date')
  })

  it('clamps future timestamps to "just now" (never negative)', () => {
    expect(formatRelativeAgeIso('2026-06-02T00:00:00Z', now)).toBe('just now')
  })
})
