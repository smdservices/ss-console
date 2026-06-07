/**
 * Tests for the voice-gate harness top-level orchestration.
 *
 * Covers:
 *   - runVoiceGate composes panel + scoring correctly
 *   - production-minimum enforcement via runVoiceGate
 *   - buildAuditRow shape matches d1-schema.md §1 audit_log row
 *   - fixture loader round-trips synthetic-set.json
 *   - synthetic identifications produce a deterministic gate result
 */

import { describe, it, expect } from 'vitest'

import {
  buildAuditRow,
  loadFixtureSet,
  runVoiceGate,
  type JudgeIdentification,
  type RecipientCohort,
} from '../operator/voice-gate/index.js'

describe('runVoiceGate', () => {
  it('composes panel + scoring for a passing run', () => {
    const drafts = [
      {
        id: 'd-c-1',
        cohort: 'client' as RecipientCohort,
        authorship: 'customer' as const,
        body: 'b',
      },
      { id: 'd-a-1', cohort: 'client' as RecipientCohort, authorship: 'agent' as const, body: 'b' },
    ]
    const identifications: JudgeIdentification[] = [
      { draft_id: 'd-c-1', judge_id: 'j1', choice: 'customer' },
      { draft_id: 'd-a-1', judge_id: 'j1', choice: 'customer' },
    ]
    const { run, result } = runVoiceGate({
      customer_slug: 'test-firm',
      cohort: 'client',
      run_id: 'run-1',
      drafts,
      panel: ['j1'],
      cycle_count: 0,
      identifications,
      // Deliberately-small fixture run: opt out of production minimums.
      enforceProductionMinimums: false,
    })
    expect(run.scored_at).not.toBeNull()
    expect(result.state).toBe('pass')
    expect(result.score_pct).toBe(100)
  })

  it('enforces production minimums by DEFAULT when the flag is omitted', () => {
    // Issue #1124: a caller that forgets the flag must get enforcement,
    // not a free pass. A 1-judge / 2-draft run must now throw.
    expect(() =>
      runVoiceGate({
        customer_slug: 'test-firm',
        cohort: 'client',
        run_id: 'run-1',
        drafts: [
          { id: 'd-c-1', cohort: 'client', authorship: 'customer', body: 'b' },
          { id: 'd-a-1', cohort: 'client', authorship: 'agent', body: 'b' },
        ],
        panel: ['j1'],
        cycle_count: 0,
        identifications: [
          { draft_id: 'd-c-1', judge_id: 'j1', choice: 'customer' },
          { draft_id: 'd-a-1', judge_id: 'j1', choice: 'customer' },
        ],
      })
    ).toThrow(/need 10|need 3/)
  })

  it('rejects malformed input with all errors surfaced', () => {
    expect(() =>
      runVoiceGate({
        customer_slug: '',
        cohort: 'client',
        run_id: '',
        drafts: [],
        panel: [],
        cycle_count: -1,
        identifications: [],
      })
    ).toThrow(/voice-gate validation failed/)
  })

  it('enforces production minimums when enforceProductionMinimums is true', () => {
    expect(() =>
      runVoiceGate({
        customer_slug: 'test-firm',
        cohort: 'client',
        run_id: 'run-1',
        drafts: [
          { id: 'd-c-1', cohort: 'client', authorship: 'customer', body: 'b' },
          { id: 'd-a-1', cohort: 'client', authorship: 'agent', body: 'b' },
        ],
        panel: ['j1'],
        cycle_count: 0,
        identifications: [],
        enforceProductionMinimums: true,
      })
    ).toThrow(/need 10|need 3/)
  })
})

describe('buildAuditRow', () => {
  it('produces a row matching d1-schema.md §1 audit_log shape', () => {
    const drafts = [
      {
        id: 'd-c-1',
        cohort: 'client' as RecipientCohort,
        authorship: 'customer' as const,
        body: 'b',
      },
      { id: 'd-a-1', cohort: 'client' as RecipientCohort, authorship: 'agent' as const, body: 'b' },
    ]
    const { run, result } = runVoiceGate({
      customer_slug: 'test-firm',
      cohort: 'client',
      run_id: 'run-1',
      drafts,
      panel: ['j1'],
      cycle_count: 0,
      identifications: [
        { draft_id: 'd-c-1', judge_id: 'j1', choice: 'customer' },
        { draft_id: 'd-a-1', judge_id: 'j1', choice: 'customer' },
      ],
      enforceProductionMinimums: false,
    })
    const row = buildAuditRow('01J-row-id', run, result, '2026-05-21T12:00:00Z')
    expect(row.id).toBe('01J-row-id')
    expect(row.ts).toBe('2026-05-21T12:00:00Z')
    expect(row.action_type).toBe('VOICE_GATE_PASSED')
    expect(row.actor).toBe('captain')
    expect(row.actor_role).toBe('captain')
    expect(row.skill_name).toBeNull()
    expect(row.matter_ref).toBeNull()
    expect(typeof row.metadata).toBe('string')
    const meta = JSON.parse(row.metadata) as Record<string, unknown>
    expect(meta['score']).toBe(100)
    expect(meta['judge_ids']).toEqual(['j1'])
    expect(meta['sample_set_id']).toBe('run-1')
  })

  it('defaults timestamp to now when not provided', () => {
    const drafts = [
      {
        id: 'd-c-1',
        cohort: 'client' as RecipientCohort,
        authorship: 'customer' as const,
        body: 'b',
      },
      { id: 'd-a-1', cohort: 'client' as RecipientCohort, authorship: 'agent' as const, body: 'b' },
    ]
    const { run, result } = runVoiceGate({
      customer_slug: 'test-firm',
      cohort: 'client',
      run_id: 'run-1',
      drafts,
      panel: ['j1'],
      cycle_count: 0,
      identifications: [
        { draft_id: 'd-c-1', judge_id: 'j1', choice: 'customer' },
        { draft_id: 'd-a-1', judge_id: 'j1', choice: 'customer' },
      ],
      enforceProductionMinimums: false,
    })
    const before = Date.now()
    const row = buildAuditRow('id', run, result)
    const rowTime = Date.parse(row.ts)
    expect(rowTime).toBeGreaterThanOrEqual(before - 1)
    expect(rowTime).toBeLessThanOrEqual(Date.now() + 1)
  })
})

describe('fixture loader', () => {
  it('round-trips the bundled synthetic set', async () => {
    const set = await loadFixtureSet()
    expect(set.customer_slug).toBe('smith-pi-firm')
    // 3 cohorts × 3 drafts each = 9 total in the bundled fixture.
    // #857 added `court` and `internal` to RECIPIENT_COHORTS — the
    // bundled fixture does NOT cover them (an authoring decision: the
    // synthetic set predates the cohort expansion and is preserved as
    // legacy-compat). Iterate the fixture's own cohort set rather than
    // the full union so this test stays specific to what the fixture
    // actually ships.
    expect(set.drafts).toHaveLength(9)
    const fixtureCohorts = new Set(set.drafts.map((d) => d.cohort))
    expect(fixtureCohorts).toEqual(new Set(['client', 'opposing-counsel', 'internal-team']))
    for (const cohort of fixtureCohorts) {
      const cohortDrafts = set.drafts.filter((d) => d.cohort === cohort)
      expect(cohortDrafts).toHaveLength(3)
      const customerCount = cohortDrafts.filter((d) => d.authorship === 'customer').length
      const agentCount = cohortDrafts.filter((d) => d.authorship === 'agent').length
      expect(customerCount).toBe(1)
      expect(agentCount).toBe(2)
    }
  })

  it('every fixture draft uses placeholder names (no fabricated client data)', async () => {
    const set = await loadFixtureSet()
    for (const d of set.drafts) {
      // Placeholder-discipline check: IDs and bodies should reference
      // placeholder names, never plausible-real names. Two markers we
      // know are present in the bundled fixtures:
      const hasPlaceholderId = d.id.startsWith('smith-pi-firm/')
      const hasPlaceholderInBody =
        d.body.includes('placeholder-') || d.body.toLowerCase().includes('placeholder')
      expect(hasPlaceholderId).toBe(true)
      expect(hasPlaceholderInBody).toBe(true)
    }
  })
})

describe('end-to-end synthetic run', () => {
  it('drives the bundled fixture set with the example identifications and resolves to a known result', async () => {
    const set = await loadFixtureSet()
    // Mirror the bundled example-identifications.json. Three judges,
    // 9 drafts each = 27 identifications; agents are 2/3 of drafts so
    // 18 agent judgments total.
    const judges = ['judge-A', 'judge-B', 'judge-C']
    const identifications: JudgeIdentification[] = []
    for (const judge of judges) {
      for (const d of set.drafts) {
        // Most judges fail to identify the agent drafts (call them
        // customer), which yields a high indistinguishability score.
        identifications.push({
          draft_id: d.id,
          judge_id: judge,
          choice: 'customer',
        })
      }
    }
    const { result } = runVoiceGate({
      customer_slug: set.customer_slug,
      cohort: 'all',
      run_id: 'e2e-run',
      drafts: set.drafts,
      panel: judges,
      cycle_count: 0,
      identifications,
      // Bundled fixture is 3 drafts/cohort — under the production minimum
      // by design (verifies scaffolding, not calibration).
      enforceProductionMinimums: false,
    })
    // 18 agent judgments, all "customer" → 100% indistinguishable
    expect(result.score_pct).toBe(100)
    expect(result.state).toBe('pass')
    expect(result.per_cohort?.client.score_pct).toBe(100)
    expect(result.per_cohort?.['opposing-counsel'].score_pct).toBe(100)
    expect(result.per_cohort?.['internal-team'].score_pct).toBe(100)
  })

  it('mid-band judging produces near-pass with cycle metadata', async () => {
    const set = await loadFixtureSet()
    const judges = ['judge-A', 'judge-B', 'judge-C']
    const identifications: JudgeIdentification[] = []
    let agentSeen = 0
    for (const judge of judges) {
      for (const d of set.drafts) {
        if (d.authorship === 'agent') {
          // Catch every third agent draft as agent → ~67% indistinguishability
          const caught = agentSeen % 3 === 0
          identifications.push({
            draft_id: d.id,
            judge_id: judge,
            choice: caught ? 'agent' : 'customer',
          })
          agentSeen++
        } else {
          identifications.push({
            draft_id: d.id,
            judge_id: judge,
            choice: 'customer',
          })
        }
      }
    }
    const { result } = runVoiceGate({
      customer_slug: set.customer_slug,
      cohort: 'all',
      run_id: 'e2e-near-pass',
      drafts: set.drafts,
      panel: judges,
      cycle_count: 1,
      identifications,
      enforceProductionMinimums: false,
    })
    expect(result.state).toBe('near-pass')
    expect(result.near_pass_record).toBeDefined()
    expect(result.near_pass_record?.is_final_cycle).toBe(true)
  })
})
