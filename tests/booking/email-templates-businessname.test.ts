import { describe, it, expect } from 'vitest'
import {
  bookingRescheduledEmailHtml,
  bookingCancelledEmailHtml,
} from '../../src/lib/email/templates'

/**
 * The reschedule and cancel handlers do not have the business name on the
 * schedule row, so they pass businessName: ''. The templates must drop the
 * "for <business>" clause cleanly rather than render a dangling
 * "Your assessment call for  has moved." (observed in a live Resend preview
 * on 2026-06-30). When a business name IS present, it still renders.
 */

const rescheduleBase = {
  guestName: 'Scott Durgan',
  oldSlotLabel: 'Wednesday, July 1 at 11:00 AM (MST)',
  newSlotLabel: 'Wednesday, July 1 at 12:30 PM (MST)',
  meetUrl: 'https://zoom.us/j/4284801619',
  manageUrl: 'https://smd.services/book/manage?token=abc',
  meetingLabel: '30-minute intro call',
}

const cancelBase = {
  guestName: 'Scott Durgan',
  slotLabel: 'Wednesday, July 1 at 11:00 AM (MST)',
  rebookUrl: 'https://smd.services/book',
}

describe('booking email templates: empty business name renders cleanly', () => {
  it('reschedule with empty businessName has no dangling "for" clause', () => {
    const html = bookingRescheduledEmailHtml({ ...rescheduleBase, businessName: '' })
    expect(html).toContain('Your assessment call has moved.')
    expect(html).not.toMatch(/for\s*<\/strong>/)
    expect(html).not.toMatch(/call\s+for\s+has moved/)
  })

  it('reschedule with a businessName still renders the clause', () => {
    const html = bookingRescheduledEmailHtml({ ...rescheduleBase, businessName: 'Acme LLC' })
    expect(html).toContain('for <strong>Acme LLC</strong>')
  })

  it('cancel with empty businessName has no dangling "for" clause', () => {
    const html = bookingCancelledEmailHtml({ ...cancelBase, businessName: '' })
    expect(html).not.toMatch(/for\s*<\/strong>/)
    expect(html).not.toMatch(/call\s+for\s+scheduled/)
    expect(html).toContain('Your assessment call')
    expect(html).toContain('has been cancelled.')
  })

  it('cancel with a businessName still renders the clause', () => {
    const html = bookingCancelledEmailHtml({ ...cancelBase, businessName: 'Acme LLC' })
    expect(html).toContain('for <strong>Acme LLC</strong>')
  })
})
