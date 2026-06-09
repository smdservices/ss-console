import { describe, it, expect } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import { loadWorkItems, parseWorkItems } from '../src/lib/portal/operator/work-read'

const NOOP_DB = {
  prepare() {
    throw new Error('DB must not be touched when the runtime read path is unconfigured')
  },
} as unknown as D1Database
const ACTOR = { actor: 'pat@firm.com', actorRole: 'staff' }

describe('loadWorkItems: fail-closed, never a fabricated queue', () => {
  it('returns [] (and never touches D1) when the read path is unconfigured', async () => {
    const items = await loadWorkItems(
      { db: NOOP_DB, env: {}, actorUserId: 'u-1' },
      'smith-pi',
      ACTOR
    )
    expect(items).toEqual([])
  })
})

describe('parseWorkItems: defensive parse', () => {
  const good = {
    id: 'd1',
    subject: 'Demand letter',
    recipient: 'adjuster@x.com',
    skill: 'pi-demand-letter',
    createdAt: '2026-06-01T00:00:00.000Z',
  }
  it('parses a bare array and an { items: [...] } envelope', () => {
    expect(parseWorkItems([good])).toHaveLength(1)
    expect(parseWorkItems({ items: [good] })).toHaveLength(1)
  })
  it('drops rows missing a required field', () => {
    expect(parseWorkItems([{ ...good, subject: '' }])).toHaveLength(0)
    expect(parseWorkItems([{ ...good, recipient: undefined }])).toHaveLength(0)
  })
  it('returns [] for non-array / non-envelope input', () => {
    expect(parseWorkItems(null)).toEqual([])
    expect(parseWorkItems('nope')).toEqual([])
    expect(parseWorkItems({})).toEqual([])
  })
})
