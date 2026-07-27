/**
 * Case-alert routing gate (#2004, A&P correspondence 09).
 *
 * Christa's requirement: case-level alerts route per matter to the
 * attorney/paralegal assigned in Smokeball, never a central inbox. The
 * algorithm lives in ONE reference
 * (operator/skills/deadline-miss-escalator/references/case-alert-routing.md);
 * every alert-emitting law skill cites it instead of restating it.
 *
 * This gate holds two invariants over the skill bodies:
 *
 *  1. The retired central-delivery phrase ("(and the escalation recipients)")
 *     never reappears in any SKILL.md — reintroducing it silently re-centralizes
 *     an alert path.
 *  2. Every skill that was migrated to the routing rule still cites the
 *     reference, and the reference itself exists and names the load-bearing
 *     rules (roster check, fail-closed floor, ledger identity independence,
 *     never-grow-the-roster).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { resolve, join } from 'path'

const SKILLS_DIR = resolve('operator/skills')
const ROUTING_REF = resolve(
  'operator/skills/deadline-miss-escalator/references/case-alert-routing.md'
)
const CITATION = 'case-alert-routing.md'

/** Skills whose alert path routes per matter — each must cite the rule. */
const ROUTED_SKILLS = [
  'client-verification-tracker',
  'deadline-miss-escalator',
  'discovery-response-staging',
  'discovery-response-tracker',
  'discovery-served-watch',
  'lien-ledger-tracker',
  'matter-initiation-setup',
  'mediation-settlement-tracker',
  'medical-records-chaser',
  'meet-and-confer-drafter',
  'minors-compromise-packet',
  'motion-calendar-tracker',
  'motion-package-assembler',
  'separate-statement-assembler',
  'service-confirmation-watcher',
  'settlement-statement-feeder',
  'trial-binder-assembler',
]

function allSkillMds(): string[] {
  return readdirSync(SKILLS_DIR)
    .map((d) => join(SKILLS_DIR, d, 'SKILL.md'))
    .filter((p) => existsSync(p))
}

describe('case-alert routing (#2004)', () => {
  it('the routing reference exists and carries the load-bearing rules', () => {
    const ref = readFileSync(ROUTING_REF, 'utf-8')
    expect(ref).toContain('personResponsibleStaffId')
    // Tenant ground truth (staging probe 2026-07-27): assisting staff is the
    // personAssistingStaffs LIST, and staff usability is enabled/former (no
    // isDeleted). The gate pins the corrected names so the doc cannot drift
    // back to the published-docs shapes the probe disproved.
    expect(ref).toContain('personAssistingStaffs')
    expect(ref).toContain('enabled: false')
    expect(ref).toContain('former: true')
    expect(ref).toContain('Never grow the roster from runtime data')
    expect(ref).toContain('Fail-closed floor')
    expect(ref).toContain('Ledger identity is routing-independent')
    expect(ref).toContain('from_tainted')
  })

  it('the retired central-delivery phrase is extinct in every SKILL.md', () => {
    const offenders = allSkillMds().filter((p) =>
      readFileSync(p, 'utf-8').includes('(and the escalation recipients)')
    )
    expect(
      offenders,
      'central-delivery phrase reintroduced — alerts must route per the case-alert routing rule:\n' +
        offenders.join('\n')
    ).toEqual([])
  })

  it('every routed skill cites the routing reference', () => {
    const missing = ROUTED_SKILLS.filter((name) => {
      const body = readFileSync(join(SKILLS_DIR, name, 'SKILL.md'), 'utf-8')
      return !body.includes(CITATION)
    })
    expect(
      missing,
      `these skills alert a person but do not cite ${CITATION}:\n` + missing.join('\n')
    ).toEqual([])
  })
})
