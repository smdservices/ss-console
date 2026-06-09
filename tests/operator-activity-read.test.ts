import { describe, it, expect } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import { loadActivityPage, parseAuditEntries } from '../src/lib/portal/operator/activity-read'
import { parseAuditListParams } from '../src/lib/portal/operator/audit'

const PARAMS = parseAuditListParams(new URLSearchParams())
// A DB that throws if touched — proves the not-configured path never queries.
const NOOP_DB = {
  prepare() {
    throw new Error('DB must not be touched when the runtime read path is unconfigured')
  },
} as unknown as D1Database

const ACTOR = { actor: 'partner@firm.com', actorRole: 'principal' }

describe('loadActivityPage: fail-closed empty until wired', () => {
  it('returns an empty page (and never touches D1) when OPERATOR_RUNTIME_READ_URL is unset', async () => {
    const page = await loadActivityPage(
      { db: NOOP_DB, env: {}, actorUserId: 'u-1' },
      'smith-pi',
      ACTOR,
      PARAMS
    )
    expect(page.totalCount).toBe(0)
    expect(page.rows).toEqual([])
  })

  it('returns an empty page when the read URL is empty string', async () => {
    const page = await loadActivityPage(
      { db: NOOP_DB, env: { OPERATOR_RUNTIME_READ_URL: '' }, actorUserId: 'u-1' },
      'smith-pi',
      ACTOR,
      PARAMS
    )
    expect(page.totalCount).toBe(0)
  })
})

describe('parseAuditEntries: defensive parse, never cast', () => {
  it('parses a bare array of well-formed rows', () => {
    const rows = parseAuditEntries([
      {
        id: 'a1',
        ts: '2026-06-01T10:00:00.000Z',
        actor: 'marcus',
        action: 'DRAFT_CREATED',
        actorRole: 'agent',
        target: 'draft-9',
        decision: 'draft_for_review',
        reason: 'client email',
        skill: 'inbox-triage',
        matterRef: 'M-1',
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('a1')
    expect(rows[0].actorRole).toBe('agent')
    expect(rows[0].decision).toBe('draft_for_review')
  })

  it('accepts an { entries: [...] } envelope', () => {
    const rows = parseAuditEntries({
      entries: [{ id: 'a1', ts: '2026-06-01T10:00:00.000Z', actor: 'm', action: 'X' }],
    })
    expect(rows).toHaveLength(1)
  })

  it('drops rows missing any required field (id/ts/actor/action)', () => {
    const rows = parseAuditEntries([
      { ts: '2026-06-01', actor: 'm', action: 'X' }, // no id
      { id: 'a', actor: 'm', action: 'X' }, // no ts
      { id: 'a', ts: '2026-06-01', action: 'X' }, // no actor
      { id: 'a', ts: '2026-06-01', actor: 'm' }, // no action
      { id: 'ok', ts: '2026-06-01', actor: 'm', action: 'X' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('ok')
  })

  it('coerces unknown actorRole / decision to null rather than passing them through', () => {
    const rows = parseAuditEntries([
      {
        id: 'a',
        ts: '2026-06-01',
        actor: 'm',
        action: 'X',
        actorRole: 'operator', // legacy role value — not in the vocabulary
        decision: 'bogus',
      },
    ])
    expect(rows[0].actorRole).toBeNull()
    expect(rows[0].decision).toBeNull()
  })

  it('returns [] for non-array / non-envelope input', () => {
    expect(parseAuditEntries(null)).toEqual([])
    expect(parseAuditEntries(undefined)).toEqual([])
    expect(parseAuditEntries('nope')).toEqual([])
    expect(parseAuditEntries({})).toEqual([])
    expect(parseAuditEntries(42)).toEqual([])
  })
})
