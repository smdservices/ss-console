/**
 * Per-person usage read + aggregation (#2070 C2).
 *
 * The surface answers "whose usage is this?" from the seat's own meter. These
 * tests pin the two properties that make the answer trustworthy: a malformed
 * row is DROPPED rather than coerced (a pricing decision must never rest on an
 * invented number), and an unreachable seat reports unreachable rather than a
 * stale figure.
 */

import { describe, it, expect } from 'vitest'
import {
  aggregateUsage,
  loadUsageView,
  parseRow,
  type UsageReadResult,
} from '../src/lib/admin/usage-read'

const ACTOR = { actor: 'captain@smd.services', actorRole: 'admin' }

function meterRow(over: Record<string, unknown> = {}) {
  return {
    day: '2026-07-30',
    attributed_to: 'greg@x.test',
    model: 'claude-opus-5',
    attribution_source: 'inbound_origin',
    input_tokens: 1000,
    output_tokens: 200,
    cache_read_tokens: 50,
    cache_write_tokens: 10,
    requests: 3,
    ...over,
  }
}

/** A transport that serves fixed pages, or fails. */
function fakeTransport(pages: Array<{ entries: unknown[]; cursor: string | null }>) {
  let call = 0
  return {
    read: async () => {
      const page = pages[Math.min(call, pages.length - 1)]
      call += 1
      return { data: page }
    },
  }
}

const noopAudit = { record: async () => {} }

function parsed(raw: unknown) {
  return parseRow(raw)
}

describe('parseRow', () => {
  it('parses a well-formed meter row', () => {
    const row = parsed(meterRow())
    expect(row).not.toBeNull()
    expect(row?.attributedTo).toBe('greg@x.test')
    expect(row?.inputTokens).toBe(1000)
    expect(row?.requests).toBe(3)
  })

  it('drops a row missing its identity fields', () => {
    expect(parsed(meterRow({ day: '' }))).toBeNull()
    expect(parsed(meterRow({ attributed_to: undefined }))).toBeNull()
    expect(parsed(null)).toBeNull()
    expect(parsed('nope')).toBeNull()
  })

  it('zeroes junk counts rather than coercing them', () => {
    const row = parsed(meterRow({ input_tokens: 'lots', output_tokens: -5, requests: null }))
    expect(row?.inputTokens).toBe(0)
    expect(row?.outputTokens).toBe(0)
    expect(row?.requests).toBe(0)
  })
})

describe('aggregateUsage', () => {
  const rows = [
    parsed(meterRow())!,
    parsed(meterRow({ model: 'claude-sonnet-5', input_tokens: 500, requests: 1 }))!,
    parsed(meterRow({ day: '2026-07-29', input_tokens: 100, requests: 2 }))!,
    parsed(meterRow({ attributed_to: 'system:cron', input_tokens: 9999, requests: 7 }))!,
  ]

  it('folds a person-day across models into one day entry', () => {
    const actors = aggregateUsage(rows, 30, '2026-07-30')
    const greg = actors.find((a) => a.actor === 'greg@x.test')!
    expect(greg.days).toHaveLength(2)
    const day30 = greg.days.find((d) => d.day === '2026-07-30')!
    expect(day30.inputTokens).toBe(1500) // both models
    expect(day30.requests).toBe(4)
    expect(greg.requests).toBe(6)
  })

  it('sorts people before system lanes and flags the system rows', () => {
    const actors = aggregateUsage(rows, 30, '2026-07-30')
    expect(actors[0].actor).toBe('greg@x.test')
    expect(actors[0].isSystem).toBe(false)
    expect(actors[actors.length - 1].actor).toBe('system:cron')
    expect(actors[actors.length - 1].isSystem).toBe(true)
  })

  it('excludes days outside the window', () => {
    const actors = aggregateUsage(rows, 1, '2026-07-30')
    const greg = actors.find((a) => a.actor === 'greg@x.test')!
    expect(greg.days.map((d) => d.day)).toEqual(['2026-07-30'])
  })

  it('orders days newest first', () => {
    const actors = aggregateUsage(rows, 30, '2026-07-30')
    const greg = actors.find((a) => a.actor === 'greg@x.test')!
    expect(greg.days[0].day).toBe('2026-07-30')
  })
})

describe('loadUsageView', () => {
  it('reports not_enabled without reading when the path is unwired', async () => {
    let read = false
    const transport = {
      read: async () => {
        read = true
        return { data: { entries: [], cursor: null } }
      },
    }
    const result = await loadUsageView({ transport, audit: noopAudit }, 'pilot', ACTOR, false)
    expect(result.status).toBe('not_enabled')
    expect(read).toBe(false) // no audit noise for a dark feature
  })

  it('walks pages and aggregates', async () => {
    const transport = fakeTransport([
      { entries: [meterRow()], cursor: 'c1' },
      { entries: [meterRow({ attributed_to: 'system:cron' })], cursor: null },
    ])
    const result = (await loadUsageView(
      { transport, audit: noopAudit },
      'pilot',
      ACTOR,
      true,
      3650 // wide window so the fixture dates stay in range
    )) as Extract<UsageReadResult, { status: 'items' }>
    expect(result.status).toBe('items')
    expect(result.actors.map((a) => a.actor)).toEqual(['greg@x.test', 'system:cron'])
  })

  it('reports empty when the seat has metered nothing', async () => {
    const transport = fakeTransport([{ entries: [], cursor: null }])
    const result = await loadUsageView({ transport, audit: noopAudit }, 'pilot', ACTOR, true)
    expect(result.status).toBe('empty')
  })

  it('reports unreachable rather than a partial number', async () => {
    const transport = {
      read: async () => {
        throw new Error('machine is asleep')
      },
    }
    const result = await loadUsageView({ transport, audit: noopAudit }, 'pilot', ACTOR, true)
    expect(result.status).toBe('unreachable')
  })

  it('drops malformed rows instead of inventing figures', async () => {
    const transport = fakeTransport([
      { entries: [meterRow(), { garbage: true }, null], cursor: null },
    ])
    const result = (await loadUsageView(
      { transport, audit: noopAudit },
      'pilot',
      ACTOR,
      true,
      3650
    )) as Extract<UsageReadResult, { status: 'items' }>
    expect(result.actors).toHaveLength(1)
    expect(result.totalRequests).toBe(3)
  })
})
