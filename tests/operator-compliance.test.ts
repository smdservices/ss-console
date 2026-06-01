/**
 * Tests for the Compliance dashboard view resolver
 * (src/lib/portal/operator/compliance.ts) and the friendly retention
 * formatter, per issue #895.
 *
 * The resolver is pure: no DB calls, no mocks needed. We exercise the
 * three branches:
 *
 *   - compliance_enabled = false → view.enabled = false (the page
 *     renders the "not enabled" empty state)
 *   - compliance_enabled = true + vertical known → retention posture
 *     resolves from VERTICAL_AUDIT_LOG_DAYS_DEFAULTS
 *   - vertical unknown → retention = null (page renders honest empty
 *     state rather than fabricating a default)
 *
 * Override behavior is exercised separately — the resolver layers the
 * override on top of the vertical default.
 */

import { describe, it, expect } from 'vitest'
import { resolveComplianceView, formatRetentionWindow } from '../src/lib/portal/operator/compliance'

describe('resolveComplianceView (#895)', () => {
  it('disables the view when compliance_enabled is false', () => {
    const view = resolveComplianceView({
      complianceEnabled: false,
      vertical: 'law-firm',
      auditLogDaysOverride: null,
      callerRoles: ['compliance'],
    })
    expect(view.enabled).toBe(false)
  })

  it('enables the view when compliance_enabled is true', () => {
    const view = resolveComplianceView({
      complianceEnabled: true,
      vertical: 'law-firm',
      auditLogDaysOverride: null,
      callerRoles: ['compliance'],
    })
    expect(view.enabled).toBe(true)
  })

  it('resolves the law-firm default retention (7 years) when no override', () => {
    const view = resolveComplianceView({
      complianceEnabled: true,
      vertical: 'law-firm',
      auditLogDaysOverride: null,
      callerRoles: ['compliance'],
    })
    expect(view.retention).not.toBeNull()
    expect(view.retention?.vertical).toBe('law-firm')
    expect(view.retention?.defaultDays).toBe(2555)
    expect(view.retention?.overrideDays).toBeNull()
    expect(view.retention?.effectiveDays).toBe(2555)
  })

  it('resolves the marketing-agency default retention (3 years) when no override', () => {
    const view = resolveComplianceView({
      complianceEnabled: true,
      vertical: 'marketing-agency',
      auditLogDaysOverride: null,
      callerRoles: ['compliance'],
    })
    expect(view.retention?.defaultDays).toBe(1095)
    expect(view.retention?.effectiveDays).toBe(1095)
  })

  it('layers the override on top of the vertical default', () => {
    const view = resolveComplianceView({
      complianceEnabled: true,
      vertical: 'law-firm',
      auditLogDaysOverride: 3650,
      callerRoles: ['compliance'],
    })
    expect(view.retention?.defaultDays).toBe(2555)
    expect(view.retention?.overrideDays).toBe(3650)
    expect(view.retention?.effectiveDays).toBe(3650)
  })

  it('treats a zero override as "no override" rather than zero retention', () => {
    const view = resolveComplianceView({
      complianceEnabled: true,
      vertical: 'law-firm',
      auditLogDaysOverride: 0,
      callerRoles: ['compliance'],
    })
    expect(view.retention?.overrideDays).toBeNull()
    expect(view.retention?.effectiveDays).toBe(2555)
  })

  it('returns retention=null when vertical is not on file', () => {
    const view = resolveComplianceView({
      complianceEnabled: true,
      vertical: null,
      auditLogDaysOverride: null,
      callerRoles: ['compliance'],
    })
    expect(view.retention).toBeNull()
  })

  it('echoes caller roles for the view to render the principal banner', () => {
    const view = resolveComplianceView({
      complianceEnabled: true,
      vertical: 'law-firm',
      auditLogDaysOverride: null,
      callerRoles: ['principal'],
    })
    expect(view.callerRoles).toEqual(['principal'])
  })
})

describe('formatRetentionWindow (#895)', () => {
  it('uses days for sub-year windows', () => {
    expect(formatRetentionWindow(30)).toBe('30 days')
    expect(formatRetentionWindow(364)).toBe('364 days')
  })

  it('shows exact years when the day count divides cleanly', () => {
    expect(formatRetentionWindow(365)).toBe('365 days (1 year)')
    expect(formatRetentionWindow(730)).toBe('730 days (2 years)')
    expect(formatRetentionWindow(2555)).toBe('2555 days (7 years)')
    expect(formatRetentionWindow(1095)).toBe('1095 days (3 years)')
    expect(formatRetentionWindow(3650)).toBe('3650 days (10 years)')
  })

  it('shows approximate years for day counts that do not divide cleanly', () => {
    expect(formatRetentionWindow(400)).toMatch(/^400 days \(about 1 year\)$/)
    expect(formatRetentionWindow(800)).toMatch(/^800 days \(about 2 years\)$/)
  })
})
