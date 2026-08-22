import { describe, it, expect } from 'vitest'
import {
  buildGovernanceFloorRows,
  parseScope,
  parseBusinessHours,
  formatCeiling,
  ACTION_CLASS_LABEL,
} from '../src/lib/portal/operator/configure'
import { ACCEPTED_ACTION_CLASSES } from '../src/lib/operator/customer-yaml/types'
import type { ActionClass } from '../src/lib/operator/customer-yaml/types'
import { VERTICAL_FLOORS } from '../src/lib/portal/operator/config-governance'
import type { Ceiling } from '../src/lib/portal/operator/config-governance'

describe('buildGovernanceFloorRows (action-class model)', () => {
  it('returns one row per action class, in canonical order', () => {
    const rows = buildGovernanceFloorRows('law-firm')
    expect(rows.map((r) => r.actionClass)).toEqual([...ACCEPTED_ACTION_CLASSES])
    expect(rows.every((r) => r.label === ACTION_CLASS_LABEL[r.actionClass])).toBe(true)
  })

  it('law-firm has NO floors (external_send floor removed 2026-07, ADR 0073)', () => {
    const byClass = Object.fromEntries(
      buildGovernanceFloorRows('law-firm').map((r) => [r.actionClass, r.floor])
    )
    expect(byClass['external_send']).toBeNull()
    expect(byClass['read']).toBeNull()
    expect(byClass['destructive']).toBeNull()
  })

  it('surfaces a declared floor (machinery coverage, synthetic vertical)', () => {
    const floors = VERTICAL_FLOORS as Record<string, Partial<Record<ActionClass, Ceiling>>>
    floors['floored-test-vertical'] = { external_send: 'draft_for_review' }
    try {
      const byClass = Object.fromEntries(
        buildGovernanceFloorRows('floored-test-vertical').map((r) => [r.actionClass, r.floor])
      )
      expect(byClass['external_send']).toBe('draft_for_review')
      expect(byClass['read']).toBeNull()
    } finally {
      delete floors['floored-test-vertical']
    }
  })

  it('a null/unknown vertical has no floors (all null) — never a fabricated default', () => {
    expect(buildGovernanceFloorRows(null).every((r) => r.floor === null)).toBe(true)
    expect(buildGovernanceFloorRows('unknown-vertical').every((r) => r.floor === null)).toBe(true)
  })
})

describe('parseScope', () => {
  it('parses a full scope blob', () => {
    const s = parseScope({
      email_folders_visible: ['Inbox', 'Matters'],
      email_folders_blind: ['Personal'],
      email_keyword_blocks: ['settlement'],
      domain_blocks: ['opposing.com'],
      matter_blocks: ['M-99'],
    })
    expect(s?.email_folders_visible).toEqual(['Inbox', 'Matters'])
    expect(s?.domain_blocks).toEqual(['opposing.com'])
  })
  it('coerces missing/!array fields to [] and non-objects to null', () => {
    expect(parseScope({})).toEqual({
      email_folders_visible: [],
      email_folders_blind: [],
      email_keyword_blocks: [],
      domain_blocks: [],
      matter_blocks: [],
      inbound_allow_from: [],
      outbound_roster: [],
      admins: [],
      rule_requests_to: [],
    })
    expect(parseScope(null)).toBeNull()
    expect(parseScope('nope')).toBeNull()
  })
  it('drops non-string entries from arrays', () => {
    const s = parseScope({ email_folders_visible: ['Inbox', 3, null, 'Sent'] })
    expect(s?.email_folders_visible).toEqual(['Inbox', 'Sent'])
  })

  it('parses outbound_roster and drops malformed entries (ADR 0075)', () => {
    const s = parseScope({
      outbound_roster: [
        { address: 'jane@gmail.com', class: 'client', note: 'PI client' },
        { address: 'records@radiology.com', class: 'records_vendor' },
        { address: 'x@y.com', class: 'opposing_counsel' }, // bad class → dropped
        { class: 'client' }, // missing address → dropped
        'not-an-object', // dropped
      ],
    })
    expect(s?.outbound_roster).toEqual([
      { address: 'jane@gmail.com', class: 'client', note: 'PI client' },
      { address: 'records@radiology.com', class: 'records_vendor' },
    ])
  })

  it('outbound_roster defaults to [] when absent/non-array', () => {
    expect(parseScope({})?.outbound_roster).toEqual([])
    expect(parseScope({ outbound_roster: 'nope' })?.outbound_roster).toEqual([])
  })
})

describe('parseBusinessHours', () => {
  it('parses a full block', () => {
    const h = parseBusinessHours({
      timezone: 'America/Phoenix',
      days: ['Mon', 'Tue'],
      start: '09:00',
      end: '17:00',
    })
    expect(h).toEqual({
      timezone: 'America/Phoenix',
      days: ['Mon', 'Tue'],
      start: '09:00',
      end: '17:00',
    })
  })
  it('returns null when a required field is missing', () => {
    expect(parseBusinessHours({ days: ['Mon'], start: '09:00', end: '17:00' })).toBeNull()
    expect(parseBusinessHours({ timezone: 'X', start: '09:00' })).toBeNull()
    expect(parseBusinessHours(null)).toBeNull()
  })
})

describe('formatCeiling', () => {
  it('labels every ceiling, including confirm (ADR 0071)', () => {
    expect(formatCeiling('autonomous')).toBe('Autonomous')
    expect(formatCeiling('confirm')).toBe('Confirm')
    expect(formatCeiling('draft_for_review')).toBe('Draft for review')
    expect(formatCeiling('refused')).toBe('Refused')
  })
})

describe('ACTION_CLASS_LABEL (ADR 0075 send classes)', () => {
  it('labels every accepted action class (no gaps)', () => {
    for (const ac of ACCEPTED_ACTION_CLASSES) {
      expect(ACTION_CLASS_LABEL[ac]).toBeTruthy()
    }
  })

  it('has distinct labels for the client and vendor send classes', () => {
    expect(ACTION_CLASS_LABEL['external_send_client']).toBe('Client send')
    expect(ACTION_CLASS_LABEL['external_send_vendor']).toBe('Records-vendor send')
  })
})
