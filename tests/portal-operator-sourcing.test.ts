/**
 * Tests for the draft sourcing block resolver fields + formatters
 * (#807).
 *
 * The sourcing block on the draft detail page reads from
 * `DraftDetail.sources` — a closed-vocabulary array surfacing matter
 * documents, memory rules, voice samples, system-of-record reads, and
 * verbatim quotes the skill consumed when authoring the draft. These
 * tests pin the closed vocabulary, the formatters, the grouping
 * semantics, and the no-fabrication contract before the Hermes bridge
 * for source attribution (#821 + a follow-on) wires real data through.
 *
 * The page renders the empty-state prose when `sources: []`, never a
 * fabricated list. The `listDraftsForCustomer` test in
 * `tests/operator-drafts.test.ts` already pins the broader
 * no-fabrication contract for the bridge stub. This file focuses on
 * the sourcing-specific surface.
 */

import { describe, it, expect } from 'vitest'
import {
  SOURCE_BLOCK_COLLAPSE_THRESHOLD,
  SOURCE_KINDS,
  formatSourceKind,
  groupSourcesByKind,
  getDraft,
  type DraftDetail,
  type SourceItem,
  type SourceKind,
} from '../src/lib/portal/operator/drafts'
import type { SubscriptionRow } from '../src/lib/portal/product-access'

function makeSource(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    kind: 'matter_document',
    title: 'Filevine #M-2026-0142',
    detail: 'Smith v. Acme Insurance',
    href: '/portal/products/operator/matters/M-2026-0142',
    ...overrides,
  }
}

const stubSubscription: SubscriptionRow = {
  id: 'sub-test',
  org_id: 'org-test',
  entity_id: 'ent-test',
  product_slug: 'operator',
  status: 'active',
  started_at: '2026-05-21T00:00:00Z',
  ended_at: null,
  settings_json: null,
  created_at: '2026-05-21T00:00:00Z',
  updated_at: '2026-05-21T00:00:00Z',
}

describe('SOURCE_KINDS vocabulary', () => {
  it('is the closed five-kind vocabulary', () => {
    expect(SOURCE_KINDS).toEqual([
      'matter_document',
      'memory_rule',
      'voice_sample',
      'system_of_record',
      'verbatim_quote',
    ])
  })

  it('declaration order drives visual grouping order', () => {
    // Matter documents must surface above verbatim quotes because the
    // sourcing block leads with the highest-signal kind. The grouping
    // function below relies on this ordering — if it ever changes,
    // groupSourcesByKind's output ordering changes too.
    const indexOf = (k: SourceKind) => SOURCE_KINDS.indexOf(k)
    expect(indexOf('matter_document')).toBeLessThan(indexOf('verbatim_quote'))
    expect(indexOf('matter_document')).toBeLessThan(indexOf('memory_rule'))
    expect(indexOf('matter_document')).toBeLessThan(indexOf('system_of_record'))
  })
})

describe('formatSourceKind', () => {
  it('returns a human-friendly label for every closed-vocabulary kind', () => {
    expect(formatSourceKind('matter_document')).toBe('Matter document')
    expect(formatSourceKind('memory_rule')).toBe('Memory rule')
    expect(formatSourceKind('voice_sample')).toBe('Voice sample')
    expect(formatSourceKind('system_of_record')).toBe('System of record')
    expect(formatSourceKind('verbatim_quote')).toBe('Verbatim quote')
  })

  it('covers every kind in the closed vocabulary', () => {
    // Smoke test: if a new SourceKind value lands in the type without
    // a formatter update, this enumeration catches the omission at
    // test time.
    for (const kind of SOURCE_KINDS) {
      const label = formatSourceKind(kind)
      expect(label.length).toBeGreaterThan(0)
      expect(label).not.toContain('_')
    }
  })
})

describe('groupSourcesByKind', () => {
  it('returns no groups for an empty input', () => {
    expect(groupSourcesByKind([])).toEqual([])
  })

  it('groups single-kind input into one group', () => {
    const sources: SourceItem[] = [
      makeSource({ kind: 'memory_rule', title: 'no medmal under $1M', detail: null, href: null }),
      makeSource({
        kind: 'memory_rule',
        title: 'cc paralegal on settlement',
        detail: null,
        href: null,
      }),
    ]
    const groups = groupSourcesByKind(sources)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.kind).toBe('memory_rule')
    expect(groups[0]?.items).toHaveLength(2)
  })

  it('preserves input order within each group', () => {
    const sources: SourceItem[] = [
      makeSource({ kind: 'memory_rule', title: 'rule A', detail: null, href: null }),
      makeSource({ kind: 'memory_rule', title: 'rule B', detail: null, href: null }),
      makeSource({ kind: 'memory_rule', title: 'rule C', detail: null, href: null }),
    ]
    const groups = groupSourcesByKind(sources)
    expect(groups[0]?.items.map((i) => i.title)).toEqual(['rule A', 'rule B', 'rule C'])
  })

  it('orders groups by SOURCE_KINDS declaration order regardless of input order', () => {
    // Author the input deliberately out of declaration order — quote
    // first, document last — to prove the grouper restores the
    // declared order.
    const sources: SourceItem[] = [
      makeSource({ kind: 'verbatim_quote', title: 'msg-9001', detail: null, href: null }),
      makeSource({
        kind: 'system_of_record',
        title: 'matter.case_number',
        detail: 'Filevine',
        href: null,
      }),
      makeSource({
        kind: 'voice_sample',
        title: 'to-client/anxious',
        detail: 'Layer 2 anchor set',
        href: null,
      }),
      makeSource({ kind: 'memory_rule', title: 'rule', detail: null, href: null }),
      makeSource({ kind: 'matter_document', title: 'doc', detail: null, href: '/x' }),
    ]
    const groups = groupSourcesByKind(sources)
    expect(groups.map((g) => g.kind)).toEqual([
      'matter_document',
      'memory_rule',
      'voice_sample',
      'system_of_record',
      'verbatim_quote',
    ])
  })

  it('omits kinds that have no items', () => {
    const sources: SourceItem[] = [
      makeSource({ kind: 'matter_document', title: 'doc', detail: null, href: '/x' }),
      makeSource({ kind: 'voice_sample', title: 'tone', detail: null, href: null }),
    ]
    const groups = groupSourcesByKind(sources)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.kind)).toEqual(['matter_document', 'voice_sample'])
  })
})

describe('SOURCE_BLOCK_COLLAPSE_THRESHOLD', () => {
  it('is 3 per the issue spec — three sources scan cleanly, more benefit from collapse', () => {
    expect(SOURCE_BLOCK_COLLAPSE_THRESHOLD).toBe(3)
  })
})

describe('getDraft (sourcing contract)', () => {
  it('returns null today because the Hermes bridge has not landed (#821)', async () => {
    // The sourcing block depends on the bridge to populate
    // `sources[]`. Until the bridge wires through, the resolver
    // returns null for every draft id. The page renders its
    // not-found empty state per docs/style/empty-state-pattern.md —
    // never a fabricated draft with a fabricated source list. This
    // test fails loudly if a future change starts seeding mock
    // drafts (which would be a Pattern A/B violation per CLAUDE.md).
    const result = await getDraft(stubSubscription, 'd-1')
    expect(result).toBeNull()
  })
})

describe('DraftDetail.sources field shape', () => {
  it('compiles as an array of SourceItem (closed contract)', () => {
    // Type-level smoke test. If the field's shape drifts (e.g. someone
    // changes it to `sources: SourceItem[] | null`), the test won't
    // compile. The empty-array contract is the design rule: the field
    // is always present, the empty case is empty array, not null.
    const detail: DraftDetail = {
      id: 'd-1',
      sender: 'pat@firm.com',
      recipient: 'opposing@example.com',
      skill: 'client-intake',
      trustCeiling: 'draft_for_review',
      ageSeconds: 3600,
      priority: 'normal',
      subject: null,
      bodyPlain: 'body',
      personaName: 'Marcus',
      personaSlug: 'marcus',
      personaDraftedAt: '2026-05-21T00:00:00Z',
      reviewerEmail: 'pat@firm.com',
      sendStatus: 'pending',
      sendError: null,
      sources: [],
      voiceProfileLabel: null,
    }
    expect(Array.isArray(detail.sources)).toBe(true)
    expect(detail.sources).toEqual([])
  })

  it('accepts an array of SourceItem with mixed kinds and link shapes', () => {
    const sources: SourceItem[] = [
      {
        kind: 'matter_document',
        title: 'Filevine #M-2026-0142',
        detail: 'Smith v. Acme Insurance',
        href: '/portal/products/operator/matters/M-2026-0142',
      },
      {
        kind: 'memory_rule',
        title: "we don't take medmal under $1M",
        detail: null,
        href: null,
      },
      {
        kind: 'voice_sample',
        title: 'to-client/anxious',
        detail: 'Layer 2 anchor set',
        href: null,
      },
      {
        kind: 'system_of_record',
        title: 'matter.case_number',
        detail: 'Filevine',
        href: null,
      },
      {
        kind: 'verbatim_quote',
        title: 'msg-abc-123',
        detail: 'inbound thread root',
        href: null,
      },
    ]
    const detail: DraftDetail = {
      id: 'd-1',
      sender: 'pat@firm.com',
      recipient: 'opposing@example.com',
      skill: 'client-intake',
      trustCeiling: 'draft_for_review',
      ageSeconds: 3600,
      priority: 'normal',
      subject: null,
      bodyPlain: 'body',
      personaName: 'Marcus',
      personaSlug: 'marcus',
      personaDraftedAt: '2026-05-21T00:00:00Z',
      reviewerEmail: 'pat@firm.com',
      sendStatus: 'pending',
      sendError: null,
      sources,
      voiceProfileLabel: null,
    }
    expect(detail.sources).toHaveLength(5)
    expect(new Set(detail.sources.map((s) => s.kind))).toEqual(new Set(SOURCE_KINDS))
  })
})
