import { describe, it, expect } from 'vitest'
import {
  buildGovernanceFloorRows,
  parseScope,
  parseBusinessHours,
  formatCeiling,
  ACTION_CLASS_LABEL,
} from '../src/lib/portal/operator/configure'
import { ACCEPTED_ACTION_CLASSES } from '../src/lib/operator/customer-yaml/types'

describe('buildGovernanceFloorRows (action-class model)', () => {
  it('returns one row per action class, in canonical order', () => {
    const rows = buildGovernanceFloorRows('law-firm')
    expect(rows.map((r) => r.actionClass)).toEqual([...ACCEPTED_ACTION_CLASSES])
    expect(rows.every((r) => r.label === ACTION_CLASS_LABEL[r.actionClass])).toBe(true)
  })

  it('surfaces the law-firm external_send floor (draft_for_review), the others null', () => {
    const byClass = Object.fromEntries(
      buildGovernanceFloorRows('law-firm').map((r) => [r.actionClass, r.floor])
    )
    expect(byClass['external_send']).toBe('draft_for_review')
    expect(byClass['read']).toBeNull()
    expect(byClass['destructive']).toBeNull()
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
    })
    expect(parseScope(null)).toBeNull()
    expect(parseScope('nope')).toBeNull()
  })
  it('drops non-string entries from arrays', () => {
    const s = parseScope({ email_folders_visible: ['Inbox', 3, null, 'Sent'] })
    expect(s?.email_folders_visible).toEqual(['Inbox', 'Sent'])
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
  it('labels every ceiling', () => {
    expect(formatCeiling('autonomous')).toBe('Autonomous')
    expect(formatCeiling('draft_for_review')).toBe('Draft for review')
    expect(formatCeiling('refused')).toBe('Refused')
  })
})
