/**
 * Tests for the shared generic paginate<T> (src/lib/portal/operator/
 * pagination.ts). This is the single source the drafts/notifications/audit/
 * calendar resolvers delegate to; their per-surface suites cover the wrappers,
 * this pins the generic's clamping contract directly.
 */
import { describe, expect, it } from 'vitest'

import { type Page, paginate } from '../src/lib/portal/operator/pagination'

const rows = Array.from({ length: 25 }, (_, i) => i + 1) // 1..25

describe('paginate<T>', () => {
  it('returns the first page and a floored-at-1 pageCount', () => {
    const p = paginate(rows, 1, 10)
    expect(p.rows).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(p.totalCount).toBe(25)
    expect(p.page).toBe(1)
    expect(p.pageSize).toBe(10)
    expect(p.pageCount).toBe(3)
  })

  it('slices the requested middle page', () => {
    expect(paginate(rows, 2, 10).rows).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  })

  it('returns the partial last page', () => {
    expect(paginate(rows, 3, 10).rows).toEqual([21, 22, 23, 24, 25])
  })

  it('clamps an out-of-range high page to the last page (not empty)', () => {
    const p = paginate(rows, 99, 10)
    expect(p.page).toBe(3)
    expect(p.rows).toEqual([21, 22, 23, 24, 25])
  })

  it('clamps page < 1 and non-integers up to page 1', () => {
    expect(paginate(rows, 0, 10).page).toBe(1)
    expect(paginate(rows, -5, 10).page).toBe(1)
    expect(paginate(rows, 1.9, 10).page).toBe(1)
  })

  it('empty input yields page 1 of 1 with no rows', () => {
    const p: Page<number> = paginate([], 1, 10)
    expect(p.rows).toEqual([])
    expect(p.totalCount).toBe(0)
    expect(p.page).toBe(1)
    expect(p.pageCount).toBe(1)
  })

  it('accepts a readonly array and returns a mutable rows array', () => {
    const ro: readonly number[] = [1, 2, 3]
    const p = paginate(ro, 1, 2)
    p.rows.push(99) // compiles + runs: rows is T[], not readonly
    expect(p.rows).toEqual([1, 2, 99])
  })
})
