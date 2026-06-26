/**
 * Tests for the Operator promotion-card resolver
 * (src/lib/portal/operator/promotion-cards.ts).
 *
 * The landing page composes listCandidateSkills → evaluatePromotionStreak →
 * (db dismissal lookup) → fetch (Hermes bridge stub) and emits zero or
 * more PromotionCandidate rows. Each piece is exercised independently
 * so the criteria contract (4-week ≥90%, non-promotable carve-outs,
 * 7-day cooldown) is regression-protected before the Hermes bridge
 * starts shipping real stats.
 *
 * The runtime resolver `listPromotionReadySkills` returns an empty list
 * today because `fetchSkillApprovalStatsFromHermes` is the bridge stub
 * and returns null. That contract is also tested here — if a future
 * change starts seeding mock stats from this module the build fails
 * loudly (CLAUDE.md Pattern A/B fabrication violation).
 */

import { describe, it, expect } from 'vitest'
import {
  NON_PROMOTABLE_SKILLS,
  PROMOTION_APPROVAL_RATE_THRESHOLD,
  PROMOTION_DISMISSAL_COOLDOWN_DAYS,
  PROMOTION_REQUIRED_WEEKS,
  buildDismissUrl,
  buildReviewUrl,
  evaluatePromotionStreak,
  formatApprovalRate,
  isDismissalExpired,
  listCandidateSkills,
  listPromotionReadySkills,
  type SkillApprovalStats,
  type SkillApprovalWeek,
} from '../src/lib/portal/operator/promotion-cards'
import type { PersonaConfig } from '../src/lib/portal/customer-config'

function makePersona(
  skills: Array<{ name: string }>,
  overrides: Partial<PersonaConfig> = {}
): PersonaConfig {
  return {
    slug: 'p',
    status: 'active',
    name: 'Persona',
    title: null,
    signature_html: null,
    tone: [],
    send_as: null,
    entitlements: { exposure: {} },
    channel_bindings: [],
    skills: skills.map((s) => ({
      name: s.name,
      initiation: { manual: true, scheduled: false, webhook: false },
    })),
    ...overrides,
  }
}

function makeWeek(overrides: Partial<SkillApprovalWeek> = {}): SkillApprovalWeek {
  return {
    weekStart: '2026-05-04T00:00:00.000Z',
    approvalRate: 0.95,
    draftCount: 10,
    ...overrides,
  }
}

function makeStats(weeks: SkillApprovalWeek[], skillName = 'conflict-check'): SkillApprovalStats {
  return { skillName, weeks }
}

// ---------------------------------------------------------------------------
// Constants — pin the criteria the PRD §12.1 spec cites
// ---------------------------------------------------------------------------

describe('promotion criteria constants', () => {
  it('threshold matches the §12.1 spec (≥90%)', () => {
    expect(PROMOTION_APPROVAL_RATE_THRESHOLD).toBe(0.9)
  })

  it('required weeks matches the §12.1 spec (4 consecutive weeks)', () => {
    expect(PROMOTION_REQUIRED_WEEKS).toBe(4)
  })

  it('cooldown matches the §12.1 spec (7 days)', () => {
    expect(PROMOTION_DISMISSAL_COOLDOWN_DAYS).toBe(7)
  })

  it('non-promotable list includes the §11.2 carve-outs', () => {
    expect(NON_PROMOTABLE_SKILLS).toContain('trust-accounting')
    expect(NON_PROMOTABLE_SKILLS).toContain('court-filing')
    expect(NON_PROMOTABLE_SKILLS).toContain('settlement-authority')
  })
})

// ---------------------------------------------------------------------------
// listCandidateSkills — which persona skills are eligible to evaluate
// ---------------------------------------------------------------------------

describe('listCandidateSkills', () => {
  it('returns no candidate skills while scalar promotion cards are retired', () => {
    const persona = makePersona([
      { name: 'intake-triage' },
      { name: 'conflict-check' },
      { name: 'refused-skill' },
    ])
    expect(listCandidateSkills(persona)).toEqual([])
  })

  it('excludes non-promotable skills', () => {
    const persona = makePersona([
      { name: 'trust-accounting' },
      { name: 'court-filing' },
      { name: 'settlement-authority' },
      { name: 'intake-triage' },
    ])
    expect(listCandidateSkills(persona)).toEqual([])
  })

  it('does not infer candidates from initiation grants', () => {
    const persona = makePersona([{ name: 'intake-triage' }, { name: 'conflict-check' }])
    expect(listCandidateSkills(persona)).toEqual([])
  })

  it('returns an empty array for an empty persona', () => {
    expect(listCandidateSkills(makePersona([]))).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// evaluatePromotionStreak — criteria evaluation against weekly stats
// ---------------------------------------------------------------------------

describe('evaluatePromotionStreak', () => {
  it('emits a candidate when every week meets the threshold', () => {
    const stats = makeStats([
      makeWeek({ approvalRate: 0.95, draftCount: 10 }),
      makeWeek({ approvalRate: 0.92, draftCount: 12 }),
      makeWeek({ approvalRate: 0.91, draftCount: 8 }),
      makeWeek({ approvalRate: 0.93, draftCount: 11 }),
    ])
    const result = evaluatePromotionStreak(stats)
    expect(result).not.toBeNull()
    expect(result?.weeks).toBe(4)
    expect(result?.totalDrafts).toBe(41)
    // Draft-weighted: (0.95*10 + 0.92*12 + 0.91*8 + 0.93*11) / 41 = 38.05/41 ≈ 0.9280
    expect(result?.approvalRate).toBeCloseTo(0.928, 3)
  })

  it('disqualifies when any single week is below threshold', () => {
    const stats = makeStats([
      makeWeek({ approvalRate: 0.95, draftCount: 10 }),
      makeWeek({ approvalRate: 0.92, draftCount: 12 }),
      makeWeek({ approvalRate: 0.85, draftCount: 8 }), // weak
      makeWeek({ approvalRate: 0.95, draftCount: 11 }),
    ])
    expect(evaluatePromotionStreak(stats)).toBeNull()
  })

  it('disqualifies on exactly the threshold boundary minus epsilon', () => {
    const stats = makeStats([
      makeWeek({ approvalRate: 0.9, draftCount: 10 }),
      makeWeek({ approvalRate: 0.9, draftCount: 10 }),
      makeWeek({ approvalRate: 0.9, draftCount: 10 }),
      makeWeek({ approvalRate: 0.89, draftCount: 10 }), // just below
    ])
    expect(evaluatePromotionStreak(stats)).toBeNull()
  })

  it('accepts exactly on the threshold (90.0%)', () => {
    const stats = makeStats([
      makeWeek({ approvalRate: 0.9, draftCount: 10 }),
      makeWeek({ approvalRate: 0.9, draftCount: 10 }),
      makeWeek({ approvalRate: 0.9, draftCount: 10 }),
      makeWeek({ approvalRate: 0.9, draftCount: 10 }),
    ])
    const result = evaluatePromotionStreak(stats)
    expect(result).not.toBeNull()
    expect(result?.approvalRate).toBeCloseTo(0.9, 5)
  })

  it('disqualifies when fewer than 4 weeks are available', () => {
    const stats = makeStats([
      makeWeek({ approvalRate: 0.95 }),
      makeWeek({ approvalRate: 0.95 }),
      makeWeek({ approvalRate: 0.95 }),
    ])
    expect(evaluatePromotionStreak(stats)).toBeNull()
  })

  it('disqualifies when a week has null approvalRate (silence does not qualify)', () => {
    const stats = makeStats([
      makeWeek({ approvalRate: 0.95 }),
      makeWeek({ approvalRate: null, draftCount: 0 }),
      makeWeek({ approvalRate: 0.95 }),
      makeWeek({ approvalRate: 0.95 }),
    ])
    expect(evaluatePromotionStreak(stats)).toBeNull()
  })

  it('disqualifies when total draft count across the window is zero', () => {
    const stats = makeStats([
      makeWeek({ approvalRate: 0.95, draftCount: 0 }),
      makeWeek({ approvalRate: 0.95, draftCount: 0 }),
      makeWeek({ approvalRate: 0.95, draftCount: 0 }),
      makeWeek({ approvalRate: 0.95, draftCount: 0 }),
    ])
    expect(evaluatePromotionStreak(stats)).toBeNull()
  })

  it('evaluates only the most recent 4 weeks even if more are supplied', () => {
    // Older weeks (indices 4+) should be ignored — they could be weak
    // without breaking the streak. This proves the resolver does not
    // average across an unbounded history.
    const stats = makeStats([
      makeWeek({ approvalRate: 0.95, draftCount: 10 }),
      makeWeek({ approvalRate: 0.95, draftCount: 10 }),
      makeWeek({ approvalRate: 0.95, draftCount: 10 }),
      makeWeek({ approvalRate: 0.95, draftCount: 10 }),
      makeWeek({ approvalRate: 0.2, draftCount: 100 }),
      makeWeek({ approvalRate: 0.1, draftCount: 100 }),
    ])
    const result = evaluatePromotionStreak(stats)
    expect(result).not.toBeNull()
    expect(result?.totalDrafts).toBe(40)
  })

  it('disqualifies on non-finite approvalRate values', () => {
    const stats = makeStats([
      makeWeek({ approvalRate: 0.95 }),
      makeWeek({ approvalRate: Number.NaN }),
      makeWeek({ approvalRate: 0.95 }),
      makeWeek({ approvalRate: 0.95 }),
    ])
    expect(evaluatePromotionStreak(stats)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// formatApprovalRate
// ---------------------------------------------------------------------------

describe('formatApprovalRate', () => {
  it('floors to whole percentages', () => {
    expect(formatApprovalRate(0.85)).toBe('85%')
    expect(formatApprovalRate(0.857)).toBe('85%')
    expect(formatApprovalRate(0.9)).toBe('90%')
    expect(formatApprovalRate(1)).toBe('100%')
  })

  it('clamps values outside [0, 1]', () => {
    expect(formatApprovalRate(1.27)).toBe('100%')
    expect(formatApprovalRate(-0.5)).toBe('0%')
  })

  it('returns empty string for non-finite input rather than fabricating', () => {
    expect(formatApprovalRate(Number.NaN)).toBe('')
    expect(formatApprovalRate(Number.POSITIVE_INFINITY)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// isDismissalExpired
// ---------------------------------------------------------------------------

describe('isDismissalExpired', () => {
  const nowMs = Date.UTC(2026, 4, 21, 12, 0, 0)
  const MS_PER_DAY = 24 * 60 * 60 * 1000

  it('returns false within the cooldown window', () => {
    const ts = new Date(nowMs - 3 * MS_PER_DAY).toISOString()
    expect(isDismissalExpired(ts, nowMs)).toBe(false)
  })

  it('returns true past the cooldown window', () => {
    const ts = new Date(nowMs - 8 * MS_PER_DAY).toISOString()
    expect(isDismissalExpired(ts, nowMs)).toBe(true)
  })

  it('returns true at exactly the cooldown boundary', () => {
    const ts = new Date(nowMs - PROMOTION_DISMISSAL_COOLDOWN_DAYS * MS_PER_DAY).toISOString()
    expect(isDismissalExpired(ts, nowMs)).toBe(true)
  })

  it('treats malformed timestamps as expired (fail open)', () => {
    expect(isDismissalExpired('not-a-date', nowMs)).toBe(true)
    expect(isDismissalExpired('', nowMs)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

describe('buildReviewUrl', () => {
  it('points at the Skills settings page with the skill focused', () => {
    expect(buildReviewUrl('conflict-check')).toBe(
      '/portal/products/operator/settings?focus=conflict-check'
    )
  })

  it('URL-encodes skill names containing special characters', () => {
    expect(buildReviewUrl('intake triage')).toBe(
      '/portal/products/operator/settings?focus=intake%20triage'
    )
  })
})

describe('buildDismissUrl', () => {
  it('routes the dismiss POST to the per-skill endpoint', () => {
    expect(buildDismissUrl('conflict-check')).toBe(
      '/api/portal/operator/promotion-cards/conflict-check/dismiss'
    )
  })

  it('URL-encodes skill names containing slashes or spaces', () => {
    expect(buildDismissUrl('a/b')).toBe('/api/portal/operator/promotion-cards/a%2Fb/dismiss')
  })
})

// ---------------------------------------------------------------------------
// listPromotionReadySkills — empty list contract until bridge wires in
// ---------------------------------------------------------------------------

/**
 * Minimal D1 stub. Captures the most recent statement so we can assert
 * the dismissals query shape even though we don't run real SQL here.
 * Returns no config row by default (entity has no customer.yaml
 * projection) so the resolver short-circuits to an empty list.
 */
function makeDbStub(options: {
  customerConfigRow?: Record<string, unknown> | null
  dismissalRows?: Array<{ skill: string; dismissed_at: string }>
}) {
  return {
    prepare(_sql: string) {
      return {
        bind(..._args: unknown[]) {
          return this
        },
        async first() {
          if (_sql.includes('FROM customer_configs')) {
            return options.customerConfigRow ?? null
          }
          return null
        },
        async all() {
          if (_sql.includes('FROM promotion_card_dismissals')) {
            return { results: options.dismissalRows ?? [], success: true, meta: {} }
          }
          return { results: [], success: true, meta: {} }
        },
        async run() {
          return { success: true, meta: {} }
        },
      }
    },
    // Compat with D1Database type — these are unused by the resolver but
    // satisfy the structural type check at call sites.
    batch: async () => [],
    dump: async () => new ArrayBuffer(0),
    exec: async () => ({ count: 0, duration: 0 }),
  } as unknown as D1Database
}

describe('listPromotionReadySkills', () => {
  it('returns an empty list when the customer has no projected config', async () => {
    const db = makeDbStub({ customerConfigRow: null })
    const result = await listPromotionReadySkills(db, 'ent-1')
    expect(result).toEqual([])
  })

  it('returns an empty list when no persona is active', async () => {
    const db = makeDbStub({
      customerConfigRow: {
        entity_id: 'ent-1',
        org_id: 'org-1',
        customer_slug: 'firm',
        schema_version: '1',
        personas_json: JSON.stringify([
          {
            slug: 'archived',
            status: 'archived',
            name: 'Old',
            title: null,
            signature_html: null,
            tone: [],
            send_as: null,
            entitlements: { exposure: { internal_write: 'draft_for_review' } },
            skills: [
              {
                name: 'conflict-check',
                initiation: { manual: true, scheduled: false, webhook: false },
              },
            ],
            channel_bindings: [],
          },
        ]),
        voice_library_json: null,
        escalation_json: null,
        business_hours_json: null,
        connectors_json: null,
        scope_json: null,
        git_sha: 'abc',
        synced_at: '2026-05-21T00:00:00Z',
      },
    })
    const result = await listPromotionReadySkills(db, 'ent-1')
    expect(result).toEqual([])
  })

  it('returns an empty list when the active persona has no candidate skills', async () => {
    const db = makeDbStub({
      customerConfigRow: {
        entity_id: 'ent-1',
        org_id: 'org-1',
        customer_slug: 'firm',
        schema_version: '1',
        personas_json: JSON.stringify([
          {
            slug: 'p',
            status: 'active',
            name: 'P',
            title: null,
            signature_html: null,
            tone: [],
            send_as: null,
            entitlements: { exposure: { internal_write: 'autonomous' } },
            skills: [
              {
                name: 'conflict-check',
                initiation: { manual: true, scheduled: false, webhook: false },
              },
              {
                name: 'trust-accounting',
                initiation: { manual: true, scheduled: false, webhook: false },
              },
            ],
            channel_bindings: [],
          },
        ]),
        voice_library_json: null,
        escalation_json: null,
        business_hours_json: null,
        connectors_json: null,
        scope_json: null,
        git_sha: 'abc',
        synced_at: '2026-05-21T00:00:00Z',
      },
    })
    const result = await listPromotionReadySkills(db, 'ent-1')
    expect(result).toEqual([])
  })

  it('returns an empty list even with candidates while the Hermes bridge is stubbed', async () => {
    // No fabrication contract: even when the customer has eligible
    // skills and no dismissals, the bridge stub returns null and no
    // cards surface. If a future change starts seeding mock stats from
    // fetchSkillApprovalStatsFromHermes this test fails loudly
    // (CLAUDE.md Pattern A/B violation).
    const db = makeDbStub({
      customerConfigRow: {
        entity_id: 'ent-1',
        org_id: 'org-1',
        customer_slug: 'firm',
        schema_version: '1',
        personas_json: JSON.stringify([
          {
            slug: 'p',
            status: 'active',
            name: 'P',
            title: null,
            signature_html: null,
            tone: [],
            send_as: null,
            entitlements: { exposure: { internal_write: 'draft_for_review' } },
            skills: [
              {
                name: 'intake-triage',
                initiation: { manual: true, scheduled: false, webhook: false },
              },
            ],
            channel_bindings: [],
          },
        ]),
        voice_library_json: null,
        escalation_json: null,
        business_hours_json: null,
        connectors_json: null,
        scope_json: null,
        git_sha: 'abc',
        synced_at: '2026-05-21T00:00:00Z',
      },
    })
    const result = await listPromotionReadySkills(db, 'ent-1')
    expect(result).toEqual([])
  })
})
