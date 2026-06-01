/**
 * Tests for the Operator drafts list helper
 * (src/lib/portal/operator/drafts.ts).
 *
 * The page surface composes parseDraftListParams → applyDraftFilters →
 * applyDraftSort → paginateDrafts. Each piece is independently
 * exercised here so URL contract (filter / sort / pagination) is
 * regression-protected against drift before the Hermes bridge (#821)
 * lands and starts shipping real rows.
 *
 * The page-rendering resolver `listDraftsForCustomer` returns an empty
 * list today (no bridge). That contract is also tested here — we want
 * the build to fail loudly if a future change starts seeding mock
 * rows from this module, since that would be a Pattern A/B fabrication
 * violation per CLAUDE.md.
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_DRAFT_PAGE_SIZE,
  MAX_DRAFT_PAGE_SIZE,
  applyDraftFilters,
  applyDraftSort,
  buildDraftListPage,
  distinctSkills,
  formatDraftAge,
  formatDraftPriority,
  formatTrustCeiling,
  listDraftsForCustomer,
  paginateDrafts,
  parseDraftListParams,
  type Draft,
  type DraftListParams,
} from '../src/lib/portal/operator/drafts'
import type { SubscriptionRow } from '../src/lib/portal/product-access'

function makeDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: 'd-1',
    sender: 'Pat Owner <pat@firm.com>',
    recipient: 'opposing@example.com',
    skill: 'client-intake',
    trustCeiling: 'draft_for_review',
    ageSeconds: 3600,
    priority: 'normal',
    subject: 'Intake follow up',
    ...overrides,
  }
}

const baseParams: DraftListParams = {
  skills: [],
  recipient: null,
  maxAgeHours: null,
  sort: 'age_desc',
  page: 1,
  pageSize: DEFAULT_DRAFT_PAGE_SIZE,
}

describe('parseDraftListParams', () => {
  it('returns defaults for an empty query string', () => {
    const params = parseDraftListParams(new URLSearchParams())
    expect(params).toEqual(baseParams)
  })

  it('parses repeated skill params and comma-separated skill values', () => {
    const params = parseDraftListParams(
      new URLSearchParams('skill=intake&skill=deadline,reminder&skill=intake')
    )
    expect(params.skills.slice().sort()).toEqual(['deadline', 'intake', 'reminder'])
  })

  it('lowercases and trims the recipient filter', () => {
    const params = parseDraftListParams(new URLSearchParams('recipient=  Opposing@Example.com  '))
    expect(params.recipient).toBe('opposing@example.com')
  })

  it('treats an empty recipient as no filter', () => {
    const params = parseDraftListParams(new URLSearchParams('recipient='))
    expect(params.recipient).toBeNull()
  })

  it('rejects invalid maxAgeHours values', () => {
    expect(parseDraftListParams(new URLSearchParams('maxAgeHours=0')).maxAgeHours).toBeNull()
    expect(parseDraftListParams(new URLSearchParams('maxAgeHours=-5')).maxAgeHours).toBeNull()
    expect(parseDraftListParams(new URLSearchParams('maxAgeHours=abc')).maxAgeHours).toBeNull()
  })

  it('accepts valid maxAgeHours', () => {
    expect(parseDraftListParams(new URLSearchParams('maxAgeHours=24')).maxAgeHours).toBe(24)
  })

  it('falls back to age_desc on unknown sort values', () => {
    expect(parseDraftListParams(new URLSearchParams('sort=random')).sort).toBe('age_desc')
  })

  it('clamps page to 1 when below 1', () => {
    expect(parseDraftListParams(new URLSearchParams('page=0')).page).toBe(1)
    expect(parseDraftListParams(new URLSearchParams('page=-2')).page).toBe(1)
  })

  it('caps pageSize at MAX_DRAFT_PAGE_SIZE', () => {
    expect(parseDraftListParams(new URLSearchParams('pageSize=10000')).pageSize).toBe(
      MAX_DRAFT_PAGE_SIZE
    )
  })

  it('uses DEFAULT_DRAFT_PAGE_SIZE for invalid pageSize values', () => {
    expect(parseDraftListParams(new URLSearchParams('pageSize=abc')).pageSize).toBe(
      DEFAULT_DRAFT_PAGE_SIZE
    )
    expect(parseDraftListParams(new URLSearchParams('pageSize=0')).pageSize).toBe(
      DEFAULT_DRAFT_PAGE_SIZE
    )
  })
})

describe('applyDraftFilters', () => {
  const rows: Draft[] = [
    makeDraft({ id: 'a', skill: 'intake', recipient: 'alice@example.com', ageSeconds: 600 }),
    makeDraft({ id: 'b', skill: 'deadline', recipient: 'bob@example.com', ageSeconds: 7200 }),
    makeDraft({ id: 'c', skill: 'intake', recipient: 'carol@firm.com', ageSeconds: 86400 }),
  ]

  it('returns all rows when no filters are set', () => {
    expect(applyDraftFilters(rows, baseParams)).toHaveLength(3)
  })

  it('filters by single skill', () => {
    const result = applyDraftFilters(rows, { ...baseParams, skills: ['intake'] })
    expect(result.map((r) => r.id)).toEqual(['a', 'c'])
  })

  it('filters by multiple skills (union)', () => {
    const result = applyDraftFilters(rows, { ...baseParams, skills: ['deadline', 'intake'] })
    expect(result.map((r) => r.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('filters by recipient substring (case-insensitive)', () => {
    const result = applyDraftFilters(rows, { ...baseParams, recipient: 'example.com' })
    expect(result.map((r) => r.id).sort()).toEqual(['a', 'b'])
  })

  it('filters by maxAgeHours (drops anything older)', () => {
    // 1 hour = 3600s. Row a (600s) is younger, b (7200s) and c (86400s) older.
    const result = applyDraftFilters(rows, { ...baseParams, maxAgeHours: 1 })
    expect(result.map((r) => r.id)).toEqual(['a'])
  })

  it('combines all filters', () => {
    const result = applyDraftFilters(rows, {
      ...baseParams,
      skills: ['intake'],
      recipient: 'example.com',
      maxAgeHours: 1,
    })
    expect(result.map((r) => r.id)).toEqual(['a'])
  })
})

describe('applyDraftSort', () => {
  const rows: Draft[] = [
    makeDraft({ id: 'old-low', ageSeconds: 86400, priority: 'low', skill: 'b-skill' }),
    makeDraft({ id: 'new-normal', ageSeconds: 600, priority: 'normal', skill: 'a-skill' }),
    makeDraft({ id: 'mid-high', ageSeconds: 3600, priority: 'high', skill: 'c-skill' }),
  ]

  it('age_desc puts newest (smallest ageSeconds) first', () => {
    const result = applyDraftSort(rows, 'age_desc')
    expect(result.map((r) => r.id)).toEqual(['new-normal', 'mid-high', 'old-low'])
  })

  it('age_asc puts oldest first', () => {
    const result = applyDraftSort(rows, 'age_asc')
    expect(result.map((r) => r.id)).toEqual(['old-low', 'mid-high', 'new-normal'])
  })

  it('priority_desc puts high > normal > low and breaks ties by newest', () => {
    const result = applyDraftSort(rows, 'priority_desc')
    expect(result.map((r) => r.id)).toEqual(['mid-high', 'new-normal', 'old-low'])
  })

  it('skill sorts alphabetically and breaks ties by newest', () => {
    const result = applyDraftSort(rows, 'skill')
    expect(result.map((r) => r.skill)).toEqual(['a-skill', 'b-skill', 'c-skill'])
  })
})

describe('paginateDrafts', () => {
  const rows: Draft[] = Array.from({ length: 125 }, (_, i) =>
    makeDraft({ id: `d-${i}`, ageSeconds: i * 60 })
  )

  it('returns one page when totalCount <= pageSize', () => {
    const page = paginateDrafts(rows.slice(0, 10), 1, 50)
    expect(page.rows).toHaveLength(10)
    expect(page.pageCount).toBe(1)
  })

  it('paginates correctly across multiple pages', () => {
    const page1 = paginateDrafts(rows, 1, 50)
    expect(page1.rows).toHaveLength(50)
    expect(page1.rows[0].id).toBe('d-0')
    expect(page1.pageCount).toBe(3)

    const page2 = paginateDrafts(rows, 2, 50)
    expect(page2.rows).toHaveLength(50)
    expect(page2.rows[0].id).toBe('d-50')

    const page3 = paginateDrafts(rows, 3, 50)
    expect(page3.rows).toHaveLength(25)
    expect(page3.rows[24].id).toBe('d-124')
  })

  it('clamps out-of-range page to last page', () => {
    const page = paginateDrafts(rows, 999, 50)
    expect(page.page).toBe(3)
    expect(page.rows[0].id).toBe('d-100')
  })

  it('clamps below-range page to page 1', () => {
    const page = paginateDrafts(rows, -5, 50)
    expect(page.page).toBe(1)
  })

  it('returns pageCount=1 for empty input', () => {
    const page = paginateDrafts([], 1, 50)
    expect(page.rows).toEqual([])
    expect(page.totalCount).toBe(0)
    expect(page.pageCount).toBe(1)
  })
})

describe('buildDraftListPage', () => {
  it('composes filter → sort → paginate', () => {
    const rows: Draft[] = [
      makeDraft({ id: 'a', skill: 'intake', ageSeconds: 600, priority: 'high' }),
      makeDraft({ id: 'b', skill: 'intake', ageSeconds: 3600, priority: 'low' }),
      makeDraft({ id: 'c', skill: 'deadline', ageSeconds: 7200, priority: 'normal' }),
    ]

    const page = buildDraftListPage(rows, {
      ...baseParams,
      skills: ['intake'],
      sort: 'priority_desc',
      page: 1,
      pageSize: 50,
    })

    expect(page.rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(page.totalCount).toBe(2)
  })
})

describe('formatDraftAge', () => {
  it('renders short ages as "just now"', () => {
    expect(formatDraftAge(0)).toBe('just now')
    expect(formatDraftAge(45)).toBe('just now')
    expect(formatDraftAge(-100)).toBe('just now')
    expect(formatDraftAge(Number.NaN)).toBe('just now')
  })

  it('renders minutes / hours / days / months / years', () => {
    expect(formatDraftAge(60)).toBe('1m ago')
    expect(formatDraftAge(60 * 30)).toBe('30m ago')
    expect(formatDraftAge(3600)).toBe('1h ago')
    expect(formatDraftAge(3600 * 5)).toBe('5h ago')
    expect(formatDraftAge(86400)).toBe('1d ago')
    expect(formatDraftAge(86400 * 10)).toBe('10d ago')
    expect(formatDraftAge(86400 * 60)).toBe('2mo ago')
    expect(formatDraftAge(86400 * 400)).toBe('1y ago')
  })
})

describe('formatTrustCeiling / formatDraftPriority', () => {
  it('maps every trust-ceiling value to a friendly label', () => {
    expect(formatTrustCeiling('draft_for_review')).toBe('Review required')
    expect(formatTrustCeiling('auto_send')).toBe('Auto-send')
  })

  it('maps every priority value to a friendly label', () => {
    expect(formatDraftPriority('high')).toBe('High')
    expect(formatDraftPriority('normal')).toBe('Normal')
    expect(formatDraftPriority('low')).toBe('Low')
  })
})

describe('distinctSkills', () => {
  it('returns empty array for empty input', () => {
    expect(distinctSkills([])).toEqual([])
  })

  it('returns unique skills sorted alphabetically', () => {
    const rows: Draft[] = [
      makeDraft({ id: 'a', skill: 'deadline' }),
      makeDraft({ id: 'b', skill: 'intake' }),
      makeDraft({ id: 'c', skill: 'deadline' }),
      makeDraft({ id: 'd', skill: 'archive' }),
    ]
    expect(distinctSkills(rows)).toEqual(['archive', 'deadline', 'intake'])
  })
})

describe('listDraftsForCustomer', () => {
  it('returns an empty page until the Hermes bridge wires in (#821)', async () => {
    // No fabrication: the bridge stub returns []. If a future change
    // adds mock rows in fetchDraftsFromHermes this test fails loudly.
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
    const page = await listDraftsForCustomer(stubSubscription, baseParams)
    expect(page.rows).toEqual([])
    expect(page.totalCount).toBe(0)
    expect(page.page).toBe(1)
    expect(page.pageCount).toBe(1)
  })
})
