import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parseBookingEmailFailure } from '../../src/lib/webhooks/booking-email-failure'
import type { ResendWebhookPayload } from '../../src/lib/webhooks/resend-handler'

/**
 * Unit coverage for the pure booking-email failure detector + a structural
 * guard that the booking-email wrappers tag their sends (so the webhook can
 * recognize them). The DB-touching orchestration is exercised end-to-end in
 * tests/resend-webhook.test.ts.
 */

describe('parseBookingEmailFailure', () => {
  it('returns null for a non-failure event', () => {
    const payload: ResendWebhookPayload = {
      type: 'email.delivered',
      data: { tags: { category: 'booking_confirmation' } },
    }
    expect(parseBookingEmailFailure(payload)).toBeNull()
  })

  it('returns null for a failure event whose category is not a booking email', () => {
    const payload: ResendWebhookPayload = {
      type: 'email.suppressed',
      data: { tags: { category: 'outreach' } },
    }
    expect(parseBookingEmailFailure(payload)).toBeNull()
  })

  it('returns null for a failure event with no tags', () => {
    const payload: ResendWebhookPayload = { type: 'email.bounced', data: {} }
    expect(parseBookingEmailFailure(payload)).toBeNull()
  })

  it('parses a suppressed booking confirmation, preferring suppressed.message', () => {
    const payload: ResendWebhookPayload = {
      type: 'email.suppressed',
      data: {
        to: ['scott@smd.services'],
        tags: { category: 'booking_confirmation', meeting_id: 'mtg-1' },
        suppressed: { message: 'on the suppression list', type: 'OnAccountSuppressionList' },
      },
    }
    expect(parseBookingEmailFailure(payload)).toMatchObject({
      eventType: 'email.suppressed',
      category: 'booking_confirmation',
      meetingId: 'mtg-1',
      recipient: 'scott@smd.services',
      reason: 'on the suppression list',
    })
  })

  it('parses a bounced booking reschedule, using bounce.message', () => {
    const payload: ResendWebhookPayload = {
      type: 'email.bounced',
      data: {
        to: ['a@b.com'],
        tags: { category: 'booking_reschedule', meeting_id: 'mtg-2' },
        bounce: { message: 'mailbox does not exist', type: 'Permanent' },
      },
    }
    expect(parseBookingEmailFailure(payload)).toMatchObject({
      category: 'booking_reschedule',
      meetingId: 'mtg-2',
      reason: 'mailbox does not exist',
    })
  })

  it('falls back to a default reason and null meetingId when detail is absent', () => {
    const payload: ResendWebhookPayload = {
      type: 'email.failed',
      data: { tags: { category: 'booking_cancellation' } },
    }
    const parsed = parseBookingEmailFailure(payload)
    expect(parsed?.reason).toBe('no reason provided')
    expect(parsed?.meetingId).toBeNull()
    expect(parsed?.recipient).toBeNull()
  })
})

describe('booking-email wrappers tag their sends', () => {
  const src = readFileSync(resolve('src/lib/email/booking-emails.ts'), 'utf-8')

  it('tags confirmation, reschedule, and cancellation with a booking category', () => {
    expect(src).toContain("'booking_confirmation'")
    expect(src).toContain("'booking_reschedule'")
    expect(src).toContain("'booking_cancellation'")
  })

  it('includes a meeting_id tag so the webhook can resolve the entity', () => {
    expect(src).toContain("name: 'meeting_id'")
  })
})
