/**
 * Tests for the Operator calibration session workflow
 * (src/lib/portal/operator/calibration.ts).
 *
 * The lib declares the four-session schema, the closed vocabulary of
 * session kinds + states, and projects a calibration cycle from a
 * customer config row. The data-capture mechanics are deferred to
 * issue #821; today's resolver always returns null and the page
 * renders the empty state. The tests cover the closed vocabulary
 * helpers, the framing builder, the default session row builder, and
 * the resolver contract (returns null today, will return a cycle
 * when the writer lands).
 *
 * Per the issue acceptance criteria the required framing is
 * "Operator assists [Partner from getActivePersona()]; never
 * replaces them." The framing is built in `buildAssistantFraming`
 * which takes a persona name (the resolved active persona) and
 * returns the literal sentence. No fabrication; no fallback persona
 * name — null persona means the page renders the empty state and
 * suppresses the framing entirely.
 */

import { describe, it, expect } from 'vitest'
import {
  buildAssistantFraming,
  buildDefaultSessionRows,
  CALIBRATION_SESSION_KINDS,
  CALIBRATION_SESSION_MINUTES,
  CALIBRATION_SESSION_STATES,
  CALIBRATION_SESSIONS_PER_CYCLE,
  CALIBRATION_WINDOW_DAYS,
  describeCalibrationSessionKind,
  formatCalibrationCycleState,
  formatCalibrationSessionKind,
  formatCalibrationSessionState,
  getActiveCalibrationCycle,
  isCalibrationSessionKind,
  isCalibrationSessionState,
  type CalibrationCycleState,
  type CalibrationSessionKind,
  type CalibrationSessionState,
} from '../src/lib/portal/operator/calibration'
import type { PersonaConfig } from '../src/lib/portal/customer-config'

function makePersona(overrides?: Partial<PersonaConfig>): PersonaConfig {
  return {
    slug: 'marcus',
    status: 'active',
    name: 'Marcus',
    title: null,
    signature_html: null,
    tone: [],
    send_as: null,
    skills: [],
    channel_bindings: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Closed vocabulary: session kinds
// ---------------------------------------------------------------------------

describe('CALIBRATION_SESSION_KINDS', () => {
  it('exposes the four canonical session kinds in scheduling order', () => {
    expect(CALIBRATION_SESSION_KINDS).toEqual([
      'voice_calibration',
      'skill_calibration',
      'trust_ceiling',
      'integration_handoff',
    ])
  })

  it('declares CALIBRATION_SESSIONS_PER_CYCLE equal to its length', () => {
    expect(CALIBRATION_SESSIONS_PER_CYCLE).toBe(CALIBRATION_SESSION_KINDS.length)
    expect(CALIBRATION_SESSIONS_PER_CYCLE).toBe(4)
  })
})

describe('isCalibrationSessionKind', () => {
  it('accepts the four canonical values', () => {
    expect(isCalibrationSessionKind('voice_calibration')).toBe(true)
    expect(isCalibrationSessionKind('skill_calibration')).toBe(true)
    expect(isCalibrationSessionKind('trust_ceiling')).toBe(true)
    expect(isCalibrationSessionKind('integration_handoff')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isCalibrationSessionKind('VOICE_CALIBRATION')).toBe(false)
    expect(isCalibrationSessionKind('handoff')).toBe(false)
    expect(isCalibrationSessionKind('')).toBe(false)
    expect(isCalibrationSessionKind(null)).toBe(false)
    expect(isCalibrationSessionKind(undefined)).toBe(false)
    expect(isCalibrationSessionKind(0)).toBe(false)
    expect(isCalibrationSessionKind(['voice_calibration'])).toBe(false)
  })
})

describe('formatCalibrationSessionKind', () => {
  it('maps every kind to a friendly label', () => {
    const cases: Array<[CalibrationSessionKind, string]> = [
      ['voice_calibration', 'Voice calibration'],
      ['skill_calibration', 'Skill calibration'],
      ['trust_ceiling', 'Trust-ceiling refinement'],
      ['integration_handoff', 'Integration and handoff'],
    ]
    for (const [kind, expected] of cases) {
      expect(formatCalibrationSessionKind(kind)).toBe(expected)
    }
  })
})

describe('describeCalibrationSessionKind', () => {
  it('returns a non-empty description for every kind', () => {
    for (const kind of CALIBRATION_SESSION_KINDS) {
      const description = describeCalibrationSessionKind(kind)
      expect(description.length).toBeGreaterThan(0)
    }
  })

  it('mentions the partner in voice and skill sessions', () => {
    expect(describeCalibrationSessionKind('voice_calibration')).toMatch(/partner/i)
    expect(describeCalibrationSessionKind('skill_calibration')).toMatch(/partner/i)
  })

  it('mentions the principal in the trust-ceiling session', () => {
    expect(describeCalibrationSessionKind('trust_ceiling')).toMatch(/principal/i)
  })

  it('descriptions are short single sentences (under 160 chars)', () => {
    for (const kind of CALIBRATION_SESSION_KINDS) {
      const description = describeCalibrationSessionKind(kind)
      expect(description.length).toBeLessThanOrEqual(160)
    }
  })
})

// ---------------------------------------------------------------------------
// Closed vocabulary: session state
// ---------------------------------------------------------------------------

describe('CALIBRATION_SESSION_STATES', () => {
  it('exposes the four canonical states in lifecycle order', () => {
    expect(CALIBRATION_SESSION_STATES).toEqual(['pending', 'in_progress', 'completed', 'skipped'])
  })
})

describe('isCalibrationSessionState', () => {
  it('accepts every canonical state', () => {
    for (const state of CALIBRATION_SESSION_STATES) {
      expect(isCalibrationSessionState(state)).toBe(true)
    }
  })

  it('rejects anything else', () => {
    expect(isCalibrationSessionState('PENDING')).toBe(false)
    expect(isCalibrationSessionState('archived')).toBe(false)
    expect(isCalibrationSessionState('')).toBe(false)
    expect(isCalibrationSessionState(null)).toBe(false)
    expect(isCalibrationSessionState(undefined)).toBe(false)
  })
})

describe('formatCalibrationSessionState', () => {
  it('maps every state to a friendly label', () => {
    const cases: Array<[CalibrationSessionState, string]> = [
      ['pending', 'Scheduled'],
      ['in_progress', 'In progress'],
      ['completed', 'Completed'],
      ['skipped', 'Skipped'],
    ]
    for (const [state, expected] of cases) {
      expect(formatCalibrationSessionState(state)).toBe(expected)
    }
  })
})

// ---------------------------------------------------------------------------
// Cycle state
// ---------------------------------------------------------------------------

describe('formatCalibrationCycleState', () => {
  it('maps every cycle state to a friendly label', () => {
    const cases: Array<[CalibrationCycleState, string]> = [
      ['not_started', 'Not started'],
      ['active', 'In progress'],
      ['completed', 'Completed'],
      ['archived', 'Archived'],
    ]
    for (const [state, expected] of cases) {
      expect(formatCalibrationCycleState(state)).toBe(expected)
    }
  })
})

// ---------------------------------------------------------------------------
// Required framing
// ---------------------------------------------------------------------------

describe('buildAssistantFraming', () => {
  it('uses the persona name on both sides of the sentence', () => {
    const framing = buildAssistantFraming('Marcus')
    expect(framing).toBe('Marcus assists the partner; Marcus never replaces them.')
  })

  it('names the assist relationship before naming the not-replace one', () => {
    const framing = buildAssistantFraming('Marcus')
    const assistsAt = framing.indexOf('assists')
    const neverAt = framing.indexOf('never')
    expect(assistsAt).toBeGreaterThan(-1)
    expect(neverAt).toBeGreaterThan(-1)
    expect(assistsAt).toBeLessThan(neverAt)
  })

  it('uses the literal persona name passed in (no normalization)', () => {
    expect(buildAssistantFraming('Karen Chen')).toMatch(/^Karen Chen assists/)
  })

  it('never contains em dashes (per CLAUDE.md tone standard)', () => {
    const framing = buildAssistantFraming('Marcus')
    expect(framing).not.toMatch(/—/)
  })
})

// ---------------------------------------------------------------------------
// Window planning constants
// ---------------------------------------------------------------------------

describe('window planning constants', () => {
  it('CALIBRATION_WINDOW_DAYS is fourteen days', () => {
    expect(CALIBRATION_WINDOW_DAYS).toBe(14)
  })

  it('CALIBRATION_SESSION_MINUTES is ninety minutes', () => {
    expect(CALIBRATION_SESSION_MINUTES).toBe(90)
  })

  it('CALIBRATION_SESSIONS_PER_CYCLE is four', () => {
    expect(CALIBRATION_SESSIONS_PER_CYCLE).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Default session rows
// ---------------------------------------------------------------------------

describe('buildDefaultSessionRows', () => {
  it('returns exactly four rows', () => {
    const rows = buildDefaultSessionRows()
    expect(rows).toHaveLength(CALIBRATION_SESSIONS_PER_CYCLE)
  })

  it('rows are in CALIBRATION_SESSION_KINDS order with 1-indexed positions', () => {
    const rows = buildDefaultSessionRows()
    expect(rows.map((r) => r.kind)).toEqual([...CALIBRATION_SESSION_KINDS])
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3, 4])
  })

  it('every row starts pending', () => {
    const rows = buildDefaultSessionRows()
    expect(rows.every((r) => r.state === 'pending')).toBe(true)
  })

  it('row labels match the formatter output for the kind', () => {
    const rows = buildDefaultSessionRows()
    for (const row of rows) {
      expect(row.label).toBe(formatCalibrationSessionKind(row.kind))
    }
  })

  it('row descriptions match the description helper for the kind', () => {
    const rows = buildDefaultSessionRows()
    for (const row of rows) {
      expect(row.description).toBe(describeCalibrationSessionKind(row.kind))
    }
  })
})

// ---------------------------------------------------------------------------
// Resolver contract
// ---------------------------------------------------------------------------

describe('getActiveCalibrationCycle', () => {
  // The resolver is the seam between the portal and the per-customer
  // D1 writer. Today it returns null on every call — the writer lands
  // under issue #821 (Hermes runtime scoping). These tests pin the
  // contract so an accidental fabrication does not slip into the
  // portal under the empty-state branch.

  // A stub D1Database — the resolver does not touch it today.
  const stubDb = {} as unknown as D1Database

  it('returns null when persona is null', async () => {
    const result = await getActiveCalibrationCycle(stubDb, 'entity-1', null)
    expect(result).toBeNull()
  })

  it('returns null when persona exists but no cycle is on file', async () => {
    const persona = makePersona()
    const result = await getActiveCalibrationCycle(stubDb, 'entity-1', persona)
    expect(result).toBeNull()
  })

  it('does not fabricate a cycle for an entity that has none', async () => {
    // Belt-and-suspenders: independent of input, the resolver does
    // not return a synthesized cycle. The empty-state branch on the
    // portal is the load-bearing rule per
    // docs/style/empty-state-pattern.md.
    const persona = makePersona({ slug: 'anything', name: 'Anyone' })
    const result = await getActiveCalibrationCycle(stubDb, 'whatever', persona)
    expect(result).toBeNull()
  })
})
