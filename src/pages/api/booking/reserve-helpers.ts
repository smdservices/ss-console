/**
 * Pure utility functions and Google Calendar event creation for the booking
 * reserve endpoint. Extracted to keep reserve.ts within the 500-line ceiling.
 */

import { formatInTimeZone } from 'date-fns-tz'
import { BOOKING_CONFIG } from '../../../lib/booking/config'

// ---------------------------------------------------------------------------
// Google Calendar event creation
// ---------------------------------------------------------------------------

export interface CreateEventParams {
  summary: string
  description: string
  startUtc: string
  endUtc: string
  guestEmail: string
  assessmentId: string
}

export interface CreateEventResult {
  eventId: string
  htmlLink: string | null
}

export async function createGoogleCalendarEvent(
  accessToken: string,
  calendarId: string,
  params: CreateEventParams
): Promise<CreateEventResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), BOOKING_CONFIG.google_call_timeout_ms)
  try {
    const gcalUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`
    const response = await fetch(gcalUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: params.summary,
        description: params.description,
        start: { dateTime: params.startUtc, timeZone: 'UTC' },
        end: { dateTime: params.endUtc, timeZone: 'UTC' },
        attendees: [{ email: params.guestEmail }],
        extendedProperties: { private: { assessmentId: params.assessmentId } },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 60 },
            { method: 'popup', minutes: 15 },
          ],
        },
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Google Calendar API ${response.status}: ${body}`)
    }
    const raw: unknown = await response.json()
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const eventId = typeof obj.id === 'string' ? obj.id : ''
    const htmlLink = typeof obj.htmlLink === 'string' ? obj.htmlLink : null
    return { eventId, htmlLink }
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildEventDescription(
  name: string,
  email: string,
  businessName: string,
  intakeLines: string[]
): string {
  const lines = [`Guest: ${name} <${email}>`, `Business: ${businessName}`]
  if (intakeLines.length > 0) {
    lines.push('', '--- Intake ---', ...intakeLines)
  }
  return lines.join('\n')
}

export function formatSlotLabelLong(slotStartUtc: string, tz: string): string {
  return formatInTimeZone(new Date(slotStartUtc), tz, "EEEE, MMMM d 'at' h:mm a (zzz)")
}

export function trimString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseOptionalInt(value: unknown): number | null {
  if (typeof value === 'number') return Math.floor(value)
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10)
    return isNaN(parsed) ? null : parsed
  }
  return null
}

export function isValidEmail(email: string): boolean {
  if (email.length > 254) return false
  const parts = email.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts
  if (!local || !domain) return false
  if (domain.indexOf('.') === -1) return false
  return true
}

export function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
