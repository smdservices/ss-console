/**
 * Generic offset-based pagination for the Operator portal list surfaces.
 *
 * The drafts / notifications / audit / calendar resolvers each carried a
 * byte-identical `paginate*` function and a structurally-identical `*ListPage`
 * interface. This is the single source; each surface keeps its named wrapper +
 * type alias for call-site stability, delegating here.
 *
 * Page is 1-indexed and clamped to `[1, pageCount]`. Out-of-range pages return
 * the last page rather than an empty result — keeps a deep link to a
 * just-cleared page from rendering as "nothing here" when the reviewer meant
 * the new top of the list. `pageCount` is floored at 1 even with zero rows so
 * "Page 1 of 1" reads sensibly in the empty state.
 */
export interface Page<T> {
  rows: T[]
  totalCount: number
  page: number
  pageSize: number
  pageCount: number
}

export function paginate<T>(rows: readonly T[], page: number, pageSize: number): Page<T> {
  const totalCount = rows.length
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize))
  const clampedPage = Math.min(Math.max(1, Math.floor(page)), pageCount)
  const start = (clampedPage - 1) * pageSize
  return {
    rows: rows.slice(start, start + pageSize),
    totalCount,
    page: clampedPage,
    pageSize,
    pageCount,
  }
}
