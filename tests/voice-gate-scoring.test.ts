/**
 * Tests for the voice-gate scoring layer.
 *
 * Covers:
 *   - PRD §9.6 ≥80% pass threshold (single source of truth check)
 *   - voice-gate-fallback.md §Three states band boundaries
 *   - §Near-pass cycle auto-transition rule (third near-pass → fail)
 *   - indistinguishability counts customer + uncertain
 *   - audit_action mapping per d1-schema.md §1
 *
 * Synthetic blind-test runs are constructed directly here rather than
 * loaded from disk so the threshold logic is isolated from fixture +
 * panel concerns.
 */

import { describe, it, expect } from 'vitest'

import {
  RECIPIENT_COHORTS,
  VOICE_GATE_MAX_NEAR_PASS_CYCLES,
  VOICE_GATE_NEAR_PASS_LOWER_PCT,
  VOICE_GATE_PASS_THRESHOLD_PCT,
  auditActionFor,
  buildAuditMetadata,
  scoreRun,
  stateForScore,
} from '../ai-employee/voice-gate/index.js'
import type {
  BlindTestDraft,
  BlindTestRun,
  JudgeChoice,
  JudgeIdentification,
  RecipientCohort,
} from '../ai-employee/voice-gate/index.js'

function draft(
  id: string,
  cohort: RecipientCohort,
  authorship: 'customer' | 'agent'
): BlindTestDraft {
  return { id, cohort, authorship, body: `body for ${id}` }
}

function ident(draft_id: string, judge_id: string, choice: JudgeChoice): JudgeIdentification {
  return { draft_id, judge_id, choice }
}

function makeRun(args: {
  drafts: BlindTestDraft[]
  identifications: JudgeIdentification[]
  cycle_count?: number
  cohort?: RecipientCohort | 'all'
}): BlindTestRun {
  return {
    run_id: 'run-test',
    customer_slug: 'test-firm',
    cohort: args.cohort ?? 'all',
    started_at: '2026-05-21T00:00:00Z',
    scored_at: null,
    drafts: args.drafts,
    panel: [...new Set(args.identifications.map((i) => i.judge_id))],
    identifications: args.identifications,
    cycle_count: args.cycle_count ?? 0,
  }
}

describe('voice-gate threshold constants', () => {
  it('PRD §9.6 pass threshold is encoded as 80', () => {
    expect(VOICE_GATE_PASS_THRESHOLD_PCT).toBe(80)
  })

  it('near-pass band lower bound is 60', () => {
    expect(VOICE_GATE_NEAR_PASS_LOWER_PCT).toBe(60)
  })

  it('max near-pass cycles is 2', () => {
    expect(VOICE_GATE_MAX_NEAR_PASS_CYCLES).toBe(2)
  })

  it('RECIPIENT_COHORTS lists the v1+#857 cohorts', () => {
    // #857 added `court` and `internal` to align the harness with the
    // schema's BASE_VOICE_COHORTS. `internal-team` remains as a legacy
    // alias so archived blind-test runs continue to load.
    expect([...RECIPIENT_COHORTS].sort()).toEqual([
      'client',
      'court',
      'internal',
      'internal-team',
      'opposing-counsel',
    ])
  })
})

describe('stateForScore', () => {
  it('maps 80 to pass (boundary)', () => {
    expect(stateForScore(80)).toBe('pass')
  })

  it('maps 79.9 to near-pass (just below pass)', () => {
    expect(stateForScore(79.9)).toBe('near-pass')
  })

  it('maps 60 to near-pass (boundary)', () => {
    expect(stateForScore(60)).toBe('near-pass')
  })

  it('maps 59.9 to fail (just below near-pass band)', () => {
    expect(stateForScore(59.9)).toBe('fail')
  })

  it('maps 0 to fail', () => {
    expect(stateForScore(0)).toBe('fail')
  })

  it('maps 100 to pass', () => {
    expect(stateForScore(100)).toBe('pass')
  })
})

describe('auditActionFor', () => {
  it('passes through to d1-schema.md §1 action_type values', () => {
    expect(auditActionFor('pass')).toBe('VOICE_GATE_PASSED')
    expect(auditActionFor('near-pass')).toBe('VOICE_GATE_NEAR_PASS')
    expect(auditActionFor('fail')).toBe('VOICE_GATE_FAILED')
  })
})

describe('scoreRun — indistinguishability counts customer + uncertain', () => {
  it('counts "customer" identification of an agent draft as indistinguishable', () => {
    const drafts = [
      draft('d-customer-1', 'client', 'customer'),
      draft('d-agent-1', 'client', 'agent'),
    ]
    const ids = [ident('d-customer-1', 'j1', 'customer'), ident('d-agent-1', 'j1', 'customer')]
    const result = scoreRun(makeRun({ drafts, identifications: ids }))
    expect(result.indistinguishable_count).toBe(1)
    expect(result.total_agent_judgments).toBe(1)
    expect(result.score_pct).toBe(100)
    expect(result.state).toBe('pass')
  })

  it('counts "uncertain" identification of an agent draft as indistinguishable', () => {
    const drafts = [draft('d-agent-1', 'client', 'agent')]
    const ids = [ident('d-agent-1', 'j1', 'uncertain')]
    const result = scoreRun(makeRun({ drafts, identifications: ids }))
    expect(result.indistinguishable_count).toBe(1)
    expect(result.score_pct).toBe(100)
  })

  it('does NOT count "agent" identification of an agent draft as indistinguishable', () => {
    const drafts = [draft('d-agent-1', 'client', 'agent')]
    const ids = [ident('d-agent-1', 'j1', 'agent')]
    const result = scoreRun(makeRun({ drafts, identifications: ids }))
    expect(result.indistinguishable_count).toBe(0)
    expect(result.score_pct).toBe(0)
    expect(result.state).toBe('fail')
  })

  it('ignores judgments on customer-authored drafts when scoring', () => {
    const drafts = [
      draft('d-customer-1', 'client', 'customer'),
      draft('d-agent-1', 'client', 'agent'),
    ]
    const ids = [
      ident('d-customer-1', 'j1', 'agent'), // judge wrong on customer draft — doesn't affect score
      ident('d-agent-1', 'j1', 'customer'), // judge fooled on agent draft — does count
    ]
    const result = scoreRun(makeRun({ drafts, identifications: ids }))
    expect(result.total_agent_judgments).toBe(1)
    expect(result.score_pct).toBe(100)
  })
})

describe('scoreRun — pass / near-pass / fail bands', () => {
  function makeAgentDraftsAndJudgments(
    n: number,
    indistinguishableCount: number
  ): { drafts: BlindTestDraft[]; ids: JudgeIdentification[] } {
    const drafts: BlindTestDraft[] = []
    const ids: JudgeIdentification[] = []
    for (let i = 0; i < n; i++) {
      const did = `d-agent-${i}`
      drafts.push(draft(did, 'client', 'agent'))
      const choice: JudgeChoice = i < indistinguishableCount ? 'customer' : 'agent'
      ids.push(ident(did, 'j1', choice))
    }
    return { drafts, ids }
  }

  it('80/100 agent drafts indistinguishable → pass', () => {
    const { drafts, ids } = makeAgentDraftsAndJudgments(100, 80)
    const result = scoreRun(makeRun({ drafts, identifications: ids }))
    expect(result.score_pct).toBe(80)
    expect(result.state).toBe('pass')
    expect(result.audit_action).toBe('VOICE_GATE_PASSED')
    expect(result.failure_record).toBeUndefined()
    expect(result.near_pass_record).toBeUndefined()
  })

  it('79/100 → near-pass with cycle-count record', () => {
    const { drafts, ids } = makeAgentDraftsAndJudgments(100, 79)
    const result = scoreRun(makeRun({ drafts, identifications: ids }))
    expect(result.score_pct).toBe(79)
    expect(result.state).toBe('near-pass')
    expect(result.audit_action).toBe('VOICE_GATE_NEAR_PASS')
    expect(result.near_pass_record).toBeDefined()
    expect(result.near_pass_record?.cycle_count).toBe(0)
    expect(result.near_pass_record?.is_final_cycle).toBe(false)
    expect(result.near_pass_record?.minimum_days_to_retry).toBe(7)
    expect(result.failure_record).toBeUndefined()
  })

  it('60/100 → near-pass (boundary)', () => {
    const { drafts, ids } = makeAgentDraftsAndJudgments(100, 60)
    const result = scoreRun(makeRun({ drafts, identifications: ids }))
    expect(result.score_pct).toBe(60)
    expect(result.state).toBe('near-pass')
  })

  it('59/100 → fail', () => {
    const { drafts, ids } = makeAgentDraftsAndJudgments(100, 59)
    const result = scoreRun(makeRun({ drafts, identifications: ids }))
    expect(result.score_pct).toBe(59)
    expect(result.state).toBe('fail')
    expect(result.audit_action).toBe('VOICE_GATE_FAILED')
    expect(result.failure_record).toBeDefined()
    expect(result.failure_record?.auto_transitioned_from_near_pass).toBe(false)
  })

  it('emits structured failure record when score < 60%', () => {
    const { drafts, ids } = makeAgentDraftsAndJudgments(100, 30)
    const result = scoreRun(makeRun({ drafts, identifications: ids }))
    expect(result.state).toBe('fail')
    expect(result.failure_record?.score_pct).toBe(30)
    expect(result.failure_record?.recommended_path).toBe('B_pause_engagement')
  })

  it('recommends Path A (internal-only) for marginal fail (50-59%)', () => {
    const { drafts, ids } = makeAgentDraftsAndJudgments(100, 55)
    const result = scoreRun(makeRun({ drafts, identifications: ids }))
    expect(result.failure_record?.recommended_path).toBe('A_internal_drafts_only')
  })

  it('recommends either-path for borderline fail (40-49%)', () => {
    const { drafts, ids } = makeAgentDraftsAndJudgments(100, 45)
    const result = scoreRun(makeRun({ drafts, identifications: ids }))
    expect(result.failure_record?.recommended_path).toBe('either')
  })
})

describe('scoreRun — near-pass cycle auto-transition (voice-gate-fallback.md §Near-pass cycle)', () => {
  function makeNearPass(cycle: number): BlindTestRun {
    // 70/100 — solidly near-pass band
    const drafts: BlindTestDraft[] = []
    const ids: JudgeIdentification[] = []
    for (let i = 0; i < 100; i++) {
      const did = `d-${i}`
      drafts.push(draft(did, 'client', 'agent'))
      ids.push(ident(did, 'j1', i < 70 ? 'customer' : 'agent'))
    }
    return makeRun({ drafts, identifications: ids, cycle_count: cycle })
  }

  it('cycle 0 (first attempt) near-pass → near-pass, not_final', () => {
    const result = scoreRun(makeNearPass(0))
    expect(result.state).toBe('near-pass')
    expect(result.near_pass_record?.is_final_cycle).toBe(false)
  })

  it('cycle 1 (second attempt) near-pass → near-pass, is_final', () => {
    const result = scoreRun(makeNearPass(1))
    expect(result.state).toBe('near-pass')
    expect(result.near_pass_record?.is_final_cycle).toBe(true)
  })

  it('cycle 2 (third attempt) near-pass → AUTO-TRANSITION to fail', () => {
    const result = scoreRun(makeNearPass(2))
    expect(result.state).toBe('fail')
    expect(result.audit_action).toBe('VOICE_GATE_FAILED')
    expect(result.failure_record?.auto_transitioned_from_near_pass).toBe(true)
    expect(result.failure_record?.recommended_path).toBe('A_internal_drafts_only')
  })

  it('cycle 2 with passing score does NOT force fail (only triggers when <80%)', () => {
    const drafts: BlindTestDraft[] = []
    const ids: JudgeIdentification[] = []
    for (let i = 0; i < 100; i++) {
      const did = `d-${i}`
      drafts.push(draft(did, 'client', 'agent'))
      ids.push(ident(did, 'j1', i < 85 ? 'customer' : 'agent'))
    }
    const result = scoreRun(makeRun({ drafts, identifications: ids, cycle_count: 2 }))
    expect(result.state).toBe('pass')
  })
})

describe('scoreRun — per-cohort breakdown', () => {
  it("emits per-cohort breakdown when run.cohort === 'all'", () => {
    const drafts: BlindTestDraft[] = []
    const ids: JudgeIdentification[] = []
    for (const cohort of RECIPIENT_COHORTS) {
      // 10 agent drafts per cohort; 9/10 indistinguishable → 90%
      for (let i = 0; i < 10; i++) {
        const did = `${cohort}-agent-${i}`
        drafts.push(draft(did, cohort, 'agent'))
        ids.push(ident(did, 'j1', i < 9 ? 'customer' : 'agent'))
      }
    }
    const result = scoreRun(makeRun({ drafts, identifications: ids }))
    expect(result.per_cohort).toBeDefined()
    expect(result.per_cohort?.client.score_pct).toBe(90)
    expect(result.per_cohort?.['opposing-counsel'].score_pct).toBe(90)
    expect(result.per_cohort?.['internal-team'].score_pct).toBe(90)
  })

  it('omits per-cohort breakdown for single-cohort runs', () => {
    const drafts = [draft('d-1', 'client', 'agent')]
    const ids = [ident('d-1', 'j1', 'customer')]
    const result = scoreRun(makeRun({ drafts, identifications: ids, cohort: 'client' }))
    expect(result.per_cohort).toBeUndefined()
  })

  it("identifies below-threshold cohorts in failure record for 'all' runs", () => {
    const drafts: BlindTestDraft[] = []
    const ids: JudgeIdentification[] = []
    // client → 100% pass, opposing-counsel → 50% fail, internal-team → 90% pass
    for (let i = 0; i < 10; i++) {
      drafts.push(draft(`c-${i}`, 'client', 'agent'))
      ids.push(ident(`c-${i}`, 'j1', 'customer'))
      drafts.push(draft(`oc-${i}`, 'opposing-counsel', 'agent'))
      ids.push(ident(`oc-${i}`, 'j1', i < 5 ? 'customer' : 'agent'))
      drafts.push(draft(`it-${i}`, 'internal-team', 'agent'))
      ids.push(ident(`it-${i}`, 'j1', i < 9 ? 'customer' : 'agent'))
    }
    const result = scoreRun(makeRun({ drafts, identifications: ids }))
    // Overall: 24/30 = 80% → pass; but opposing-counsel cohort is 50%
    expect(result.state).toBe('pass') // overall threshold met
    expect(result.per_cohort?.['opposing-counsel'].score_pct).toBe(50)
  })
})

describe('buildAuditMetadata', () => {
  it('includes score, judge_ids, sample_set_id, cycle_count per voice-gate-fallback.md §Three states', () => {
    const drafts = [draft('d-1', 'client', 'agent')]
    const ids = [ident('d-1', 'judge-A', 'customer')]
    const run = makeRun({ drafts, identifications: ids })
    const result = scoreRun(run)
    const metadata = JSON.parse(buildAuditMetadata(run, result)) as Record<string, unknown>
    expect(metadata['score']).toBe(100)
    expect(metadata['judge_ids']).toEqual(['judge-A'])
    expect(metadata['sample_set_id']).toBe('run-test')
    expect(metadata['cycle_count']).toBe(0)
  })

  it('attaches failure_recommended_path + auto_transitioned for fail states', () => {
    const drafts: BlindTestDraft[] = []
    const ids: JudgeIdentification[] = []
    for (let i = 0; i < 100; i++) {
      drafts.push(draft(`d-${i}`, 'client', 'agent'))
      ids.push(ident(`d-${i}`, 'j1', i < 30 ? 'customer' : 'agent'))
    }
    const run = makeRun({ drafts, identifications: ids })
    const result = scoreRun(run)
    const metadata = JSON.parse(buildAuditMetadata(run, result)) as Record<string, unknown>
    expect(metadata['failure_recommended_path']).toBe('B_pause_engagement')
    expect(metadata['failure_auto_transitioned']).toBe(false)
  })
})
