/**
 * Chronology-package jobs read (routine 11, ss#2614). The four properties the
 * admin page rests on: a dark read path performs no read, a malformed row is
 * dropped rather than invented, an unreachable seat reports unreachable, and
 * the month's totals count delivered jobs only.
 */

import { describe, it, expect } from 'vitest'
import { loadMedchronJobsView, monthTotals, parseJobRow } from '../src/lib/admin/medchron-jobs-read'

const ACTOR = { actor: 'captain@smd.services', actorRole: 'admin' }
const noopAudit = { record: async () => {} }

function row(over: Record<string, unknown> = {}) {
  return {
    id: '01J',
    created_at: '2026-08-29T10:00:00.000Z',
    updated_at: '2026-08-29T14:00:00.000Z',
    state: 'delivered',
    matter_number: '2026-PI-102',
    documents: 40,
    pages: 900,
    cents: 4100,
    reason: null,
    folder_id: 'f-1',
    ...over,
  }
}

describe('parseJobRow', () => {
  it('parses a well-formed ledger row', () => {
    const r = parseJobRow(row())
    expect(r?.state).toBe('delivered')
    expect(r?.documents).toBe(40)
    expect(r?.folderId).toBe('f-1')
  })

  it('drops a row without an id or with an unknown state, and zeroes junk counts', () => {
    expect(parseJobRow(row({ id: '' }))).toBeNull()
    expect(parseJobRow(row({ state: 'done' }))).toBeNull()
    expect(parseJobRow('nope')).toBeNull()
    expect(parseJobRow(row({ pages: 'many', cents: -5 }))?.pages).toBe(0)
    expect(parseJobRow(row({ pages: 'many', cents: -5 }))?.cents).toBe(0)
  })
})

describe('monthTotals', () => {
  it('counts delivered jobs only, in the month asked for', () => {
    const jobs = [
      parseJobRow(row())!,
      parseJobRow(row({ id: '02', state: 'held', reason: 'seat paused', documents: 99 }))!,
      parseJobRow(row({ id: '03', created_at: '2026-07-02T00:00:00.000Z', documents: 7 }))!,
    ]
    const m = monthTotals(jobs, '2026-08')
    expect(m).toEqual({
      month: '2026-08',
      jobs: 2,
      delivered: 1,
      held: 1,
      documents: 40,
      pages: 900,
      cents: 4100,
    })
  })
})

describe('loadMedchronJobsView', () => {
  it('returns not_enabled without reading when the seam is dark', async () => {
    let reads = 0
    const transport = {
      read: async () => {
        reads += 1
        return { data: { entries: [row()] } }
      },
    }
    const result = await loadMedchronJobsView(
      { transport, audit: noopAudit },
      'example',
      ACTOR,
      false
    )
    expect(result).toEqual({ status: 'not_enabled' })
    expect(reads).toBe(0)
  })

  it('reads the kind once, drops malformed rows, sorts newest first', async () => {
    const transport = {
      read: async (_slug: string, query: { kind: string }) => {
        expect(query.kind).toBe('medchron_jobs')
        return {
          data: {
            entries: [
              row({ id: 'old', created_at: '2026-08-01T00:00:00.000Z' }),
              { id: 'broken' },
              row({ id: 'new', created_at: '2026-08-29T00:00:00.000Z', state: 'running' }),
            ],
          },
        }
      },
    }
    const result = await loadMedchronJobsView(
      { transport, audit: noopAudit },
      'example',
      ACTOR,
      true,
      '2026-08'
    )
    expect(result.status).toBe('items')
    if (result.status !== 'items') return
    expect(result.jobs.map((j) => j.id)).toEqual(['new', 'old'])
    expect(result.month.jobs).toBe(2)
    expect(result.month.delivered).toBe(1)
  })

  it('reports unreachable rather than an empty table when the seat cannot be read', async () => {
    const transport = {
      read: async () => {
        throw new Error('boom')
      },
    }
    const result = await loadMedchronJobsView(
      { transport, audit: noopAudit },
      'example',
      ACTOR,
      true
    )
    expect(result.status).toBe('unreachable')
  })

  it('is empty when the ledger has no rows', async () => {
    const transport = { read: async () => ({ data: { entries: [] } }) }
    const result = await loadMedchronJobsView(
      { transport, audit: noopAudit },
      'example',
      ACTOR,
      true
    )
    expect(result).toEqual({ status: 'empty' })
  })
})
