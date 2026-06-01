/**
 * Tests for the Operator matters resolver and supporting formatters
 * (src/lib/portal/operator/matters.ts).
 *
 * The resolvers themselves are intentionally thin until the per-customer
 * Hermes Machine D1 bridge lands (#821): `listMatters` returns an empty
 * array, `getMatter` returns null. These tests pin that contract so a
 * later regression (e.g., someone adds placeholder rows) trips the
 * suite. The Pattern A/B audit in CLAUDE.md treats invented client-
 * facing content as a P0 violation; the empty-list contract is the
 * structural enforcement.
 *
 * The formatters (`formatMatterAge`, `resolveMatterPhaseStamp`,
 * `resolveMatterPhaseTone`) are pure — full coverage here because the
 * surfaces depend on their return shapes verbatim.
 */

import { describe, it, expect } from 'vitest'
import { createTestD1 } from '@venturecrane/crane-test-harness'
import {
  filterMattersByAssignee,
  listMatters,
  getMatter,
  formatMatterAge,
  resolveMatterPhaseStamp,
  resolveMatterPhaseTone,
  MATTER_PHASE_LABEL,
  type Matter,
  type MatterPhase,
} from '../src/lib/portal/operator/matters'

describe('listMatters — empty state contract', () => {
  it('returns an empty array (Hermes bridge not landed; #821)', async () => {
    const db = createTestD1()
    const result = await listMatters(db, 'entity-anything')
    expect(result).toEqual([])
  })

  it('returns an empty array regardless of entity id', async () => {
    const db = createTestD1()
    const result1 = await listMatters(db, 'entity-a')
    const result2 = await listMatters(db, 'entity-b')
    expect(result1).toEqual([])
    expect(result2).toEqual([])
  })
})

describe('getMatter — empty state contract', () => {
  it('returns null for any matter id (Hermes bridge not landed; #821)', async () => {
    const db = createTestD1()
    const result = await getMatter(db, 'entity-anything', 'matter-anything')
    expect(result).toBeNull()
  })
})

describe('formatMatterAge', () => {
  // Anchor "now" so tests are deterministic regardless of when they run.
  const NOW = new Date('2026-06-15T12:00:00Z')

  it('returns empty string for nullish input', () => {
    expect(formatMatterAge(null, NOW)).toBe('')
    expect(formatMatterAge(undefined, NOW)).toBe('')
    expect(formatMatterAge('', NOW)).toBe('')
  })

  it('returns empty string for invalid ISO input', () => {
    expect(formatMatterAge('not a date', NOW)).toBe('')
  })

  it('returns "Opened today" for the same calendar day', () => {
    expect(formatMatterAge('2026-06-15T09:00:00Z', NOW)).toBe('Opened today')
  })

  it('returns "Opened today" for a future date (clock skew tolerance)', () => {
    expect(formatMatterAge('2026-06-16T00:00:00Z', NOW)).toBe('Opened today')
  })

  it('returns "Opened 1d ago" for one day prior', () => {
    expect(formatMatterAge('2026-06-14T12:00:00Z', NOW)).toBe('Opened 1d ago')
  })

  it('returns "Opened Nd ago" for less than a month', () => {
    expect(formatMatterAge('2026-06-01T12:00:00Z', NOW)).toBe('Opened 14d ago')
  })

  it('returns "Opened 1mo ago" for one month prior', () => {
    expect(formatMatterAge('2026-05-15T12:00:00Z', NOW)).toBe('Opened 1mo ago')
  })

  it('returns "Opened Nmo ago" for less than a year', () => {
    expect(formatMatterAge('2026-01-15T12:00:00Z', NOW)).toBe('Opened 5mo ago')
  })

  it('returns "Opened 1yr ago" for one year prior', () => {
    expect(formatMatterAge('2025-06-15T12:00:00Z', NOW)).toBe('Opened 1yr ago')
  })

  it('returns "Opened Nyr ago" for multiple years prior', () => {
    expect(formatMatterAge('2023-06-15T12:00:00Z', NOW)).toBe('Opened 3yr ago')
  })
})

describe('resolveMatterPhaseStamp', () => {
  const cases: Array<[MatterPhase, string]> = [
    ['pre_suit', 'PRE-SUIT'],
    ['discovery', 'DISCOVERY'],
    ['pre_trial', 'PRE-TRIAL'],
  ]
  for (const [phase, expected] of cases) {
    it(`maps ${phase} → ${expected}`, () => {
      expect(resolveMatterPhaseStamp(phase)).toBe(expected)
    })
  }
})

describe('resolveMatterPhaseTone', () => {
  it('escalates tone with lifecycle position', () => {
    expect(resolveMatterPhaseTone('pre_suit')).toBe('info')
    expect(resolveMatterPhaseTone('discovery')).toBe('warning')
    expect(resolveMatterPhaseTone('pre_trial')).toBe('outline')
  })
})

describe('MATTER_PHASE_LABEL', () => {
  it('provides a human-readable label for every phase', () => {
    expect(MATTER_PHASE_LABEL.pre_suit).toBe('Pre-Suit')
    expect(MATTER_PHASE_LABEL.discovery).toBe('Discovery')
    expect(MATTER_PHASE_LABEL.pre_trial).toBe('Pre-Trial')
  })
})

describe('filterMattersByAssignee', () => {
  function makeMatter(id: string): Matter {
    return {
      id,
      clientName: `Client ${id}`,
      matterType: 'Auto Accident',
      phase: 'pre_suit',
      openedAt: '2026-05-01T00:00:00Z',
      lastAction: null,
      assigneeUserIds: [],
    }
  }

  it('returns the subset whose id is in the assigned set', () => {
    const matters: Matter[] = [
      makeMatter('matter-smith'),
      makeMatter('matter-jones'),
      makeMatter('matter-doe'),
    ]
    const result = filterMattersByAssignee(matters, new Set(['matter-smith', 'matter-doe']))
    expect(result.map((m) => m.id)).toEqual(['matter-smith', 'matter-doe'])
  })

  it('returns empty array when the assigned set is empty (mine view, no assignments)', () => {
    const matters: Matter[] = [makeMatter('matter-smith')]
    expect(filterMattersByAssignee(matters, new Set())).toEqual([])
  })

  it('returns empty array when the matter list is empty', () => {
    expect(filterMattersByAssignee([], new Set(['matter-smith']))).toEqual([])
  })

  it('preserves the source order of matters', () => {
    const matters: Matter[] = [
      makeMatter('m-1'),
      makeMatter('m-2'),
      makeMatter('m-3'),
      makeMatter('m-4'),
    ]
    const result = filterMattersByAssignee(matters, new Set(['m-3', 'm-1', 'm-4']))
    expect(result.map((m) => m.id)).toEqual(['m-1', 'm-3', 'm-4'])
  })
})
