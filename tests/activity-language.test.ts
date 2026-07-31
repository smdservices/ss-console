import { describe, it, expect } from 'vitest'
import {
  CLIENT_ACTIVITY_CATEGORIES,
  MAPPED_ACTIONS,
  SUPPRESSED_ACTIONS,
  mappedActionsForCategories,
  toClientActivity,
} from '../src/lib/portal/operator/activity-language'
import { AUDIT_ACTION_TYPES } from '../src/lib/portal/operator/audit'
import type { AuditEntry } from '../src/lib/portal/operator/audit'

function entry(action: string, extra: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: `e-${action}`,
    ts: '2026-07-07T00:00:00Z',
    actor: 'agent',
    actorRole: 'agent',
    action,
    target: null,
    decision: null,
    reason: null,
    skill: null,
    ...extra,
  }
}

describe('activity-language exhaustiveness (writer parity)', () => {
  it('every writer-side action is deliberately MAPPED or SUPPRESSED, never both', () => {
    const mapped = new Set(MAPPED_ACTIONS)
    for (const action of AUDIT_ACTION_TYPES) {
      const inMapped = mapped.has(action)
      const inSuppressed = SUPPRESSED_ACTIONS.has(action)
      expect(inMapped || inSuppressed, `${action} has no client-language decision`).toBe(true)
      expect(inMapped && inSuppressed, `${action} is in both sets`).toBe(false)
    }
  })

  it('every category action has authored language', () => {
    const mapped = new Set(MAPPED_ACTIONS)
    for (const category of CLIENT_ACTIVITY_CATEGORIES) {
      for (const action of category.actions) {
        expect(mapped.has(action), `${category.key}:${action} lacks language`).toBe(true)
      }
    }
  })

  it('the mapped vocabulary is a deliberate snapshot (additions require editing this test)', () => {
    expect([...MAPPED_ACTIONS].sort()).toEqual(
      [
        'AGENT_RESUMED',
        'AGENT_STOPPED',
        'COMPLIANCE_PACKET_EXPORTED',
        'CONFIG_CHANGE_REJECTED',
        'CONFIG_CHANGE_SUBMITTED',
        'CONNECTOR_AUTH_EXPIRED',
        'CONNECTOR_AUTH_RESTORED',
        'CONNECTOR_BOUND',
        'CONNECTOR_RECONSENT_REQUESTED',
        'CONNECTOR_UNBOUND',
        'DRAFT_APPROVED',
        'DRAFT_CREATED',
        'DRAFT_EXPIRED',
        'DRAFT_REJECTED',
        'ENTITLEMENT_CHANGED',
        'ESCALATION_ACKNOWLEDGED',
        'ESCALATION_FIRED',
        'OUTPUT_SPEC_AUTHORED',
        'OUTPUT_SPEC_REJECTED',
        'PORTAL_LOGIN',
        'REPLY_HELD',
        'REPLY_SENT',
        'SCOPE_CHANGED',
        'SKILL_DISABLED',
        'SKILL_ENABLED',
        'TEAM_INVITE_SENT',
        'TEAM_ROLE_GRANTED',
        'TEAM_ROLE_REVOKED',
        'TRUST_DEMOTED',
        'TRUST_PROMOTED',
      ].sort()
    )
  })
})

describe('toClientActivity', () => {
  it('drops unmapped and unknown actions entirely', () => {
    const lines = toClientActivity([
      entry('INVARIANT_VIOLATION'),
      entry('LLM_TURN_COMPLETED'),
      entry('HONCHO_CONCLUSION_DISMISSED'),
      entry('DRAFT_CREATED'),
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0].summary).toContain('draft')
  })

  it('never leaks raw action vocabulary into summaries', () => {
    const lines = toClientActivity(AUDIT_ACTION_TYPES.map((a) => entry(a)))
    for (const line of lines) {
      expect(line.summary).not.toMatch(/[A-Z]{2,}_[A-Z]/)
      expect(line.summary.toLowerCase()).not.toContain('invariant')
    }
  })

  it('interpolates real row data only where present', () => {
    const withSkill = toClientActivity([entry('SKILL_ENABLED', { skill: 'inbox-triage' })])
    expect(withSkill[0].summary).toBe('A skill was turned on: inbox-triage')
    const noSkill = toClientActivity([entry('SKILL_ENABLED')])
    expect(noSkill[0].summary).toBe('A skill was turned on')
    const escalation = toClientActivity([entry('ESCALATION_FIRED', { reason: 'Payment bounced' })])
    expect(escalation[0].summary).toBe('Payment bounced')
  })

  it('assigns the category that owns the action', () => {
    const [line] = toClientActivity([entry('CONNECTOR_BOUND', { target: 'Google Calendar' })])
    expect(line.categoryKey).toBe('connections')
    expect(line.summary).toBe('Connected Google Calendar')
  })
})

describe('mappedActionsForCategories', () => {
  it('empty selection returns the full mapped vocabulary (the SQL-side default filter)', () => {
    expect(mappedActionsForCategories([]).sort()).toEqual([...MAPPED_ACTIONS].sort())
  })

  it('a category selection returns only its actions', () => {
    expect(mappedActionsForCategories(['escalations']).sort()).toEqual([
      'ESCALATION_ACKNOWLEDGED',
      'ESCALATION_FIRED',
    ])
  })
})
