/**
 * Voice-gate harness cohort-extension tests (#857).
 *
 * Verifies the cohort vocabulary expansion (added `court` and `internal`
 * alongside the legacy `internal-team` alias) keeps the panel + scoring
 * + missing-cohort contracts intact, and that the legacy alias still
 * loads.
 */

import { describe, it, expect } from 'vitest'

import {
  REQUIRED_COHORTS_FOR_ALL_RUN,
  RECIPIENT_COHORTS,
  missingRequiredCohorts,
  scoreRun,
  validatePanelInput,
  type BlindTestDraft,
  type BlindTestRun,
  type JudgeIdentification,
  type RecipientCohort,
} from '../operator/voice-gate/index.js'

function draft(
  id: string,
  cohort: RecipientCohort,
  authorship: 'customer' | 'agent'
): BlindTestDraft {
  return { id, cohort, authorship, body: `body for ${id}` }
}

function ident(
  draft_id: string,
  judge_id: string,
  choice: 'customer' | 'agent'
): JudgeIdentification {
  return { draft_id, judge_id, choice }
}

describe('cohort vocabulary alignment (#857)', () => {
  it('union includes court + internal + the legacy internal-team alias', () => {
    expect(RECIPIENT_COHORTS).toContain('court')
    expect(RECIPIENT_COHORTS).toContain('internal')
    expect(RECIPIENT_COHORTS).toContain('internal-team')
  })

  it('required-for-all-run baseline does NOT force court', () => {
    // PRD §9.3 baseline is the three historical cohorts. Court is
    // accepted but optional so transactional firms can pass an 'all'
    // run without faking court drafts.
    expect(REQUIRED_COHORTS_FOR_ALL_RUN).toEqual(['client', 'opposing-counsel'])
    expect(REQUIRED_COHORTS_FOR_ALL_RUN).not.toContain('court')
  })

  it('missingRequiredCohorts treats internal-team as satisfying internal', () => {
    const seen = new Set<RecipientCohort>(['client', 'opposing-counsel', 'internal-team'])
    expect(missingRequiredCohorts(seen)).toEqual([])
  })

  it('missingRequiredCohorts surfaces missing client / opposing-counsel slots', () => {
    expect(missingRequiredCohorts(new Set<RecipientCohort>(['internal']))).toEqual([
      'client',
      'opposing-counsel',
    ])
  })

  it('missingRequiredCohorts surfaces missing internal slot', () => {
    expect(
      missingRequiredCohorts(new Set<RecipientCohort>(['client', 'opposing-counsel']))
    ).toEqual(['internal'])
  })
})

describe("panel layer 'all' coverage with the new vocabulary", () => {
  it("accepts an 'all' run with the legacy three cohorts (back-compat)", () => {
    const problems = validatePanelInput({
      customer_slug: 'smith-pi-firm',
      cohort: 'all',
      panel: ['j1'],
      run_id: 'r1',
      cycle_count: 0,
      drafts: [
        draft('d1', 'client', 'customer'),
        draft('d2', 'client', 'agent'),
        draft('d3', 'opposing-counsel', 'customer'),
        draft('d4', 'opposing-counsel', 'agent'),
        draft('d5', 'internal-team', 'customer'),
        draft('d6', 'internal-team', 'agent'),
      ],
    })
    expect(problems).toEqual([])
  })

  it("accepts an 'all' run that mixes internal + internal-team labels", () => {
    const problems = validatePanelInput({
      customer_slug: 'smith-pi-firm',
      cohort: 'all',
      panel: ['j1'],
      run_id: 'r1',
      cycle_count: 0,
      drafts: [
        draft('d1', 'client', 'customer'),
        draft('d2', 'client', 'agent'),
        draft('d3', 'opposing-counsel', 'customer'),
        draft('d4', 'opposing-counsel', 'agent'),
        draft('d5', 'internal', 'customer'),
        draft('d6', 'internal', 'agent'),
      ],
    })
    expect(problems).toEqual([])
  })

  it("accepts an 'all' run with court drafts but no required cohort missing", () => {
    const problems = validatePanelInput({
      customer_slug: 'smith-pi-firm',
      cohort: 'all',
      panel: ['j1'],
      run_id: 'r1',
      cycle_count: 0,
      drafts: [
        draft('d1', 'client', 'customer'),
        draft('d2', 'client', 'agent'),
        draft('d3', 'opposing-counsel', 'customer'),
        draft('d4', 'opposing-counsel', 'agent'),
        draft('d5', 'internal', 'customer'),
        draft('d6', 'internal', 'agent'),
        draft('d7', 'court', 'customer'),
        draft('d8', 'court', 'agent'),
      ],
    })
    expect(problems).toEqual([])
  })

  it("flags missing required cohorts in an 'all' run", () => {
    const problems = validatePanelInput({
      customer_slug: 'smith-pi-firm',
      cohort: 'all',
      panel: ['j1'],
      run_id: 'r1',
      cycle_count: 0,
      drafts: [draft('d1', 'client', 'customer'), draft('d2', 'client', 'agent')],
    })
    expect(problems.some((p) => p.includes('opposing-counsel'))).toBe(true)
    expect(problems.some((p) => p.includes('internal'))).toBe(true)
  })

  it("does NOT flag missing court for 'all' run that covers the three baseline cohorts", () => {
    const problems = validatePanelInput({
      customer_slug: 'smith-pi-firm',
      cohort: 'all',
      panel: ['j1'],
      run_id: 'r1',
      cycle_count: 0,
      drafts: [
        draft('d1', 'client', 'customer'),
        draft('d2', 'client', 'agent'),
        draft('d3', 'opposing-counsel', 'customer'),
        draft('d4', 'opposing-counsel', 'agent'),
        draft('d5', 'internal', 'customer'),
        draft('d6', 'internal', 'agent'),
      ],
    })
    expect(problems.join(' ')).not.toContain('court')
  })
})

describe('scoring with the extended vocabulary', () => {
  function buildRun(drafts: BlindTestDraft[], idents: JudgeIdentification[]): BlindTestRun {
    return {
      run_id: 'r-857',
      customer_slug: 'smith-pi-firm',
      cohort: 'all',
      started_at: '2026-05-24T00:00:00Z',
      scored_at: null,
      drafts,
      panel: ['j1'],
      identifications: idents,
      cycle_count: 0,
    }
  }

  it('per_cohort breakdown includes court when court drafts are present', () => {
    const drafts: BlindTestDraft[] = [
      draft('d-c1', 'client', 'customer'),
      draft('d-c2', 'client', 'agent'),
      draft('d-court1', 'court', 'customer'),
      draft('d-court2', 'court', 'agent'),
      draft('d-oc1', 'opposing-counsel', 'customer'),
      draft('d-oc2', 'opposing-counsel', 'agent'),
      draft('d-int1', 'internal', 'customer'),
      draft('d-int2', 'internal', 'agent'),
    ]
    const idents = drafts.map((d) => ident(d.id, 'j1', 'customer'))
    const result = scoreRun(buildRun(drafts, idents))
    expect(result.per_cohort?.court.total_agent_judgments).toBe(1)
  })

  it('per_cohort below_threshold_cohorts excludes absent cohorts', () => {
    // Only client + opposing-counsel + internal cohorts present; court
    // absent. Score them all poorly so threshold logic exercises the
    // 0-count filter for absent cohorts.
    const drafts: BlindTestDraft[] = [
      draft('d-c1', 'client', 'customer'),
      draft('d-c2', 'client', 'agent'),
      draft('d-oc1', 'opposing-counsel', 'customer'),
      draft('d-oc2', 'opposing-counsel', 'agent'),
      draft('d-int1', 'internal', 'customer'),
      draft('d-int2', 'internal', 'agent'),
    ]
    // Every judge correctly identifies agent drafts → 0% indistinguishability
    const idents: JudgeIdentification[] = [
      ident('d-c1', 'j1', 'customer'),
      ident('d-c2', 'j1', 'agent'),
      ident('d-oc1', 'j1', 'customer'),
      ident('d-oc2', 'j1', 'agent'),
      ident('d-int1', 'j1', 'customer'),
      ident('d-int2', 'j1', 'agent'),
    ]
    const result = scoreRun(buildRun(drafts, idents))
    expect(result.state).toBe('fail')
    // court NOT in below_threshold_cohorts despite being in
    // RECIPIENT_COHORTS — because it had zero judgments in this run.
    expect(result.failure_record?.below_threshold_cohorts).not.toContain('court')
    expect(result.failure_record?.below_threshold_cohorts).toContain('client')
    expect(result.failure_record?.below_threshold_cohorts).toContain('opposing-counsel')
    expect(result.failure_record?.below_threshold_cohorts).toContain('internal')
  })
})
