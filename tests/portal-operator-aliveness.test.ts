/**
 * Tests for the Operator dashboard aliveness signal
 * (src/lib/portal/operator/aliveness.ts).
 *
 * Per #875, the dashboard header carries a per-customer "where is the
 * agent right now" signal: idle / running / sticky_stop / offline,
 * plus a last-action timestamp and (for unhealthy postures) a
 * Captain-escalation affordance.
 *
 * The Hermes runtime bridge (#821) is not wired today; the resolver
 * returns null and the AlivenessHeader component renders nothing per
 * docs/style/empty-state-pattern.md. These tests cover:
 *
 *   - The closed AlivenessLevel vocabulary
 *   - alivenessTone → Tone mapping (closed switch)
 *   - deriveAlivenessFromBridge — the pure transition that the Hermes
 *     wiring will call once real readings flow. Priority and edge
 *     cases (sticky-stop wins, in-flight wins, missing timestamp,
 *     unparseable timestamp, threshold crossing).
 *   - formatAlivenessLevel — friendly headline per level
 *   - formatLastActionRelative — relative-time bucket boundaries
 *   - formatLastActionAbsolute — null + unparseable handling
 *   - needsEscalationAffordance — true only for the unhealthy postures
 *   - resolveAlivenessSignal — empty-state contract (returns null
 *     under the bridge stub)
 *
 * OFFLINE_THRESHOLD_MINUTES is asserted as a constant so a future
 * customer-yaml override has a single source of truth to verify
 * against.
 */

import { describe, it, expect } from 'vitest'
import {
  ALIVENESS_LEVELS,
  OFFLINE_THRESHOLD_MINUTES,
  alivenessTone,
  deriveAlivenessFromBridge,
  formatAlivenessLevel,
  formatLastActionAbsolute,
  formatLastActionRelative,
  needsEscalationAffordance,
  resolveAlivenessSignal,
  type AlivenessBridgeReading,
  type AlivenessLevel,
} from '../src/lib/portal/operator/aliveness'
import type { SubscriptionRow } from '../src/lib/portal/product-access'

function makeReading(overrides?: Partial<AlivenessBridgeReading>): AlivenessBridgeReading {
  return {
    lastAuditTs: '2026-05-24T12:00:00.000Z',
    inFlightSkill: null,
    stickyStopLevel: 'OK',
    stickyStopReason: null,
    ...overrides,
  }
}

function makeSubscription(overrides?: Partial<SubscriptionRow>): SubscriptionRow {
  return {
    id: 'sub_test',
    org_id: 'org_test',
    entity_id: 'ent_test',
    product_slug: 'operator',
    status: 'active',
    started_at: '2026-05-01T00:00:00.000Z',
    ended_at: null,
    settings_json: null,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('ALIVENESS_LEVELS', () => {
  it('exposes the four canonical levels', () => {
    expect(ALIVENESS_LEVELS).toEqual(['idle', 'running', 'sticky_stop', 'offline'])
  })
})

describe('OFFLINE_THRESHOLD_MINUTES', () => {
  it('is 30 minutes (documented default)', () => {
    expect(OFFLINE_THRESHOLD_MINUTES).toBe(30)
  })
})

describe('alivenessTone', () => {
  it('maps each level to its assigned tone', () => {
    const cases: Array<[AlivenessLevel, ReturnType<typeof alivenessTone>]> = [
      ['idle', 'success'],
      ['running', 'info'],
      ['sticky_stop', 'danger'],
      ['offline', 'warning'],
    ]
    for (const [level, expected] of cases) {
      expect(alivenessTone(level)).toBe(expected)
    }
  })
})

describe('formatAlivenessLevel', () => {
  it('maps each level to a friendly headline', () => {
    expect(formatAlivenessLevel('idle')).toBe('Idle')
    expect(formatAlivenessLevel('running')).toBe('Running')
    expect(formatAlivenessLevel('sticky_stop')).toBe('Paused by safety check')
    expect(formatAlivenessLevel('offline')).toBe('Offline')
  })
})

describe('needsEscalationAffordance', () => {
  it('is true for the unhealthy postures only', () => {
    expect(needsEscalationAffordance('sticky_stop')).toBe(true)
    expect(needsEscalationAffordance('offline')).toBe(true)
    expect(needsEscalationAffordance('idle')).toBe(false)
    expect(needsEscalationAffordance('running')).toBe(false)
  })
})

describe('deriveAlivenessFromBridge', () => {
  // Anchor "now" at noon UTC on the same day as the default fixture.
  const NOW_MS = Date.parse('2026-05-24T12:05:00.000Z')

  describe('sticky-stop priority', () => {
    it('returns sticky_stop when stickyStopLevel is WARN', () => {
      const reading = makeReading({
        stickyStopLevel: 'WARN',
        stickyStopReason: 'consecutive_tool_failures=3',
      })
      const signal = deriveAlivenessFromBridge(reading, NOW_MS)
      expect(signal.level).toBe('sticky_stop')
      expect(signal.stickyStopReason).toBe('consecutive_tool_failures=3')
      expect(signal.currentSkill).toBeNull()
    })

    it('returns sticky_stop when stickyStopLevel is SOFT_STOP', () => {
      const reading = makeReading({ stickyStopLevel: 'SOFT_STOP', stickyStopReason: 'refusals' })
      expect(deriveAlivenessFromBridge(reading, NOW_MS).level).toBe('sticky_stop')
    })

    it('returns sticky_stop when stickyStopLevel is HARD_STOP', () => {
      const reading = makeReading({ stickyStopLevel: 'HARD_STOP', stickyStopReason: 'capped' })
      expect(deriveAlivenessFromBridge(reading, NOW_MS).level).toBe('sticky_stop')
    })

    it('sticky-stop wins over an in-flight skill', () => {
      const reading = makeReading({
        stickyStopLevel: 'HARD_STOP',
        stickyStopReason: 'capped',
        inFlightSkill: 'inbox-triage',
      })
      const signal = deriveAlivenessFromBridge(reading, NOW_MS)
      expect(signal.level).toBe('sticky_stop')
      expect(signal.currentSkill).toBeNull()
    })

    it('preserves the last-action timestamp even when sticky-stop', () => {
      const reading = makeReading({
        stickyStopLevel: 'HARD_STOP',
        stickyStopReason: 'capped',
        lastAuditTs: '2026-05-24T11:30:00.000Z',
      })
      const signal = deriveAlivenessFromBridge(reading, NOW_MS)
      expect(signal.lastActionAt).toBe('2026-05-24T11:30:00.000Z')
    })
  })

  describe('running priority', () => {
    it('returns running when a skill is in flight', () => {
      const reading = makeReading({ inFlightSkill: 'inbox-triage' })
      const signal = deriveAlivenessFromBridge(reading, NOW_MS)
      expect(signal.level).toBe('running')
      expect(signal.currentSkill).toBe('inbox-triage')
      expect(signal.stickyStopReason).toBeNull()
    })

    it('ignores an empty-string in-flight skill', () => {
      const reading = makeReading({ inFlightSkill: '' })
      const signal = deriveAlivenessFromBridge(reading, NOW_MS)
      expect(signal.level).toBe('idle')
    })
  })

  describe('idle vs offline by audit-row age', () => {
    it('returns idle when the last audit row is within the threshold', () => {
      // Default fixture ts is at 12:00; now is 12:05 → 5 minutes ago
      // → well within 30 min threshold.
      const signal = deriveAlivenessFromBridge(makeReading(), NOW_MS)
      expect(signal.level).toBe('idle')
    })

    it('returns offline when the last audit row is older than the threshold', () => {
      const reading = makeReading({ lastAuditTs: '2026-05-24T11:30:00.000Z' })
      // now=12:05, last=11:30 → 35 minutes ago → offline (>30).
      expect(deriveAlivenessFromBridge(reading, NOW_MS).level).toBe('offline')
    })

    it('returns offline when lastAuditTs is null (no history)', () => {
      const reading = makeReading({ lastAuditTs: null })
      const signal = deriveAlivenessFromBridge(reading, NOW_MS)
      expect(signal.level).toBe('offline')
      expect(signal.lastActionAt).toBeNull()
    })

    it('returns offline when lastAuditTs is unparseable', () => {
      const reading = makeReading({ lastAuditTs: 'not a timestamp' })
      const signal = deriveAlivenessFromBridge(reading, NOW_MS)
      expect(signal.level).toBe('offline')
      expect(signal.lastActionAt).toBe('not a timestamp')
    })

    it('treats exactly threshold-age as still idle (strict >)', () => {
      // now=12:05; last=11:35 → exactly 30 min ago → still idle.
      const reading = makeReading({ lastAuditTs: '2026-05-24T11:35:00.000Z' })
      expect(deriveAlivenessFromBridge(reading, NOW_MS).level).toBe('idle')
    })
  })
})

describe('formatLastActionRelative', () => {
  const NOW_MS = Date.parse('2026-05-24T12:00:00.000Z')

  it('returns null for null input', () => {
    expect(formatLastActionRelative(null, NOW_MS)).toBeNull()
  })

  it('returns null for unparseable input', () => {
    expect(formatLastActionRelative('garbage', NOW_MS)).toBeNull()
  })

  it('returns "just now" for ages under a minute', () => {
    expect(formatLastActionRelative('2026-05-24T11:59:30.000Z', NOW_MS)).toBe('just now')
  })

  it('returns "just now" for negative ages (clock skew)', () => {
    expect(formatLastActionRelative('2026-05-24T12:00:10.000Z', NOW_MS)).toBe('just now')
  })

  it('returns minute-bucketed labels under an hour', () => {
    expect(formatLastActionRelative('2026-05-24T11:59:00.000Z', NOW_MS)).toBe('1 minute ago')
    expect(formatLastActionRelative('2026-05-24T11:55:00.000Z', NOW_MS)).toBe('5 minutes ago')
    expect(formatLastActionRelative('2026-05-24T11:01:00.000Z', NOW_MS)).toBe('59 minutes ago')
  })

  it('returns hour-bucketed labels under a day', () => {
    expect(formatLastActionRelative('2026-05-24T11:00:00.000Z', NOW_MS)).toBe('1 hour ago')
    expect(formatLastActionRelative('2026-05-24T05:00:00.000Z', NOW_MS)).toBe('7 hours ago')
  })

  it('returns day-bucketed labels beyond a day', () => {
    expect(formatLastActionRelative('2026-05-23T12:00:00.000Z', NOW_MS)).toBe('1 day ago')
    expect(formatLastActionRelative('2026-05-20T12:00:00.000Z', NOW_MS)).toBe('4 days ago')
  })
})

describe('formatLastActionAbsolute', () => {
  it('returns null for null input', () => {
    expect(formatLastActionAbsolute(null)).toBeNull()
  })

  it('returns the input verbatim when unparseable', () => {
    expect(formatLastActionAbsolute('not-a-timestamp')).toBe('not-a-timestamp')
  })

  it('formats a parseable input in UTC with month + day + time', () => {
    const out = formatLastActionAbsolute('2026-05-24T12:00:00.000Z')
    expect(out).not.toBeNull()
    expect(out).toMatch(/2026/)
    expect(out).toMatch(/UTC/)
  })
})

describe('resolveAlivenessSignal', () => {
  it('returns null today (Hermes bridge not wired)', async () => {
    const signal = await resolveAlivenessSignal(makeSubscription())
    expect(signal).toBeNull()
  })

  it('returns null for any subscription shape (empty-state contract)', async () => {
    const provisioning = await resolveAlivenessSignal(makeSubscription({ status: 'provisioning' }))
    const paused = await resolveAlivenessSignal(makeSubscription({ status: 'paused' }))
    expect(provisioning).toBeNull()
    expect(paused).toBeNull()
  })
})
