/**
 * Tests for the voice-gate panel layer.
 *
 * Covers:
 *   - input validation (production minimums per voice-gate-fallback.md §Contract)
 *   - authorship label stripping in presentation order
 *   - deterministic seeded shuffle (reproducibility)
 *   - identification recording + idempotent overwrite
 *   - judge / draft membership guards
 */

import { describe, it, expect } from 'vitest'

import {
  PRODUCTION_MIN_DRAFTS_PER_AUTHORSHIP,
  PRODUCTION_MIN_JUDGES,
  PanelSession,
  presentDraft,
  validatePanelInput,
} from '../ai-employee/voice-gate/index.js'
import type {
  BlindTestDraft,
  CreatePanelSessionInput,
  RecipientCohort,
} from '../ai-employee/voice-gate/index.js'

function draft(
  id: string,
  cohort: RecipientCohort,
  authorship: 'customer' | 'agent',
  metadata?: BlindTestDraft['metadata']
): BlindTestDraft {
  const d: BlindTestDraft = { id, cohort, authorship, body: `body for ${id}` }
  if (metadata) d.metadata = metadata
  return d
}

function minimalInput(overrides: Partial<CreatePanelSessionInput> = {}): CreatePanelSessionInput {
  return {
    customer_slug: 'test-firm',
    cohort: 'client',
    run_id: 'run-test',
    drafts: [draft('d-customer-1', 'client', 'customer'), draft('d-agent-1', 'client', 'agent')],
    panel: ['judge-A'],
    cycle_count: 0,
    ...overrides,
  }
}

describe('validatePanelInput — required fields', () => {
  it('passes a minimal valid input', () => {
    expect(validatePanelInput(minimalInput())).toEqual([])
  })

  it('flags missing customer_slug', () => {
    const problems = validatePanelInput(minimalInput({ customer_slug: '   ' }))
    expect(problems).toContain('customer_slug is required')
  })

  it('flags missing run_id', () => {
    const problems = validatePanelInput(minimalInput({ run_id: '' }))
    expect(problems).toContain('run_id is required')
  })

  it('flags negative cycle_count', () => {
    const problems = validatePanelInput(minimalInput({ cycle_count: -1 }))
    expect(problems).toContain('cycle_count must be a non-negative integer')
  })

  it('flags non-integer cycle_count', () => {
    const problems = validatePanelInput(minimalInput({ cycle_count: 1.5 }))
    expect(problems).toContain('cycle_count must be a non-negative integer')
  })

  it('flags empty drafts array', () => {
    const problems = validatePanelInput(minimalInput({ drafts: [] }))
    expect(problems).toContain('at least one draft required')
  })

  it('flags missing customer-authored drafts', () => {
    const problems = validatePanelInput(minimalInput({ drafts: [draft('d-1', 'client', 'agent')] }))
    expect(problems).toContain('no customer-authored drafts provided')
  })

  it('flags missing agent-drafted drafts', () => {
    const problems = validatePanelInput(
      minimalInput({ drafts: [draft('d-1', 'client', 'customer')] })
    )
    expect(problems).toContain('no agent-drafted drafts provided')
  })
})

describe('validatePanelInput — cohort consistency', () => {
  it('flags drafts from the wrong cohort in cohort-scoped run', () => {
    const problems = validatePanelInput(
      minimalInput({
        cohort: 'client',
        drafts: [
          draft('d-customer-1', 'client', 'customer'),
          draft('d-agent-1', 'opposing-counsel', 'agent'), // wrong cohort
        ],
      })
    )
    expect(problems.some((p) => p.includes('cohort-scoped session'))).toBe(true)
  })

  it("flags missing cohorts in 'all' run", () => {
    const problems = validatePanelInput(
      minimalInput({
        cohort: 'all',
        drafts: [draft('d-c1', 'client', 'customer'), draft('d-a1', 'client', 'agent')],
      })
    )
    expect(problems.some((p) => p.includes("'all' cohort run missing drafts"))).toBe(true)
  })

  it("accepts 'all' run with every cohort represented", () => {
    const problems = validatePanelInput(
      minimalInput({
        cohort: 'all',
        drafts: [
          draft('d-c-cust', 'client', 'customer'),
          draft('d-c-ag', 'client', 'agent'),
          draft('d-oc-cust', 'opposing-counsel', 'customer'),
          draft('d-oc-ag', 'opposing-counsel', 'agent'),
          draft('d-it-cust', 'internal-team', 'customer'),
          draft('d-it-ag', 'internal-team', 'agent'),
        ],
      })
    )
    expect(problems).toEqual([])
  })
})

describe('validatePanelInput — production minimums', () => {
  it('does NOT enforce minimums in synthetic mode (default)', () => {
    expect(validatePanelInput(minimalInput())).toEqual([])
  })

  it('enforces minimums when option set', () => {
    const problems = validatePanelInput(minimalInput(), {
      enforceProductionMinimums: true,
    })
    expect(problems.some((p) => p.includes(`(need ${PRODUCTION_MIN_DRAFTS_PER_AUTHORSHIP})`))).toBe(
      true
    )
    expect(problems.some((p) => p.includes(`(need ${PRODUCTION_MIN_JUDGES})`))).toBe(true)
  })

  it('accepts a panel that meets minimums', () => {
    const drafts: BlindTestDraft[] = []
    for (let i = 0; i < PRODUCTION_MIN_DRAFTS_PER_AUTHORSHIP; i++) {
      drafts.push(draft(`c-${i}`, 'client', 'customer'))
      drafts.push(draft(`a-${i}`, 'client', 'agent'))
    }
    const panel: string[] = []
    for (let i = 0; i < PRODUCTION_MIN_JUDGES; i++) {
      panel.push(`judge-${i}`)
    }
    const problems = validatePanelInput(minimalInput({ drafts, panel }), {
      enforceProductionMinimums: true,
    })
    expect(problems).toEqual([])
  })
})

describe('validatePanelInput — duplicates', () => {
  it('flags duplicate draft IDs', () => {
    const problems = validatePanelInput(
      minimalInput({
        drafts: [draft('dup', 'client', 'customer'), draft('dup', 'client', 'agent')],
      })
    )
    expect(problems.some((p) => p.includes('duplicate draft IDs'))).toBe(true)
  })

  it('flags duplicate judge IDs', () => {
    const problems = validatePanelInput(minimalInput({ panel: ['judge-A', 'judge-A'] }))
    expect(problems.some((p) => p.includes('duplicate judge IDs'))).toBe(true)
  })
})

describe('presentDraft — authorship stripping', () => {
  it('strips the authorship label', () => {
    const d = draft('d-1', 'client', 'agent')
    const presented = presentDraft(d)
    expect(presented).not.toHaveProperty('authorship')
  })

  it('omits metadata fields by default', () => {
    const d = draft('d-1', 'client', 'agent', {
      subject: 'should be hidden',
      includeInPresentation: false,
    })
    const presented = presentDraft(d)
    expect(presented.subject).toBeUndefined()
  })

  it('includes metadata when includeInPresentation is true', () => {
    const d = draft('d-1', 'client', 'agent', {
      subject: 'Update on your case',
      scenario: 'weekly touchpoint',
      includeInPresentation: true,
    })
    const presented = presentDraft(d)
    expect(presented.subject).toBe('Update on your case')
    expect(presented.scenario).toBe('weekly touchpoint')
  })
})

describe('PanelSession — deterministic shuffle', () => {
  it('produces identical order for the same run_id', () => {
    const drafts: BlindTestDraft[] = []
    for (let i = 0; i < 10; i++) {
      drafts.push(draft(`c-${i}`, 'client', 'customer'))
      drafts.push(draft(`a-${i}`, 'client', 'agent'))
    }
    const s1 = new PanelSession(minimalInput({ run_id: 'seed-x', drafts }))
    const s2 = new PanelSession(minimalInput({ run_id: 'seed-x', drafts }))
    expect(s1.presentationOrder().map((d) => d.id)).toEqual(s2.presentationOrder().map((d) => d.id))
  })

  it('produces different order for different run_ids', () => {
    const drafts: BlindTestDraft[] = []
    for (let i = 0; i < 10; i++) {
      drafts.push(draft(`c-${i}`, 'client', 'customer'))
      drafts.push(draft(`a-${i}`, 'client', 'agent'))
    }
    const s1 = new PanelSession(minimalInput({ run_id: 'seed-A', drafts }))
    const s2 = new PanelSession(minimalInput({ run_id: 'seed-B', drafts }))
    expect(s1.presentationOrder().map((d) => d.id)).not.toEqual(
      s2.presentationOrder().map((d) => d.id)
    )
  })

  it('preserves every draft (no drops, no duplicates)', () => {
    const drafts: BlindTestDraft[] = []
    for (let i = 0; i < 20; i++) {
      drafts.push(draft(`d-${i}`, 'client', i % 2 === 0 ? 'customer' : 'agent'))
    }
    const s = new PanelSession(minimalInput({ drafts }))
    const ids = s.presentationOrder().map((d) => d.id)
    expect(ids).toHaveLength(20)
    expect(new Set(ids).size).toBe(20)
  })
})

describe('PanelSession — recordIdentification', () => {
  it('rejects judges not on the panel', () => {
    const s = new PanelSession(minimalInput({ panel: ['judge-A'] }))
    expect(() =>
      s.recordIdentification({
        draft_id: 'd-customer-1',
        judge_id: 'judge-X',
        choice: 'customer',
      })
    ).toThrow(/not on this panel/)
  })

  it('rejects drafts not in the session', () => {
    const s = new PanelSession(minimalInput())
    expect(() =>
      s.recordIdentification({
        draft_id: 'd-not-here',
        judge_id: 'judge-A',
        choice: 'customer',
      })
    ).toThrow(/not in this session/)
  })

  it('returns true when recording a new identification', () => {
    const s = new PanelSession(minimalInput())
    expect(
      s.recordIdentification({
        draft_id: 'd-agent-1',
        judge_id: 'judge-A',
        choice: 'customer',
      })
    ).toBe(true)
  })

  it('returns false when replacing an existing identification', () => {
    const s = new PanelSession(minimalInput())
    s.recordIdentification({
      draft_id: 'd-agent-1',
      judge_id: 'judge-A',
      choice: 'customer',
    })
    expect(
      s.recordIdentification({
        draft_id: 'd-agent-1',
        judge_id: 'judge-A',
        choice: 'agent',
      })
    ).toBe(false)
    expect(s.run.identifications).toHaveLength(1)
    expect(s.run.identifications[0]?.choice).toBe('agent')
  })

  it('isComplete returns true only when every (judge, draft) pair has been identified', () => {
    const s = new PanelSession(minimalInput({ panel: ['j1', 'j2'] }))
    expect(s.isComplete()).toBe(false)
    s.recordIdentification({
      draft_id: 'd-customer-1',
      judge_id: 'j1',
      choice: 'customer',
    })
    s.recordIdentification({
      draft_id: 'd-agent-1',
      judge_id: 'j1',
      choice: 'customer',
    })
    s.recordIdentification({
      draft_id: 'd-customer-1',
      judge_id: 'j2',
      choice: 'customer',
    })
    expect(s.isComplete()).toBe(false)
    s.recordIdentification({
      draft_id: 'd-agent-1',
      judge_id: 'j2',
      choice: 'agent',
    })
    expect(s.isComplete()).toBe(true)
  })
})

describe('PanelSession — seal', () => {
  it('sets scored_at on the run', () => {
    const s = new PanelSession(minimalInput())
    expect(s.run.scored_at).toBeNull()
    const sealed = s.seal('2026-05-21T12:00:00Z')
    expect(sealed.scored_at).toBe('2026-05-21T12:00:00Z')
  })

  it('throws if any required field is invalid', () => {
    expect(() => new PanelSession(minimalInput({ run_id: '' }))).toThrow()
  })
})
