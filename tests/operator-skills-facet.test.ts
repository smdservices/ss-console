import { describe, it, expect } from 'vitest'
import {
  initiationLabels,
  resolveOperatorSkills,
} from '../src/lib/portal/operator/facets/skills/skills'
import type {
  CustomerConfigRow,
  PersonaConfig,
  PersonaSkill,
} from '../src/lib/portal/customer-config'
import type { SkillInitiation } from '../src/lib/operator/customer-yaml/types'

/**
 * Operator Skills facet resolver (ADR 0069 Slice 3; brief
 * docs/design/operator/surface-briefs/operator-skills.md). Inventory + initiation
 * from the config projection, in authored order — nothing fabricated.
 */

function init(p: Partial<SkillInitiation> = {}): SkillInitiation {
  return { manual: false, scheduled: false, webhook: false, ...p }
}

function skill(name: string, i: Partial<SkillInitiation> = {}): PersonaSkill {
  return { name, initiation: init(i) }
}

/** Minimal persona fixture — only the fields the resolver reads matter. */
function persona(p: Partial<PersonaConfig>): PersonaConfig {
  return {
    slug: 'p',
    status: 'active',
    name: 'X',
    title: null,
    signature_html: null,
    tone: [],
    send_as: null,
    entitlements: {} as PersonaConfig['entitlements'],
    skills: [],
    channel_bindings: [],
    ...p,
  }
}

function config(personas: PersonaConfig[]): CustomerConfigRow {
  return { personas } as unknown as CustomerConfigRow
}

describe('initiationLabels', () => {
  it('maps each mode to its client-legible label', () => {
    expect(initiationLabels(init({ manual: true }))).toEqual(['On request'])
    expect(initiationLabels(init({ scheduled: true }))).toEqual(['On a schedule'])
    expect(initiationLabels(init({ webhook: true }))).toEqual(['When something happens'])
  })

  it('returns labels in a stable order (request → schedule → event), not input order', () => {
    expect(initiationLabels(init({ webhook: true, manual: true, scheduled: true }))).toEqual([
      'On request',
      'On a schedule',
      'When something happens',
    ])
  })

  it('returns [] when no mode is set — the viewer shows nothing, never a fabricated trigger', () => {
    expect(initiationLabels(init())).toEqual([])
  })
})

describe('resolveOperatorSkills', () => {
  it('humanizes each skill slug for display and keeps the raw slug', () => {
    const model = resolveOperatorSkills(
      config([persona({ skills: [skill('matter-inbox-router', { webhook: true })] })])
    )
    expect(model.skills).toEqual([
      {
        name: 'Matter inbox router',
        slug: 'matter-inbox-router',
        initiation: ['When something happens'],
      },
    ])
  })

  it('preserves authored order', () => {
    const model = resolveOperatorSkills(
      config([
        persona({
          skills: [
            skill('new-matter-intake'),
            skill('consult-scheduler'),
            skill('trust-balance-nudge'),
          ],
        }),
      ])
    )
    expect(model.skills.map((s) => s.slug)).toEqual([
      'new-matter-intake',
      'consult-scheduler',
      'trust-balance-nudge',
    ])
  })

  it('reads only the ACTIVE persona', () => {
    const model = resolveOperatorSkills(
      config([
        persona({ status: 'archived', skills: [skill('old-skill', { manual: true })] }),
        persona({ status: 'active', skills: [skill('live-skill', { manual: true })] }),
      ])
    )
    expect(model.skills.map((s) => s.slug)).toEqual(['live-skill'])
  })

  it('is empty when config is null', () => {
    expect(resolveOperatorSkills(null).skills).toEqual([])
  })

  it('is empty when there is no active persona', () => {
    const model = resolveOperatorSkills(
      config([persona({ status: 'archived', skills: [skill('x', { manual: true })] })])
    )
    expect(model.skills).toEqual([])
  })

  it('is empty when the active persona has no skills', () => {
    expect(resolveOperatorSkills(config([persona({ skills: [] })])).skills).toEqual([])
  })
})
