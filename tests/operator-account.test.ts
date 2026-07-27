/**
 * Account surface (client-portal §5.9) — subscription + escalation projection.
 *
 * The defensive escalation parse and the honest subscription states are the
 * load-bearing pieces: §5.9 requires provisioning/paused to be honest status
 * surfaces (never fabricated controls), and escalation parses from an `unknown`
 * projection blob that must never produce a fabricated contact.
 */

import { describe, it, expect } from 'vitest'
import {
  parseEscalation,
  subscriptionStatusLabel,
  subscriptionStatusProse,
  type SubscriptionStatus,
} from '../src/lib/portal/operator/account-read'

describe('parseEscalation: defensive, never a fabricated contact', () => {
  it('parses a well-formed blob', () => {
    const e = parseEscalation({
      red_flag_recipients: ['partner@firm.com'],
      failure_recipients: ['ops@firm.com', 'principal@firm.com'],
      acknowledgement_window_minutes: 30,
    })
    expect(e.redFlagRecipients).toEqual(['partner@firm.com'])
    expect(e.failureRecipients).toHaveLength(2)
    expect(e.ackWindowMinutes).toBe(30)
  })

  it('drops non-string / blank recipients', () => {
    const e = parseEscalation({
      red_flag_recipients: ['a@firm.com', '', 42, null, '   '],
      failure_recipients: 'not-an-array',
    })
    expect(e.redFlagRecipients).toEqual(['a@firm.com'])
    expect(e.failureRecipients).toEqual([])
  })

  it('rejects non-positive / non-finite ack windows', () => {
    expect(parseEscalation({ acknowledgement_window_minutes: 0 }).ackWindowMinutes).toBeNull()
    expect(parseEscalation({ acknowledgement_window_minutes: -5 }).ackWindowMinutes).toBeNull()
    expect(parseEscalation({ acknowledgement_window_minutes: 'soon' }).ackWindowMinutes).toBeNull()
  })

  it('returns an empty view for null / non-object input', () => {
    for (const bad of [null, undefined, 'x', 7, []]) {
      const e = parseEscalation(bad)
      expect(e.redFlagRecipients).toEqual([])
      expect(e.failureRecipients).toEqual([])
      expect(e.ackWindowMinutes).toBeNull()
      expect(e.caseAlertRouting).toBeNull()
    }
  })

  it('parses case_alert_routing (#2004); unauthored or malformed resolves to null (= central)', () => {
    expect(
      parseEscalation({
        red_flag_recipients: ['a@firm.com'],
        failure_recipients: ['ops@smd.services'],
        case_alert_routing: { mode: 'matter_staff', fallback_recipients: ['admin@firm.com'] },
      }).caseAlertRouting
    ).toEqual({ mode: 'matter_staff', fallbackRecipients: ['admin@firm.com'] })

    expect(
      parseEscalation({ case_alert_routing: { mode: 'matter_staff' } }).caseAlertRouting
    ).toEqual({ mode: 'matter_staff', fallbackRecipients: [] })

    for (const bad of [undefined, null, 'matter_staff', { mode: 'per-matter' }, { mode: 42 }]) {
      expect(parseEscalation({ case_alert_routing: bad }).caseAlertRouting).toBeNull()
    }
  })
})

describe('subscription status display', () => {
  it('labels every known status and falls back to Unknown', () => {
    expect(subscriptionStatusLabel('provisioning')).toBe('Being set up')
    expect(subscriptionStatusLabel('active')).toBe('Active')
    expect(subscriptionStatusLabel('paused')).toBe('Paused')
    expect(subscriptionStatusLabel('unknown')).toBe('Unknown')
  })

  it('gives honest prose for each state (no fabricated controls)', () => {
    const statuses: SubscriptionStatus[] = ['provisioning', 'active', 'paused', 'unknown']
    for (const s of statuses) {
      expect(subscriptionStatusProse(s).length).toBeGreaterThan(0)
    }
    expect(subscriptionStatusProse('paused')).toMatch(/contact us/i)
  })
})
