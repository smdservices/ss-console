/**
 * Tests for the audit-log export formatters
 * (src/lib/portal/ai-employee/audit-export.ts), per issue #896.
 *
 * The formatters are pure functions: AuditEntry[] in, string out.
 * Export endpoints handle authorization + sourcing; this file proves
 * the on-disk shape downstream tooling depends on.
 */

import { describe, it, expect } from 'vitest'
import {
  AUDIT_CSV_COLUMNS,
  csvCell,
  exportFilename,
  renderAuditCsv,
  renderAuditJson,
} from '../src/lib/portal/ai-employee/audit-export'
import type { AuditEntry } from '../src/lib/portal/ai-employee/audit'

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: '01HX5N3K2A',
    ts: '2026-05-20T10:00:00.000Z',
    actor: 'person-1',
    actorRole: 'operator',
    action: 'DRAFT_CREATED',
    target: 'draft-9',
    decision: 'draft_for_review',
    reason: 'Routine intake follow-up.',
    skill: 'client-intake',
    matterRef: 'matter-1',
    ...overrides,
  }
}

describe('csvCell — RFC 4180 escaping', () => {
  it('returns null as empty string', () => {
    expect(csvCell(null)).toBe('')
  })

  it('returns plain values unquoted', () => {
    expect(csvCell('hello')).toBe('hello')
    expect(csvCell('DRAFT_CREATED')).toBe('DRAFT_CREATED')
  })

  it('wraps values containing commas in double quotes', () => {
    expect(csvCell('a, b')).toBe('"a, b"')
  })

  it('wraps values containing double quotes and doubles the quotes', () => {
    expect(csvCell('she said "yes"')).toBe('"she said ""yes"""')
  })

  it('wraps values containing CR or LF', () => {
    expect(csvCell('first\nsecond')).toBe('"first\nsecond"')
    expect(csvCell('first\r\nsecond')).toBe('"first\r\nsecond"')
  })
})

describe('renderAuditCsv — header + body', () => {
  it('emits the column header in the locked order', () => {
    const out = renderAuditCsv([])
    const firstLine = out.split('\r\n')[0]
    expect(firstLine).toBe(AUDIT_CSV_COLUMNS.join(','))
  })

  it('emits CRLF line endings per RFC 4180', () => {
    const out = renderAuditCsv([makeEntry()])
    // Two lines + trailing CRLF (header, row, terminator).
    expect(out.endsWith('\r\n')).toBe(true)
    expect(out.split('\r\n').length).toBeGreaterThanOrEqual(2)
  })

  it('renders an empty list as just the header row', () => {
    const out = renderAuditCsv([])
    expect(out).toBe(AUDIT_CSV_COLUMNS.join(',') + '\r\n')
  })

  it('preserves every field verbatim including nulls as empty cells', () => {
    const out = renderAuditCsv([
      makeEntry({ target: null, decision: null, reason: null, matterRef: null }),
    ])
    const lines = out.split('\r\n')
    const row = lines[1].split(',')
    // index of target / decision / reason / matterRef
    const idxTarget = AUDIT_CSV_COLUMNS.indexOf('target')
    const idxDecision = AUDIT_CSV_COLUMNS.indexOf('decision')
    const idxReason = AUDIT_CSV_COLUMNS.indexOf('reason')
    const idxMatter = AUDIT_CSV_COLUMNS.indexOf('matterRef')
    expect(row[idxTarget]).toBe('')
    expect(row[idxDecision]).toBe('')
    expect(row[idxReason]).toBe('')
    expect(row[idxMatter]).toBe('')
  })

  it('escapes a reason containing commas and quotes correctly', () => {
    const out = renderAuditCsv([makeEntry({ reason: 'first, then "second"' })])
    expect(out).toContain('"first, then ""second"""')
  })
})

describe('renderAuditJson — array shape', () => {
  it('emits an empty array for empty input', () => {
    expect(renderAuditJson([])).toBe('[]\n')
  })

  it('emits a plain array of AuditEntry — no envelope', () => {
    const out = renderAuditJson([makeEntry()])
    const parsed = JSON.parse(out)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed[0].id).toBe('01HX5N3K2A')
    expect(parsed[0].decision).toBe('draft_for_review')
  })

  it('round-trips nulls without fabricating placeholder strings', () => {
    const out = renderAuditJson([makeEntry({ reason: null, target: null })])
    const parsed = JSON.parse(out)
    expect(parsed[0].reason).toBeNull()
    expect(parsed[0].target).toBeNull()
  })
})

describe('exportFilename', () => {
  it('uses the supplied slug + extension', () => {
    const name = exportFilename('smith-pi-firm', 'csv', Date.parse('2026-05-20T12:34:56.000Z'))
    expect(name).toMatch(/^audit-smith-pi-firm-/)
    expect(name.endsWith('.csv')).toBe(true)
  })

  it('strips characters filesystems balk at', () => {
    const name = exportFilename('smith', 'json', Date.parse('2026-05-20T12:34:56.000Z'))
    expect(name).not.toContain(':')
    // The trailing Z is removed too so the timestamp segment is filesystem-safe.
    expect(name).not.toMatch(/Z\./)
  })
})
