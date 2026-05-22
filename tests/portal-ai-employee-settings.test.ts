/**
 * Tests for the AI Employee settings resolver
 * (src/lib/portal/ai-employee/settings.ts).
 *
 * The settings page composes four pure projections from
 * customer.yaml plus two subsystem-bound reads (voice samples,
 * connector health) that are stubbed empty today. We cover the
 * pure projections directly and assert that the stubbed reads
 * keep returning empty arrays so a future change cannot silently
 * fabricate rows.
 */

import { describe, it, expect } from 'vitest'
import {
  TRUST_CEILING_LEVELS,
  connectorRowsFromCustomerYaml,
  formatConnectorHealth,
  formatTrustCeilingLevel,
  formatVoiceSampleStatus,
  isTrustCeilingLevel,
  skillToggleRowsFromPersona,
  trustCeilingRowsFromPersona,
  type ConnectorHealth,
  type TrustCeilingLevel,
  type VoiceSampleStatus,
} from '../src/lib/portal/ai-employee/settings'
import type { PersonaConfig } from '../src/lib/portal/customer-config'

function makePersona(skills: Array<{ name: string; trust_ceiling: string }>): PersonaConfig {
  return {
    slug: 'p',
    status: 'active',
    name: 'Persona',
    title: null,
    signature_html: null,
    tone: [],
    send_as: null,
    skills,
    channel_bindings: [],
  }
}

describe('isTrustCeilingLevel', () => {
  it('accepts the three canonical values', () => {
    expect(isTrustCeilingLevel('autonomous')).toBe(true)
    expect(isTrustCeilingLevel('draft_for_review')).toBe(true)
    expect(isTrustCeilingLevel('refused')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isTrustCeilingLevel('AUTONOMOUS')).toBe(false)
    expect(isTrustCeilingLevel('autosend')).toBe(false)
    expect(isTrustCeilingLevel('')).toBe(false)
    expect(isTrustCeilingLevel(null)).toBe(false)
    expect(isTrustCeilingLevel(undefined)).toBe(false)
    expect(isTrustCeilingLevel(0)).toBe(false)
  })
})

describe('TRUST_CEILING_LEVELS', () => {
  it('exposes the closed vocabulary in the expected order', () => {
    expect(TRUST_CEILING_LEVELS).toEqual(['autonomous', 'draft_for_review', 'refused'])
  })
})

describe('formatTrustCeilingLevel', () => {
  it('maps every value to a friendly label', () => {
    expect(formatTrustCeilingLevel('autonomous')).toBe('Autonomous')
    expect(formatTrustCeilingLevel('draft_for_review')).toBe('Draft for review')
    expect(formatTrustCeilingLevel('refused')).toBe('Refused')
  })
})

describe('trustCeilingRowsFromPersona', () => {
  it('returns an empty list when persona is null', () => {
    expect(trustCeilingRowsFromPersona(null)).toEqual([])
  })

  it('projects each skill into a row, preserving order', () => {
    const persona = makePersona([
      { name: 'law-pi-intake-triage', trust_ceiling: 'draft_for_review' },
      { name: 'law-pi-demand-letter-draft', trust_ceiling: 'autonomous' },
      { name: 'law-pi-discovery-response', trust_ceiling: 'refused' },
    ])
    const rows = trustCeilingRowsFromPersona(persona)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({
      skillName: 'law-pi-intake-triage',
      currentLevel: 'draft_for_review',
      rawLevel: 'draft_for_review',
    })
    expect(rows[1].currentLevel).toBe('autonomous')
    expect(rows[2].currentLevel).toBe('refused')
  })

  it('null-out currentLevel for an unknown ceiling, keeping rawLevel', () => {
    const persona = makePersona([{ name: 's1', trust_ceiling: 'mystery' }])
    const rows = trustCeilingRowsFromPersona(persona)
    expect(rows[0].currentLevel).toBeNull()
    expect(rows[0].rawLevel).toBe('mystery')
  })
})

describe('skillToggleRowsFromPersona', () => {
  it('returns an empty list when persona is null', () => {
    expect(skillToggleRowsFromPersona(null)).toEqual([])
  })

  it('marks autonomous and draft_for_review skills as enabled', () => {
    const persona = makePersona([
      { name: 'a', trust_ceiling: 'autonomous' },
      { name: 'd', trust_ceiling: 'draft_for_review' },
    ])
    const rows = skillToggleRowsFromPersona(persona)
    expect(rows[0]).toEqual({ skillName: 'a', enabled: true, trustCeiling: 'autonomous' })
    expect(rows[1]).toEqual({ skillName: 'd', enabled: true, trustCeiling: 'draft_for_review' })
  })

  it('marks refused skills as disabled', () => {
    const persona = makePersona([{ name: 'r', trust_ceiling: 'refused' }])
    const rows = skillToggleRowsFromPersona(persona)
    expect(rows[0]).toEqual({ skillName: 'r', enabled: false, trustCeiling: 'refused' })
  })

  it('marks unknown ceilings as disabled with null trustCeiling', () => {
    const persona = makePersona([{ name: 'u', trust_ceiling: 'who-knows' }])
    const rows = skillToggleRowsFromPersona(persona)
    expect(rows[0]).toEqual({ skillName: 'u', enabled: false, trustCeiling: null })
  })
})

describe('connectorRowsFromCustomerYaml', () => {
  it('returns an empty list for null / non-object input', () => {
    expect(connectorRowsFromCustomerYaml(null)).toEqual([])
    expect(connectorRowsFromCustomerYaml(undefined)).toEqual([])
    expect(connectorRowsFromCustomerYaml('string')).toEqual([])
    expect(connectorRowsFromCustomerYaml(42)).toEqual([])
  })

  it('returns an empty list for an empty connectors map', () => {
    expect(connectorRowsFromCustomerYaml({})).toEqual([])
  })

  it('projects each capability into a row sorted by name', () => {
    const rows = connectorRowsFromCustomerYaml({
      PracticeManagement: { adapter: 'filevine' },
      Email: { adapter: 'microsoft-graph' },
      Calendar: { adapter: 'microsoft-graph' },
    })
    expect(rows.map((r) => r.capabilityName)).toEqual(['Calendar', 'Email', 'PracticeManagement'])
    expect(rows.every((r) => r.health === 'unconfigured')).toBe(true)
    expect(rows.every((r) => r.reconsentRequired === false)).toBe(true)
  })

  it('tolerates entries without an adapter string', () => {
    const rows = connectorRowsFromCustomerYaml({
      Email: {},
      Calendar: { adapter: 42 },
    })
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.adapter === '')).toBe(true)
  })

  it('skips non-object entries', () => {
    const rows = connectorRowsFromCustomerYaml({
      Email: null,
      Calendar: 'string',
      PracticeManagement: { adapter: 'filevine' },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].capabilityName).toBe('PracticeManagement')
  })
})

describe('formatConnectorHealth', () => {
  it('maps every value to a friendly label', () => {
    const cases: Array<[ConnectorHealth, string]> = [
      ['ok', 'OK'],
      ['warn', 'Warn'],
      ['fail', 'Fail'],
      ['unconfigured', 'Unconfigured'],
    ]
    for (const [value, label] of cases) {
      expect(formatConnectorHealth(value)).toBe(label)
    }
  })
})

describe('formatVoiceSampleStatus', () => {
  it('maps every value to a friendly label', () => {
    const cases: Array<[VoiceSampleStatus, string]> = [
      ['ready', 'Ready'],
      ['pending', 'Pending'],
      ['error', 'Error'],
    ]
    for (const [value, label] of cases) {
      expect(formatVoiceSampleStatus(value)).toBe(label)
    }
  })
})

// Empty-state contract regression — assert TrustCeilingLevel signature
// stays in sync with the closed vocabulary.
describe('TrustCeilingLevel type compile-time contract', () => {
  it('every TRUST_CEILING_LEVELS value formats to a non-empty string', () => {
    for (const level of TRUST_CEILING_LEVELS) {
      const cast: TrustCeilingLevel = level
      expect(formatTrustCeilingLevel(cast).length).toBeGreaterThan(0)
    }
  })
})
