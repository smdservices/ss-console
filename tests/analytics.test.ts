import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// The admin Analytics surface was retired 2026-07-14 (ADR 0077): the page,
// its query layer (src/lib/db/analytics.ts), the events read-layer
// (src/lib/db/events-analytics.ts), and AnalyticsSiteTraffic were all deleted
// as a dead pipeline-funnel dashboard. The query-layer and dashboard-page test
// blocks went with them. What remains is unrelated: the admin HOME metrics,
// which are not part of the analytics surface.
describe('admin home metrics', () => {
  const source = () => readFileSync(resolve('src/pages/admin/index.astro'), 'utf-8')

  it('admin home shows the delivery (in-motion) metric', () => {
    expect(source()).toContain('deliveryStats')
  })

  it('admin home shows the one-time revenue totals', () => {
    expect(source()).toContain('oneTimeTotals')
  })
})
