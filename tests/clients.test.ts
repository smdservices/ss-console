import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('home: admin launchpad integration', () => {
  const source = () => readFileSync(resolve('src/pages/admin/index.astro'), 'utf-8')

  it('home links to the Services and Billing surfaces', () => {
    const code = source()
    // Action-queue items and the money band deep-link into Services/Billing.
    // Leads is reached via the nav; the acquisition motion card was retired
    // with the lead-gen machine (ADR 0060).
    expect(code).toContain('/admin/services')
    expect(code).toContain('/admin/billing')
  })

  it('home composes the action queue and both revenue shapes', () => {
    const code = source()
    expect(code).toContain('Needs you today')
    expect(code).toContain('buildActionQueue')
    expect(code).toContain('One-time')
    expect(code).toContain('Recurring')
  })
})
