import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('clients: admin dashboard integration', () => {
  it('admin dashboard links to entities page', () => {
    const code = readFileSync(resolve('src/pages/admin/index.astro'), 'utf-8')
    expect(code).toContain('/admin/entities')
    expect(code).toContain('Entities')
  })
})
