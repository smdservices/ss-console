/**
 * Tests for the fleet-status display helpers (ADR 0023 Wave 1).
 *
 * The pure-function helpers in src/lib/admin/fleet-status.ts gate the
 * heartbeat column's color and label on the admin dashboard. The
 * critical property — verified here — is that the column NEVER lies in
 * the reassuring direction: a stale heartbeat always renders red with
 * an honest age string, regardless of the last-write recency.
 */

import { describe, it, expect } from 'vitest'
import { formatAge, formatUptime, heartbeatDisplay } from '../src/lib/admin/fleet-status'

describe('heartbeatDisplay', () => {
  const now = new Date('2026-05-26T18:00:00Z')

  it('returns gray with "no signal yet" when the row has never received a heartbeat', () => {
    const out = heartbeatDisplay(null, 60, 5, now)
    expect(out).toEqual({ color: 'gray', label: 'no signal yet' })
  })

  it('returns gray on malformed timestamp', () => {
    const out = heartbeatDisplay('not-a-date', 60, 5, now)
    expect(out.color).toBe('gray')
  })

  it('returns green when age < 2 × period_seconds (defaults: < 120s)', () => {
    const fresh = new Date(now.getTime() - 30_000).toISOString()
    const out = heartbeatDisplay(fresh, 60, 5, now)
    expect(out.color).toBe('green')
    expect(out.label).toMatch(/^\d+s ago$/)
  })

  it('returns yellow when age is inside grace but past the green band (default 120s–300s)', () => {
    const late = new Date(now.getTime() - 200_000).toISOString()
    const out = heartbeatDisplay(late, 60, 5, now)
    expect(out.color).toBe('yellow')
    expect(out.label).toMatch(/^\d+m ago$/)
  })

  it('returns red when age is past grace_minutes × 60 (default > 300s)', () => {
    const stale = new Date(now.getTime() - 47 * 60 * 1000).toISOString()
    const out = heartbeatDisplay(stale, 60, 5, now)
    expect(out.color).toBe('red')
    expect(out.label).toBe('stale 47m')
  })

  it('respects customer-configured period and grace overrides', () => {
    // period=30s → green band is < 60s, grace=2min → yellow up to 120s
    const ninety = new Date(now.getTime() - 90_000).toISOString()
    const out = heartbeatDisplay(ninety, 30, 2, now)
    expect(out.color).toBe('yellow')
  })

  it('never returns green for a heartbeat that is older than the grace window — even when grace is wide', () => {
    // Property check: anywhere in (grace×60, ∞) the color must be red.
    const ageSeconds = [301, 600, 3600, 86400, 86400 * 365]
    for (const age of ageSeconds) {
      const ts = new Date(now.getTime() - age * 1000).toISOString()
      const out = heartbeatDisplay(ts, 60, 5, now)
      expect(out.color).toBe('red')
      expect(out.label.startsWith('stale ')).toBe(true)
    }
  })
})

describe('formatAge', () => {
  it('renders seconds for < 1 minute', () => {
    expect(formatAge(0)).toBe('0s')
    expect(formatAge(59)).toBe('59s')
  })
  it('renders minutes for 1m to <1h', () => {
    expect(formatAge(60)).toBe('1m')
    expect(formatAge(3599)).toBe('59m')
  })
  it('renders hours for 1h to <1d', () => {
    expect(formatAge(3600)).toBe('1h')
    expect(formatAge(86399)).toBe('23h')
  })
  it('renders days for >= 1d', () => {
    expect(formatAge(86400)).toBe('1d')
    expect(formatAge(7 * 86400)).toBe('7d')
  })
})

describe('formatUptime', () => {
  it('renders em-dash for null / NaN / negative', () => {
    expect(formatUptime(null)).toBe('—')
    expect(formatUptime(Number.NaN)).toBe('—')
    expect(formatUptime(-1)).toBe('—')
  })
  it('formats positive integers using the same scale as formatAge', () => {
    expect(formatUptime(45)).toBe('45s')
    expect(formatUptime(7200)).toBe('2h')
  })
})
