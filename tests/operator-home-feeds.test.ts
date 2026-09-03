/**
 * Tests for the Home/Today runtime feeds (src/lib/portal/operator/home.ts),
 * wired to live sources in #1678:
 *
 *   - recent activity + escalations from ONE ADR 0043 runtime read
 *     (kind audit_log) — exercised here end-to-end through the real
 *     transport with a stubbed global fetch;
 *   - needsAttentionCount from the Machine-pushed draft_queue_depth in
 *     the customer's operator_runtime_summary row;
 *   - every source fails closed to an honest empty (ADR 0035: never a
 *     fabricated review queue).
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import { loadHomeFeeds } from '../src/lib/portal/operator/home'

const ACTOR = { actor: 'partner@firm.com', actorRole: 'principal' }

const CONFIGURED_ENV = {
  OPERATOR_RUNTIME_READ_URL: 'https://{app}.example.test',
  OPERATOR_RUNTIME_READ_SECRET: 'master-secret-for-tests',
}

// A DB that throws if touched — proves the not-configured path never queries.
const NOOP_DB = {
  prepare() {
    throw new Error('DB must not be touched when the runtime read path is unconfigured')
  },
} as unknown as D1Database

/**
 * Fake of the two D1 surfaces loadHomeFeeds touches: the read-audit INSERT
 * (prepare().bind().run()) and the summary-mirror SELECT
 * (prepare().bind().first()). Dispatches on the SQL text.
 */
function makeDb(opts: { draftQueueDepth?: number | null; summaryRowExists?: boolean }): {
  db: D1Database
  auditInserts: unknown[][]
} {
  const auditInserts: unknown[][] = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            run() {
              if (!sql.includes('operator_runtime_read_audit')) {
                throw new Error(`unexpected run() for sql: ${sql}`)
              }
              auditInserts.push(args)
              return Promise.resolve({})
            },
            first() {
              if (!sql.includes('operator_runtime_summary')) {
                throw new Error(`unexpected first() for sql: ${sql}`)
              }
              if (opts.summaryRowExists === false) return Promise.resolve(null)
              return Promise.resolve({ draft_queue_depth: opts.draftQueueDepth ?? null })
            },
          }
        },
      }
    },
  }
  return { db: db as unknown as D1Database, auditInserts }
}

function auditRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'row-1',
    ts: '2026-07-01T10:00:00.000Z',
    actor: 'agent',
    action: 'DRAFT_CREATED',
    skill: null,
    reason: null,
    ...overrides,
  }
}

function stubFetchWith(entries: unknown[]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ entries, cursor: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadHomeFeeds: fail-closed contracts', () => {
  it('returns honest empty feeds (and never touches D1 or fetch) when unconfigured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const feeds = await loadHomeFeeds(
      { db: NOOP_DB, env: {}, actorUserId: 'u-1' },
      'smd-staging',
      ACTOR
    )
    expect(feeds.runtimeConfigured).toBe(false)
    expect(feeds.recentActivity).toEqual([])
    expect(feeds.escalations).toEqual([])
    expect(feeds.needsAttentionCount).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fails closed to empty feeds when the Machine read fails (still audited)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('machine down')))
    const { db, auditInserts } = makeDb({ summaryRowExists: false })
    const feeds = await loadHomeFeeds(
      { db, env: CONFIGURED_ENV, actorUserId: 'u-1' },
      'smd-staging',
      ACTOR
    )
    expect(feeds.runtimeConfigured).toBe(true)
    expect(feeds.recentActivity).toEqual([])
    expect(feeds.escalations).toEqual([])
    // The failed read attempt is still recorded (ADR 0043: audited at the console).
    expect(auditInserts).toHaveLength(1)
  })

  it('refuses to target an unregistered customer (fail-closed empty)', async () => {
    const fetchMock = stubFetchWith([auditRow({})])
    const { db } = makeDb({ summaryRowExists: false })
    const feeds = await loadHomeFeeds(
      { db, env: CONFIGURED_ENV, actorUserId: 'u-1' },
      'not-a-registered-customer',
      ACTOR
    )
    expect(feeds.recentActivity).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('loadHomeFeeds: live feeds through the audit_log seam', () => {
  it('requests kind audit_log from the customer Machine and maps rows to plain language', async () => {
    const fetchMock = stubFetchWith([
      auditRow({
        id: 'a1',
        ts: '2026-07-01T10:00:00.000Z',
        action: 'DRAFT_CREATED',
        skill: 'matter-memo-on-update',
      }),
      auditRow({ id: 'a2', ts: '2026-07-01T09:00:00.000Z', action: 'REPLY_SENT' }),
    ])
    const { db } = makeDb({ summaryRowExists: false })
    const feeds = await loadHomeFeeds(
      { db, env: CONFIGURED_ENV, actorUserId: 'u-1' },
      'smd-staging',
      ACTOR
    )

    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toContain('https://hermes-smd-staging.example.test/runtime/audit_log')
    expect(calledUrl).toContain('limit=20')

    expect(feeds.runtimeConfigured).toBe(true)
    expect(feeds.recentActivity).toEqual([
      {
        id: 'a1',
        summary: 'Prepared a draft for your review: matter-memo-on-update',
        at: '2026-07-01T10:00:00.000Z',
      },
      { id: 'a2', summary: 'Replied to a message', at: '2026-07-01T09:00:00.000Z' },
    ])
  })

  it('sorts newest-first defensively and caps the recent list at 6', async () => {
    const rows = Array.from({ length: 9 }, (_, i) =>
      // Deliberately oldest-first input; the feed must re-sort.
      auditRow({ id: `a${i}`, ts: `2026-07-01T0${i}:00:00.000Z` })
    )
    stubFetchWith(rows)
    const { db } = makeDb({ summaryRowExists: false })
    const feeds = await loadHomeFeeds(
      { db, env: CONFIGURED_ENV, actorUserId: 'u-1' },
      'smd-staging',
      ACTOR
    )
    expect(feeds.recentActivity).toHaveLength(6)
    expect(feeds.recentActivity[0].id).toBe('a8')
    expect(feeds.recentActivity[5].id).toBe('a3')
  })

  it('surfaces ESCALATION_FIRED rows as escalations, preferring the recorded reason', async () => {
    stubFetchWith([
      auditRow({
        id: 'e1',
        action: 'ESCALATION_FIRED',
        reason: 'Deadline conflict on discovery response',
      }),
      auditRow({ id: 'e2', ts: '2026-07-01T08:00:00.000Z', action: 'ESCALATION_FIRED' }),
      auditRow({ id: 'a1', action: 'DRAFT_CREATED' }),
    ])
    const { db } = makeDb({ summaryRowExists: false })
    const feeds = await loadHomeFeeds(
      { db, env: CONFIGURED_ENV, actorUserId: 'u-1' },
      'smd-staging',
      ACTOR
    )
    expect(feeds.escalations).toEqual([
      {
        id: 'e1',
        summary: 'Deadline conflict on discovery response',
        at: '2026-07-01T10:00:00.000Z',
      },
      { id: 'e2', summary: 'Flagged something for your attention', at: '2026-07-01T08:00:00.000Z' },
    ])
  })
})

describe('loadHomeFeeds: needsAttentionCount from the summary mirror (ADR 0035)', () => {
  it('surfaces a Machine-reported positive depth', async () => {
    stubFetchWith([])
    const { db } = makeDb({ draftQueueDepth: 3 })
    const feeds = await loadHomeFeeds(
      { db, env: CONFIGURED_ENV, actorUserId: 'u-1' },
      'smd-staging',
      ACTOR
    )
    expect(feeds.needsAttentionCount).toBe(3)
  })

  it('never fabricates a queue: no row, NULL depth, and non-positive depth all read 0', async () => {
    stubFetchWith([])
    for (const opts of [
      { summaryRowExists: false as const },
      { draftQueueDepth: null },
      { draftQueueDepth: 0 },
      { draftQueueDepth: -2 },
    ]) {
      const { db } = makeDb(opts)
      const feeds = await loadHomeFeeds(
        { db, env: CONFIGURED_ENV, actorUserId: 'u-1' },
        'smd-staging',
        ACTOR
      )
      expect(feeds.needsAttentionCount).toBe(0)
    }
  })
})
