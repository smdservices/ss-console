import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('clients: admin dashboard integration', () => {
  it('admin dashboard links to entities page', () => {
    // Dashboard cards (incl. /admin/entities links) were extracted from
    // index.astro to focused components in src/components/admin/ to keep
    // index.astro within the 500-line ceiling. Combined source covers both.
    const code =
      readFileSync(resolve('src/pages/admin/index.astro'), 'utf-8') +
      '\n' +
      readFileSync(resolve('src/components/admin/DashboardTodaysWork.astro'), 'utf-8') +
      '\n' +
      readFileSync(resolve('src/components/admin/DashboardPipeline.astro'), 'utf-8')
    expect(code).toContain('/admin/entities')
    expect(code).toContain('Entities')
  })
})
