import { describe, it, expect } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import {
  loadMatters,
  loadMatterDetail,
  parseMatters,
  parseMatterDetail,
} from '../src/lib/portal/operator/matters-read'

// A DB that throws if touched — proves the not-configured path never queries.
const NOOP_DB = {
  prepare() {
    throw new Error('DB must not be touched when the runtime read path is unconfigured')
  },
} as unknown as D1Database
const ACTOR = { actor: 'partner@firm.com', actorRole: 'principal' }

describe('loadMatters / loadMatterDetail: fail-closed until wired', () => {
  it('loadMatters returns [] (and never touches D1) when the read URL is unset', async () => {
    const out = await loadMatters({ db: NOOP_DB, env: {}, actorUserId: 'u-1' }, 'smith-pi', ACTOR)
    expect(out).toEqual([])
  })

  it('loadMatterDetail returns null when the read URL is unset', async () => {
    const out = await loadMatterDetail(
      { db: NOOP_DB, env: {}, actorUserId: 'u-1' },
      'smith-pi',
      ACTOR,
      'M-1'
    )
    expect(out).toBeNull()
  })
})

describe('parseMatters: defensive parse', () => {
  const good = {
    id: 'M-1',
    clientName: 'Jane Roe',
    matterType: 'Auto Accident',
    phase: 'discovery',
    openedAt: '2026-05-01T00:00:00.000Z',
    lastAction: { skill: 'pi-demand-letter', at: '2026-06-01T00:00:00.000Z' },
  }

  it('parses a bare array and an { matters: [...] } envelope', () => {
    expect(parseMatters([good])).toHaveLength(1)
    expect(parseMatters({ matters: [good] })).toHaveLength(1)
  })

  it('resolver never supplies assignees (page stitches them)', () => {
    expect(parseMatters([good])[0].assigneeUserIds).toEqual([])
  })

  it('keeps a valid lastAction and nulls a malformed one', () => {
    expect(parseMatters([good])[0].lastAction).toEqual(good.lastAction)
    expect(parseMatters([{ ...good, lastAction: { skill: 'x' } }])[0].lastAction).toBeNull()
  })

  it('drops rows missing a required scalar or with an unknown phase', () => {
    expect(parseMatters([{ ...good, id: '' }])).toHaveLength(0)
    expect(parseMatters([{ ...good, phase: 'appeal' }])).toHaveLength(0)
    expect(parseMatters([{ ...good, openedAt: 123 }])).toHaveLength(0)
  })

  it('returns [] for non-array / non-envelope input', () => {
    expect(parseMatters(null)).toEqual([])
    expect(parseMatters('nope')).toEqual([])
    expect(parseMatters({})).toEqual([])
  })
})

describe('parseMatterDetail: defensive parse', () => {
  const detail = {
    id: 'M-1',
    clientName: 'Jane Roe',
    matterType: 'Auto Accident',
    phase: 'pre_suit',
    openedAt: '2026-05-01T00:00:00.000Z',
    facts: 'Rear-ended at a light.',
    timeline: [
      { id: 't1', at: '2026-05-02', kind: 'communication', summary: 'Intake call' },
      { id: 't2', at: '2026-05-03', kind: 'bogus_kind', summary: 'dropped' },
    ],
    draftsInFlight: [
      {
        id: 'd1',
        subject: 'Demand',
        recipient: 'adjuster@x.com',
        skill: 'pi',
        createdAt: '2026-05-04',
      },
    ],
    recentAudit: [
      { id: 'a1', at: '2026-05-05', actor: 'marcus', action: 'DRAFT_CREATED', summary: 'created' },
    ],
    lastAction: { skill: 'pi', at: '2026-05-04' },
  }

  it('parses the full detail and accepts a { matter: {...} } envelope', () => {
    const d = parseMatterDetail(detail)
    expect(d?.id).toBe('M-1')
    expect(parseMatterDetail({ matter: detail })?.id).toBe('M-1')
  })

  it('drops timeline entries with an unknown kind, keeps valid ones', () => {
    const d = parseMatterDetail(detail)
    expect(d?.timeline).toHaveLength(1)
    expect(d?.timeline[0].kind).toBe('communication')
  })

  it('returns null when the core scalars are absent', () => {
    expect(parseMatterDetail({ facts: 'x' })).toBeNull()
    expect(parseMatterDetail(null)).toBeNull()
    expect(parseMatterDetail({ ...detail, phase: 'nope' })).toBeNull()
  })
})
