import { describe, it, expect } from 'vitest'
import { buildOperatorRoster, isRosterOfOne } from '../src/lib/portal/operator/roster'
import type { PersonaConfig } from '../src/lib/portal/customer-config'

function persona(over: Partial<PersonaConfig> = {}): PersonaConfig {
  return {
    slug: 'marcus',
    status: 'active',
    name: 'Marcus',
    title: 'Intake Coordinator',
    signature_html: null,
    tone: ['warm', 'concise'],
    send_as: null,
    skills: [
      { name: 'inbox-triage', trust_ceiling: 'draft_for_review' },
      { name: 'pi-demand-letter', trust_ceiling: 'refused' },
    ],
    channel_bindings: [],
    ...over,
  }
}

describe('buildOperatorRoster', () => {
  it('projects persona identity + enabled skills as what it handles', () => {
    const roster = buildOperatorRoster([persona()])
    expect(roster).toHaveLength(1)
    expect(roster[0].name).toBe('Marcus')
    expect(roster[0].title).toBe('Intake Coordinator')
    expect(roster[0].status).toBe('active')
    expect(roster[0].tone).toEqual(['warm', 'concise'])
    // refused skill is configured but not "handled"
    expect(roster[0].handles).toEqual(['inbox-triage'])
  })

  it('handles N personas (built for N, shipped at 1)', () => {
    const roster = buildOperatorRoster([
      persona({ slug: 'a', name: 'A' }),
      persona({ slug: 'b', name: 'B' }),
    ])
    expect(roster.map((r) => r.name)).toEqual(['A', 'B'])
  })
})

describe('isRosterOfOne', () => {
  it('is true for zero or one operator (no switcher chrome)', () => {
    expect(isRosterOfOne([])).toBe(true)
    expect(isRosterOfOne(buildOperatorRoster([persona()]))).toBe(true)
  })
  it('is false for two or more', () => {
    expect(
      isRosterOfOne(buildOperatorRoster([persona({ slug: 'a' }), persona({ slug: 'b' })]))
    ).toBe(false)
  })
})
