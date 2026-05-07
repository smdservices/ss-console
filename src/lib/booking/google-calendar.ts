/**
 * Google Calendar API v3 client.
 *
 * Uses fetch() for all calls (Workers-compatible). Handles event CRUD,
 * free/busy queries, and access token refresh.
 *
 * Video call URLs are configured separately (see BOOKING_CONFIG.meeting_url).
 * Events store the assessment_id in `extendedProperties.private`.
 */

import { BOOKING_CONFIG } from './config.js'

const BASE_URL = 'https://www.googleapis.com/calendar/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarEventInput {
  summary: string
  description?: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  attendees?: { email: string; displayName?: string }[]
  assessmentId?: string
}

export interface CalendarEvent {
  id: string
  htmlLink: string
  summary: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
  status: string
}

export interface FreeBusySlot {
  start: string
  end: string
}

export interface TokenResponse {
  access_token: string
  expires_in: number
  token_type: string
  scope?: string
  refresh_token?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function googleFetch(
  url: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<Response> {
  const { google_call_timeout_ms } = BOOKING_CONFIG
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), google_call_timeout_ms)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
    return response
  } finally {
    clearTimeout(timeout)
  }
}

function buildEventBody(event: CalendarEventInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: event.summary,
    description: event.description,
    start: event.start,
    end: event.end,
  }

  if (event.attendees?.length) {
    body.attendees = event.attendees
  }

  if (event.assessmentId) {
    body.extendedProperties = {
      private: { assessment_id: event.assessmentId },
    }
  }

  return body
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Create a Google Calendar event.
 */
export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  event: CalendarEventInput
): Promise<CalendarEvent> {
  const url = `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all`
  const body = buildEventBody(event)

  const response = await googleFetch(url, accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Google Calendar create failed (${response.status}): ${text}`)
  }

  return await response.json()
}

/**
 * Update an existing Google Calendar event.
 */
export async function updateCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  event: Partial<CalendarEventInput>
): Promise<CalendarEvent> {
  const url = `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`

  const body: Record<string, unknown> = {}
  if (event.summary) body.summary = event.summary
  if (event.description !== undefined) body.description = event.description
  if (event.start) body.start = event.start
  if (event.end) body.end = event.end
  if (event.attendees) body.attendees = event.attendees
  if (event.assessmentId) {
    body.extendedProperties = {
      private: { assessment_id: event.assessmentId },
    }
  }

  const response = await googleFetch(url, accessToken, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Google Calendar update failed (${response.status}): ${text}`)
  }

  return await response.json()
}

/**
 * Delete (cancel) a Google Calendar event.
 */
export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const url = `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`

  const response = await googleFetch(url, accessToken, { method: 'DELETE' })

  if (!response.ok && response.status !== 410) {
    const text = await response.text()
    throw new Error(`Google Calendar delete failed (${response.status}): ${text}`)
  }
}

/**
 * Query free/busy data for slot availability.
 */
export async function getFreeBusy(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string
): Promise<FreeBusySlot[]> {
  const url = `${BASE_URL}/freeBusy`

  const response = await googleFetch(url, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Google Calendar freeBusy failed (${response.status}): ${text}`)
  }

  const data: { calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> } =
    await response.json()

  return data.calendars?.[calendarId]?.busy ?? []
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

/**
 * Refresh an expired access token using a refresh token.
 */
export async function refreshAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token refresh failed (${response.status}): ${text}`)
  }

  return await response.json()
}

// ---------------------------------------------------------------------------
// Token exchange (authorization code → tokens)
// ---------------------------------------------------------------------------

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeAuthCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token exchange failed (${response.status}): ${text}`)
  }

  return await response.json()
}
