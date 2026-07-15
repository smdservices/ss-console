import { describe, it, expect } from 'vitest'
import {
  describeCronSchedule,
  scheduleDetailBySkill,
} from '../src/lib/portal/operator/facets/schedule/schedule'
import { resolveOperatorSkills } from '../src/lib/portal/operator/facets/skills/skills'
import type { CustomerConfigRow, PersonaConfig } from '../src/lib/portal/customer-config'

/**
 * Schedule facet (console blueprint §4 — the schedule coverage gap). The cron
 * describer is DETERMINISTIC and deliberately partial: only the shapes seats
 * actually author translate; everything else returns null (a wrong translation
 * would be fabrication, a missing one is just less detail).
 */

describe('describeCronSchedule', () => {
  it('translates the three authored shapes (daily / weekdays / single weekday)', () => {
    expect(describeCronSchedule('0 7 * * *')).toBe('Daily at 7:00 a.m.')
    expect(describeCronSchedule('23 6 * * 1-5')).toBe('Weekdays at 6:23 a.m.')
    expect(describeCronSchedule('9 8 * * 2')).toBe('Weekly on Tuesday at 8:09 a.m.')
    expect(describeCronSchedule('0 12 * * *')).toBe('Daily at 12:00 p.m.')
    expect(describeCronSchedule('30 0 * * *')).toBe('Daily at 12:30 a.m.')
    expect(describeCronSchedule('15 17 * * 5')).toBe('Weekly on Friday at 5:15 p.m.')
  })

  it('returns null for anything outside the describable shapes (never mistranslates)', () => {
    expect(describeCronSchedule('*/17 * * * *')).toBeNull()
    expect(describeCronSchedule('0 7 1 * *')).toBeNull()
    expect(describeCronSchedule('0 7 * 2 *')).toBeNull()
    expect(describeCronSchedule('99 7 * * *')).toBeNull()
    expect(describeCronSchedule('0 25 * * *')).toBeNull()
    expect(describeCronSchedule('not cron')).toBeNull()
  })
})

describe('scheduleDetailBySkill', () => {
  it('maps skills to prose, joining multiple describable entries, omitting the rest', () => {
    const map = scheduleDetailBySkill([
      { skill: 'a', schedule: '0 7 * * *' },
      { skill: 'a', schedule: '9 8 * * 2' },
      { skill: 'b', schedule: '*/17 * * * *' },
    ])
    expect(map.get('a')).toBe('Daily at 7:00 a.m. · Weekly on Tuesday at 8:09 a.m.')
    expect(map.has('b')).toBe(false)
  })
})

function persona(p: Partial<PersonaConfig>): PersonaConfig {
  return {
    slug: 'p',
    status: 'active',
    name: 'X',
    title: null,
    signature_html: null,
    tone: [],
    send_as: null,
    entitlements: { exposure: {} },
    skills: [],
    channel_bindings: [],
    ...p,
  }
}

describe('schedule prose on the skills inventory', () => {
  it('attaches prose to scheduled skills from projected cron; null elsewhere', () => {
    const config = {
      personas: [
        persona({
          skills: [
            { name: 'digest', initiation: { manual: false, scheduled: true, webhook: false } },
            { name: 'router', initiation: { manual: true, scheduled: false, webhook: true } },
          ],
          cron: [{ skill: 'digest', schedule: '23 6 * * 1-5' }],
        }),
      ],
    } as unknown as CustomerConfigRow
    const { skills } = resolveOperatorSkills(config)
    expect(skills[0].scheduleDetail).toBe('Weekdays at 6:23 a.m.')
    expect(skills[1].scheduleDetail).toBeNull()
  })

  it('rows projected before the cron field existed parse with no prose (defensive)', () => {
    const config = {
      personas: [
        persona({
          skills: [{ name: 'x', initiation: { manual: true, scheduled: false, webhook: false } }],
        }),
      ],
    } as unknown as CustomerConfigRow
    expect(resolveOperatorSkills(config).skills[0].scheduleDetail).toBeNull()
  })
})
