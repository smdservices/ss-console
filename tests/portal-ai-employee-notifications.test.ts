/**
 * Tests for the AI Employee notifications resolver
 * (src/lib/portal/ai-employee/notifications.ts).
 *
 * The page surface composes parseNotificationListParams →
 * applyNotificationFilters → applyNotificationSort →
 * paginateNotifications. Each piece is independently exercised here so
 * the URL contract (filter / sort / pagination) is regression-protected
 * against drift before the Hermes bridge (#821) lands and starts
 * shipping real rows.
 *
 * The page-rendering resolver `listNotifications` returns an empty list
 * today (no bridge). That contract is also tested here — we want the
 * build to fail loudly if a future change starts seeding mock rows from
 * this module, since that would be a Pattern A/B fabrication violation
 * per CLAUDE.md.
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_NOTIFICATION_PAGE_SIZE,
  MAX_NOTIFICATION_PAGE_SIZE,
  NOTIFICATION_SORTS,
  NOTIFICATION_TYPES,
  applyNotificationFilters,
  applyNotificationSort,
  buildNotificationListPage,
  countUnread,
  formatNotificationAge,
  formatNotificationType,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationTone,
  paginateNotifications,
  parseNotificationListParams,
  type Notification,
  type NotificationListParams,
} from '../src/lib/portal/ai-employee/notifications'
import type { SubscriptionRow } from '../src/lib/portal/product-access'

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: '01HX5N3K2A',
    type: 'draft_ready',
    ts: '2026-05-20T10:00:00.000Z',
    summary: 'A new draft is ready for review.',
    actor: 'client-intake',
    actionUrl: '/portal/products/ai-employee/drafts/d-1',
    unread: true,
    ...overrides,
  }
}

const baseParams: NotificationListParams = {
  types: [],
  unreadOnly: false,
  sort: 'ts_desc',
  page: 1,
  pageSize: DEFAULT_NOTIFICATION_PAGE_SIZE,
}

const stubSubscription: SubscriptionRow = {
  id: 'sub-test',
  org_id: 'org-test',
  entity_id: 'ent-test',
  product_slug: 'ai-employee',
  status: 'active',
  started_at: '2026-05-21T00:00:00Z',
  ended_at: null,
  settings_json: null,
  created_at: '2026-05-21T00:00:00Z',
  updated_at: '2026-05-21T00:00:00Z',
}

describe('NOTIFICATION_TYPES vocabulary', () => {
  it('contains the four AC categories', () => {
    expect(NOTIFICATION_TYPES).toContain('draft_ready')
    expect(NOTIFICATION_TYPES).toContain('error')
    expect(NOTIFICATION_TYPES).toContain('calibration_prompt')
    expect(NOTIFICATION_TYPES).toContain('weekly_digest')
  })

  it('has no duplicate entries', () => {
    const set = new Set(NOTIFICATION_TYPES)
    expect(set.size).toBe(NOTIFICATION_TYPES.length)
  })
})

describe('parseNotificationListParams', () => {
  it('returns defaults for an empty query string', () => {
    const params = parseNotificationListParams(new URLSearchParams())
    expect(params).toEqual(baseParams)
  })

  it('parses repeated type params and comma-separated values', () => {
    const params = parseNotificationListParams(
      new URLSearchParams('type=draft_ready&type=error,weekly_digest&type=draft_ready')
    )
    expect(params.types.slice().sort()).toEqual(['draft_ready', 'error', 'weekly_digest'])
  })

  it('drops type values outside the closed vocabulary', () => {
    const params = parseNotificationListParams(
      new URLSearchParams('type=draft_ready&type=not_a_real_type,error')
    )
    expect(params.types.slice().sort()).toEqual(['draft_ready', 'error'])
  })

  it('accepts every value in NOTIFICATION_TYPES via the type filter', () => {
    // Defensive: if any vocabulary entry would silently get dropped by the
    // parser, this test catches it before users hit it.
    for (const type of NOTIFICATION_TYPES) {
      const params = parseNotificationListParams(new URLSearchParams(`type=${type}`))
      expect(params.types).toEqual([type])
    }
  })

  it('treats unread=1 and unread=true as unreadOnly=true', () => {
    expect(parseNotificationListParams(new URLSearchParams('unread=1')).unreadOnly).toBe(true)
    expect(parseNotificationListParams(new URLSearchParams('unread=true')).unreadOnly).toBe(true)
  })

  it('treats unread=0 / missing / arbitrary value as unreadOnly=false', () => {
    expect(parseNotificationListParams(new URLSearchParams('unread=0')).unreadOnly).toBe(false)
    expect(parseNotificationListParams(new URLSearchParams('unread=yes')).unreadOnly).toBe(false)
    expect(parseNotificationListParams(new URLSearchParams()).unreadOnly).toBe(false)
  })

  it('falls back to ts_desc on unknown sort values', () => {
    expect(parseNotificationListParams(new URLSearchParams('sort=random')).sort).toBe('ts_desc')
  })

  it('clamps page to 1 when below 1', () => {
    expect(parseNotificationListParams(new URLSearchParams('page=0')).page).toBe(1)
    expect(parseNotificationListParams(new URLSearchParams('page=-5')).page).toBe(1)
  })

  it('caps pageSize at MAX_NOTIFICATION_PAGE_SIZE', () => {
    expect(parseNotificationListParams(new URLSearchParams('pageSize=10000')).pageSize).toBe(
      MAX_NOTIFICATION_PAGE_SIZE
    )
  })

  it('uses DEFAULT_NOTIFICATION_PAGE_SIZE for invalid pageSize values', () => {
    expect(parseNotificationListParams(new URLSearchParams('pageSize=abc')).pageSize).toBe(
      DEFAULT_NOTIFICATION_PAGE_SIZE
    )
    expect(parseNotificationListParams(new URLSearchParams('pageSize=0')).pageSize).toBe(
      DEFAULT_NOTIFICATION_PAGE_SIZE
    )
  })
})

describe('applyNotificationFilters', () => {
  const rows: Notification[] = [
    makeNotification({ id: 'a', type: 'draft_ready', unread: true }),
    makeNotification({ id: 'b', type: 'error', unread: false }),
    makeNotification({ id: 'c', type: 'calibration_prompt', unread: true }),
    makeNotification({ id: 'd', type: 'weekly_digest', unread: false }),
  ]

  it('returns all rows when no filters are set', () => {
    expect(applyNotificationFilters(rows, baseParams)).toHaveLength(4)
  })

  it('filters by single type', () => {
    const result = applyNotificationFilters(rows, { ...baseParams, types: ['error'] })
    expect(result.map((r) => r.id)).toEqual(['b'])
  })

  it('filters by multiple types (union)', () => {
    const result = applyNotificationFilters(rows, {
      ...baseParams,
      types: ['draft_ready', 'weekly_digest'],
    })
    expect(result.map((r) => r.id).sort()).toEqual(['a', 'd'])
  })

  it('filters by unreadOnly', () => {
    const result = applyNotificationFilters(rows, { ...baseParams, unreadOnly: true })
    expect(result.map((r) => r.id).sort()).toEqual(['a', 'c'])
  })

  it('combines type and unreadOnly', () => {
    const result = applyNotificationFilters(rows, {
      ...baseParams,
      types: ['draft_ready', 'error'],
      unreadOnly: true,
    })
    expect(result.map((r) => r.id)).toEqual(['a'])
  })
})

describe('applyNotificationSort', () => {
  const rows: Notification[] = [
    makeNotification({ id: 'oldest', ts: '2026-05-01T10:00:00.000Z' }),
    makeNotification({ id: 'newest', ts: '2026-05-21T10:00:00.000Z' }),
    makeNotification({ id: 'middle', ts: '2026-05-10T10:00:00.000Z' }),
  ]

  it('ts_desc puts newest first', () => {
    const result = applyNotificationSort(rows, 'ts_desc')
    expect(result.map((r) => r.id)).toEqual(['newest', 'middle', 'oldest'])
  })

  it('ts_asc puts oldest first', () => {
    const result = applyNotificationSort(rows, 'ts_asc')
    expect(result.map((r) => r.id)).toEqual(['oldest', 'middle', 'newest'])
  })

  it('covers every member of NOTIFICATION_SORTS', () => {
    for (const sort of NOTIFICATION_SORTS) {
      expect(() => applyNotificationSort(rows, sort)).not.toThrow()
    }
  })
})

describe('paginateNotifications', () => {
  const rows: Notification[] = Array.from({ length: 125 }, (_, i) =>
    makeNotification({
      id: `n-${i}`,
      ts: new Date(Date.UTC(2026, 4, 1) + i * 60_000).toISOString(),
    })
  )

  it('returns one page when totalCount <= pageSize', () => {
    const page = paginateNotifications(rows.slice(0, 10), 1, 50)
    expect(page.rows).toHaveLength(10)
    expect(page.pageCount).toBe(1)
  })

  it('paginates across multiple pages', () => {
    const page1 = paginateNotifications(rows, 1, 50)
    expect(page1.rows).toHaveLength(50)
    expect(page1.rows[0].id).toBe('n-0')
    expect(page1.pageCount).toBe(3)

    const page2 = paginateNotifications(rows, 2, 50)
    expect(page2.rows[0].id).toBe('n-50')

    const page3 = paginateNotifications(rows, 3, 50)
    expect(page3.rows).toHaveLength(25)
    expect(page3.rows[24].id).toBe('n-124')
  })

  it('clamps out-of-range page to last page', () => {
    const page = paginateNotifications(rows, 999, 50)
    expect(page.page).toBe(3)
    expect(page.rows[0].id).toBe('n-100')
  })

  it('clamps below-range page to page 1', () => {
    const page = paginateNotifications(rows, -2, 50)
    expect(page.page).toBe(1)
  })

  it('returns pageCount=1 for empty input', () => {
    const page = paginateNotifications([], 1, 50)
    expect(page.rows).toEqual([])
    expect(page.totalCount).toBe(0)
    expect(page.pageCount).toBe(1)
  })
})

describe('buildNotificationListPage', () => {
  it('composes filter → sort → paginate (default page size 50)', () => {
    const rows: Notification[] = [
      makeNotification({ id: 'a', type: 'draft_ready', ts: '2026-05-20T10:00:00.000Z' }),
      makeNotification({ id: 'b', type: 'draft_ready', ts: '2026-05-19T10:00:00.000Z' }),
      makeNotification({ id: 'c', type: 'error', ts: '2026-05-18T10:00:00.000Z' }),
    ]

    const page = buildNotificationListPage(rows, {
      ...baseParams,
      types: ['draft_ready'],
      sort: 'ts_desc',
    })

    expect(page.rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(page.totalCount).toBe(2)
    expect(page.pageSize).toBe(DEFAULT_NOTIFICATION_PAGE_SIZE)
  })
})

describe('countUnread', () => {
  it('returns 0 for an empty list', () => {
    expect(countUnread([])).toBe(0)
  })

  it('counts only rows where unread === true', () => {
    const rows: Notification[] = [
      makeNotification({ id: 'a', unread: true }),
      makeNotification({ id: 'b', unread: false }),
      makeNotification({ id: 'c', unread: true }),
      makeNotification({ id: 'd', unread: false }),
    ]
    expect(countUnread(rows)).toBe(2)
  })
})

describe('formatNotificationType', () => {
  it('maps each type to a friendly label', () => {
    expect(formatNotificationType('draft_ready')).toBe('Draft ready')
    expect(formatNotificationType('error')).toBe('Error')
    expect(formatNotificationType('calibration_prompt')).toBe('Calibration prompt')
    expect(formatNotificationType('weekly_digest')).toBe('Weekly digest')
  })

  it('covers every member of NOTIFICATION_TYPES', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(formatNotificationType(type)).not.toBe('')
    }
  })
})

describe('notificationTone', () => {
  it('returns the expected tone per type', () => {
    expect(notificationTone('error')).toBe('danger')
    expect(notificationTone('calibration_prompt')).toBe('warning')
    expect(notificationTone('draft_ready')).toBe('info')
    expect(notificationTone('weekly_digest')).toBe('neutral')
  })

  it('covers every member of NOTIFICATION_TYPES', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(notificationTone(type)).toMatch(/^(danger|warning|info|neutral)$/)
    }
  })
})

describe('formatNotificationAge', () => {
  const nowMs = Date.UTC(2026, 4, 21, 12, 0, 0)

  it('returns "just now" for ages under 60s', () => {
    const ts = new Date(nowMs - 30_000).toISOString()
    expect(formatNotificationAge(ts, nowMs)).toBe('just now')
  })

  it('renders minutes for < 1h', () => {
    const ts = new Date(nowMs - 5 * 60_000).toISOString()
    expect(formatNotificationAge(ts, nowMs)).toBe('5m ago')
  })

  it('renders hours for < 24h', () => {
    const ts = new Date(nowMs - 3 * 3600_000).toISOString()
    expect(formatNotificationAge(ts, nowMs)).toBe('3h ago')
  })

  it('renders days for < 30d', () => {
    const ts = new Date(nowMs - 12 * 86400_000).toISOString()
    expect(formatNotificationAge(ts, nowMs)).toBe('12d ago')
  })

  it('renders months for < 12mo', () => {
    const ts = new Date(nowMs - 60 * 86400_000).toISOString()
    expect(formatNotificationAge(ts, nowMs)).toBe('2mo ago')
  })

  it('renders years for >= 1y', () => {
    const ts = new Date(nowMs - 400 * 86400_000).toISOString()
    expect(formatNotificationAge(ts, nowMs)).toBe('1y ago')
  })

  it('collapses negative ages (clock skew) to "just now"', () => {
    const ts = new Date(nowMs + 60_000).toISOString()
    expect(formatNotificationAge(ts, nowMs)).toBe('just now')
  })

  it('returns the raw value when the timestamp cannot be parsed', () => {
    // Never fabricate a "just now" or "unknown" for malformed input —
    // the raw value lets reviewers see what the system actually recorded.
    expect(formatNotificationAge('not-a-date', nowMs)).toBe('not-a-date')
    expect(formatNotificationAge('', nowMs)).toBe('')
  })
})

describe('listNotifications', () => {
  it('returns an empty page until the Hermes bridge wires in (#821)', async () => {
    // No fabrication: the bridge stub returns []. If a future change adds
    // mock rows in fetchNotificationsFromHermes this test fails loudly
    // (CLAUDE.md Pattern A/B violation).
    const page = await listNotifications(stubSubscription, baseParams)
    expect(page.rows).toEqual([])
    expect(page.totalCount).toBe(0)
    expect(page.page).toBe(1)
    expect(page.pageCount).toBe(1)
    expect(page.pageSize).toBe(DEFAULT_NOTIFICATION_PAGE_SIZE)
  })
})

describe('markNotificationRead', () => {
  it('returns false today (bridge not wired)', async () => {
    // Contract: the call shape is intent-idempotent. The stub returns
    // false because no rows exist; when the bridge lands this becomes
    // a real write. The endpoint redirects regardless of the boolean,
    // so consumer behavior is stable across the swap.
    const result = await markNotificationRead(stubSubscription, 'any-id')
    expect(result).toBe(false)
  })
})

describe('markAllNotificationsRead', () => {
  it('returns 0 today (bridge not wired)', async () => {
    // Same contract as the single-row mark: the stub returns 0 today
    // because no rows exist. The endpoint surfaces the count on the
    // redirect URL via ?marked=N; 0 is the empty-state-honest value.
    const result = await markAllNotificationsRead(stubSubscription)
    expect(result).toBe(0)
  })
})
