import type { APIContext, APIRoute } from 'astro'
import { ORG_ID } from '../../../lib/constants'
import { BOOKING_CONFIG } from '../../../lib/booking/config'
import { rateLimitByIp } from '../../../lib/booking/rate-limit'
import { acquireHold, releaseHold } from '../../../lib/booking/holds'
import {
  generateManageToken,
  hashManageToken,
  computeManageTokenExpiry,
} from '../../../lib/booking/tokens'
import { buildIcs, icsToBase64 } from '../../../lib/booking/ics'
import { processIntakeSubmission, type PreSeededIntake } from '../../../lib/booking/intake-core'
import { rollbackFailedBooking } from '../../../lib/booking/rollback'
import { createScheduleStatement, updateScheduleGoogleSync } from '../../../lib/booking/schedule'
import { verifyBookingLink } from '../../../lib/booking/signed-link'
import {
  createMeetingScheduleStatement,
  updateMeetingScheduleGoogleSync,
} from '../../../lib/booking/meeting-schedule'
import { getIntegration, getGoogleAccessToken } from '../../../lib/db/integrations'
import { transitionStage } from '../../../lib/db/entities'
import { sendEmail } from '../../../lib/email/resend'
import {
  bookingConfirmationEmailHtml,
  bookingAdminNotificationEmailHtml,
} from '../../../lib/email/templates'
import { requireAppBaseUrl, buildAdminUrl } from '../../../lib/config/app-url'
import { env } from 'cloudflare:workers'
import {
  createGoogleCalendarEvent,
  buildEventDescription,
  formatSlotLabelLong,
  trimString,
  parseOptionalInt,
  isValidEmail,
  jsonResponse,
} from './reserve-helpers'

const FALLBACK_EMAIL = 'team@smd.services'
const NOTIFY_EMAIL = 'team@smd.services'

/**
 * POST /api/booking/reserve
 *
 * Atomic 3-phase booking flow:
 *   1. Preflight  — rate limit, input validation
 *   2. DB commit  — Intake + schedule sidecars + hold + token
 *   3. Google sync — Create calendar event; compensating rollback on failure
 *   4. Post-commit — Promote stage, send confirmation email with ICS
 *
 * Google event creation failure = booking failure. No silent fallback.
 */

interface ValidatedInput {
  name: string
  email: string
  businessName: string
  phone: string | null
  slotStartUtc: string
  slotEndUtc: string
  website: string | null
  userMessage: string | null
  vertical: string | null
  employeeCount: number | null
  yearsInBusiness: number | null
  biggestChallenge: string | null
  howHeard: string | null
  guestTimezone: string | null
  prefillTokenRaw: string | null
}

function validateSlotTiming(slotStartUtc: string): { slotEndUtc: string } | Response {
  const slotStart = new Date(slotStartUtc)
  if (isNaN(slotStart.getTime())) {
    return jsonResponse(400, { error: 'validation_failed', message: 'Invalid slot_start_utc' })
  }
  const earliest = Date.now() + BOOKING_CONFIG.min_notice_minutes * 60_000
  if (slotStart.getTime() < earliest) {
    return jsonResponse(400, {
      error: 'slot_unavailable',
      message: 'This slot is no longer available. Please choose a later time.',
    })
  }
  return {
    slotEndUtc: new Date(slotStart.getTime() + BOOKING_CONFIG.slot_minutes * 60_000).toISOString(),
  }
}

function validateReserveInput(body: Record<string, unknown>): ValidatedInput | Response {
  const name = trimString(body.name)
  const email = trimString(body.email)
  const businessName = trimString(body.business_name)
  const phone = trimString(body.phone)
  const slotStartUtc = trimString(body.slot_start_utc)

  if (!name || !email || !businessName || !slotStartUtc) {
    return jsonResponse(400, {
      error: 'validation_failed',
      message: 'name, email, business_name, and slot_start_utc are required',
    })
  }

  // Phone is required for new website-driven bookings (the unified intake
  // collects it). Admin "Send booking link" flow may still come through
  // without phone — those carry a prefill_token and we don't want to break
  // pre-existing booking-link campaigns.
  if (!phone && !body.prefill_token) {
    return jsonResponse(400, {
      error: 'validation_failed',
      message: 'Phone is required.',
      field_errors: { phone: 'Phone is required.' },
    })
  }

  if (!isValidEmail(email)) {
    return jsonResponse(400, { error: 'validation_failed', message: 'Invalid email address' })
  }

  const slotTiming = validateSlotTiming(slotStartUtc)
  if (slotTiming instanceof Response) return slotTiming

  return {
    name,
    email,
    businessName,
    phone,
    slotStartUtc,
    slotEndUtc: slotTiming.slotEndUtc,
    website: trimString(body.website) || null,
    userMessage: typeof body.message === 'string' ? body.message.trim() : null,
    vertical: trimString(body.vertical) || null,
    employeeCount: parseOptionalInt(body.employee_count),
    yearsInBusiness: parseOptionalInt(body.years_in_business),
    biggestChallenge: trimString(body.biggest_challenge) || null,
    howHeard: trimString(body.how_heard) || null,
    guestTimezone: trimString(body.timezone) || null,
    prefillTokenRaw: trimString(body.prefill_token),
  }
}

async function resolvePreSeeded(prefillTokenRaw: string | null): Promise<PreSeededIntake | null> {
  if (!prefillTokenRaw) return null
  const verify = await verifyBookingLink(prefillTokenRaw)
  if (verify.ok) {
    return {
      entityId: verify.payload.entity_id,
      assessmentId: verify.payload.assessment_id,
      meetingType: verify.payload.meeting_type,
      contactId: verify.payload.contact_id,
    }
  }
  console.warn(
    `[api/booking/reserve] prefill token rejected: ${verify.error}; falling back to standard flow`
  )
  return null
}

function calendarUnavailableJson(): Response {
  return jsonResponse(503, {
    error: 'calendar_unavailable',
    message: 'Online booking is temporarily unavailable.',
    fallback: {
      type: 'email',
      email: FALLBACK_EMAIL,
      message: `Please email ${FALLBACK_EMAIL} to schedule your call.`,
    },
  })
}

interface DbCommitArgs {
  input: ValidatedInput
  preSeeded: PreSeededIntake | null
}

interface DbCommitResult {
  assessmentId: string
  meetingId: string
  entityId: string
  scheduleId: string
  meetingScheduleId: string
  manageToken: string
  intakeLines: string[]
  entityCreated: boolean
  contactCreated: boolean
  contactId: string | undefined
  contextId: string | null
  previousAssessmentScheduledAt: string | null
  previousMeetingScheduledAt: string | null
}

interface SidecarParams {
  assessmentId: string
  meetingId: string
  name: string
  email: string
  slotStartUtc: string
  slotEndUtc: string
  guestTimezone: string | null
  manageTokenHash: string
  manageTokenExpiresAt: string
}

async function seedScheduleSidecars(
  a: SidecarParams
): Promise<{ scheduleId: string; meetingScheduleId: string }> {
  // Both are seeded during the monitoring window so existing manage-token
  // consumers continue to resolve whichever table they query.
  // When the drop migration lands the legacy assessment_schedule write goes away.
  const common = {
    orgId: ORG_ID,
    slotStartUtc: a.slotStartUtc,
    slotEndUtc: a.slotEndUtc,
    durationMinutes: BOOKING_CONFIG.slot_minutes,
    timezone: BOOKING_CONFIG.consultant.timezone,
    guestTimezone: a.guestTimezone,
    guestName: a.name,
    guestEmail: a.email,
    manageTokenHash: a.manageTokenHash,
    manageTokenExpiresAt: a.manageTokenExpiresAt,
  }
  const { statement: scheduleStmt, id: scheduleId } = createScheduleStatement(env.DB, {
    assessmentId: a.assessmentId,
    ...common,
  })
  await scheduleStmt.run()

  const { statement: meetingScheduleStmt, id: meetingScheduleId } = createMeetingScheduleStatement(
    env.DB,
    { meetingId: a.meetingId, ...common }
  )
  await meetingScheduleStmt.run()

  return { scheduleId, meetingScheduleId }
}

async function commitBookingToDb(args: DbCommitArgs): Promise<DbCommitResult> {
  const { input, preSeeded } = args
  const {
    name,
    email,
    businessName,
    phone,
    slotStartUtc,
    slotEndUtc,
    website,
    userMessage,
    vertical,
    employeeCount,
    yearsInBusiness,
    biggestChallenge,
    howHeard,
    guestTimezone,
  } = input

  const intakeResult = await processIntakeSubmission(
    env.DB,
    ORG_ID,
    {
      name,
      email,
      businessName,
      phone,
      website,
      userMessage,
      vertical,
      employeeCount,
      yearsInBusiness,
      biggestChallenge,
      howHeard,
    },
    {
      scheduledAt: slotStartUtc,
      source: preSeeded ? 'admin_booking_link' : 'website_intake_booking',
      preSeeded,
    }
  )

  // assessmentId is guaranteed non-null when scheduledAt is provided.
  // By intake-core construction, assessmentId == meetingId — the booking
  // flow seeds both tables with the same primary key during the
  // monitoring window (see src/lib/booking/intake-core.ts).
  const assessmentId = intakeResult.assessmentId!
  const meetingId = intakeResult.meetingId!

  const manageToken = generateManageToken()
  const manageTokenHash = await hashManageToken(manageToken)
  const manageTokenExpiresAt = computeManageTokenExpiry(
    slotEndUtc,
    BOOKING_CONFIG.manage_token_ttl_hours_after_slot
  )

  // Create assessment_schedule (legacy) and meeting_schedule (canonical) sidecars.
  const { scheduleId, meetingScheduleId } = await seedScheduleSidecars({
    assessmentId,
    meetingId,
    name,
    email,
    slotStartUtc,
    slotEndUtc,
    guestTimezone,
    manageTokenHash,
    manageTokenExpiresAt,
  })

  return {
    assessmentId,
    meetingId,
    entityId: intakeResult.entityId,
    scheduleId,
    meetingScheduleId,
    manageToken,
    intakeLines: intakeResult.intakeLines,
    entityCreated: intakeResult.entityCreated,
    contactCreated: intakeResult.contactCreated,
    contactId: intakeResult.contactId,
    contextId: intakeResult.contextId,
    previousAssessmentScheduledAt: intakeResult.previousAssessmentScheduledAt,
    previousMeetingScheduledAt: intakeResult.previousMeetingScheduledAt,
  }
}

interface GoogleSyncArgs {
  accessToken: string
  calendarId: string
  input: ValidatedInput
  dbResult: DbCommitResult
  holdId: string
  preSeeded: PreSeededIntake | null
}

async function syncGoogleCalendarAndPromote(args: GoogleSyncArgs): Promise<string | Response> {
  const { accessToken, calendarId, input, dbResult, holdId, preSeeded } = args
  const { name, email, businessName, slotStartUtc, slotEndUtc } = input
  // prettier-ignore
  const { assessmentId, meetingId, entityId, scheduleId, meetingScheduleId, entityCreated, contactCreated, contactId, contextId, previousAssessmentScheduledAt, previousMeetingScheduledAt } = dbResult

  const meetUrl = BOOKING_CONFIG.meeting_url

  try {
    const eventResult = await createGoogleCalendarEvent(accessToken, calendarId, {
      summary: `Assessment: ${businessName} (${name})`,
      description: buildEventDescription(name, email, businessName, dbResult.intakeLines),
      startUtc: slotStartUtc,
      endUtc: slotEndUtc,
      guestEmail: email,
      assessmentId,
    })

    // Update both schedules with Google sync data (dual-write during monitoring window).
    const syncData = {
      googleEventId: eventResult.eventId,
      googleEventLink: eventResult.htmlLink,
      googleMeetUrl: meetUrl,
    }
    await updateScheduleGoogleSync(env.DB, scheduleId, syncData)
    await updateMeetingScheduleGoogleSync(env.DB, meetingScheduleId, syncData)

    // Promote entity only after Google sync — prevents false "meeting scheduled" CRM state.
    try {
      await transitionStage(
        env.DB,
        ORG_ID,
        entityId,
        'meetings',
        'Booking reserve: meeting scheduled'
      )
    } catch {
      // Entity may already be past prospect. Do not fail the booking.
    }

    return meetUrl
  } catch (err) {
    console.error('[api/booking/reserve] Google Calendar event creation failed:', err)
    try {
      await rollbackFailedBooking(env.DB, {
        orgId: ORG_ID,
        holdId,
        scheduleId,
        meetingScheduleId,
        assessmentId,
        meetingId,
        preserveBookingRows: Boolean(preSeeded),
        previousAssessmentScheduledAt,
        previousMeetingScheduledAt,
        entityId,
        entityCreated,
        contactId,
        contactCreated,
        contextId,
      })
    } catch (rollbackErr) {
      console.error('[api/booking/reserve] Rollback failed:', rollbackErr)
    }
    return jsonResponse(503, {
      error: 'calendar_sync_failed',
      message: 'We could not create the calendar event. Please try again or email us directly.',
      fallback: {
        type: 'email',
        email: FALLBACK_EMAIL,
        message: `Please email ${FALLBACK_EMAIL} to schedule your call.`,
      },
    })
  }
}

interface SendConfirmationArgs {
  input: ValidatedInput
  dbResult: DbCommitResult
  googleMeetUrl: string
  manageUrl: string
}

async function sendConfirmationEmails(args: SendConfirmationArgs): Promise<void> {
  const { input, dbResult, googleMeetUrl, manageUrl } = args
  const { name, email, businessName, slotStartUtc, guestTimezone } = input
  const { scheduleId, intakeLines, entityId } = dbResult

  const displayTz = guestTimezone || BOOKING_CONFIG.consultant.timezone
  const slotLabel = formatSlotLabelLong(slotStartUtc, displayTz)
  const consultantTzLabel = formatSlotLabelLong(slotStartUtc, BOOKING_CONFIG.consultant.timezone)

  let icsAttachment: { filename: string; content: string; content_type: string } | null = null
  try {
    const icsResult = buildIcs({
      scheduleId,
      sequence: 0,
      method: 'REQUEST',
      startUtc: slotStartUtc,
      durationMinutes: BOOKING_CONFIG.slot_minutes,
      title: `${BOOKING_CONFIG.meeting_label} — SMD Services`,
      description: `Assessment call with SMD Services for ${businessName}.\n\nManage your booking: ${manageUrl}`,
      location: googleMeetUrl,
      organizerName: BOOKING_CONFIG.consultant.name,
      organizerEmail: BOOKING_CONFIG.consultant.email,
      guestName: name,
      guestEmail: email,
    })
    icsAttachment = {
      filename: 'invite.ics',
      content: icsToBase64(icsResult.ics),
      content_type: icsResult.contentType,
    }
  } catch (icsErr) {
    console.error('[api/booking/reserve] ICS generation failed:', icsErr)
  }

  try {
    const confirmationHtml = bookingConfirmationEmailHtml({
      guestName: name,
      businessName,
      slotLabel,
      meetUrl: googleMeetUrl,
      manageUrl,
      meetingLabel: BOOKING_CONFIG.meeting_label,
    })
    await sendEmail(env.RESEND_API_KEY, {
      to: email,
      subject: `Confirmed: ${BOOKING_CONFIG.meeting_label} with SMD Services`,
      html: confirmationHtml,
      ...(icsAttachment ? { attachments: [icsAttachment] } : {}),
    })
  } catch (emailErr) {
    console.error('[api/booking/reserve] Confirmation email failed:', emailErr)
  }

  try {
    const adminHtml = bookingAdminNotificationEmailHtml({
      guestName: name,
      guestEmail: email,
      businessName,
      slotLabel: consultantTzLabel,
      intakeLines,
      entityAdminUrl: buildAdminUrl(env, `/admin/entities/${entityId}`),
    })
    await sendEmail(env.RESEND_API_KEY, {
      to: NOTIFY_EMAIL,
      reply_to: email,
      subject: `New booking: ${businessName} — ${consultantTzLabel}`,
      html: adminHtml,
    })
  } catch (emailErr) {
    console.error('[api/booking/reserve] Admin notification email failed:', emailErr)
  }
}

async function handlePost({ request }: APIContext): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' })
  }

  // Phase 1a: IP rate limiting
  const clientIp = request.headers.get('cf-connecting-ip') ?? undefined
  const rateLimitResult = await rateLimitByIp(env.BOOKING_CACHE, 'reserve', clientIp)
  if (!rateLimitResult.allowed) {
    return jsonResponse(429, {
      error: 'rate_limited',
      message: 'Too many booking attempts. Please try again later.',
    })
  }

  // Phase 1b: Input validation
  const validated = validateReserveInput(body)
  if (validated instanceof Response) return validated

  // Optional prefill token (admin "Send booking link" flow — #467).
  // Invalid/expired tokens fall back to standard flow silently.
  const preSeeded = await resolvePreSeeded(validated.prefillTokenRaw)

  // Phase 1c: Verify Google integration before doing any DB work
  const integration = await getIntegration(env.DB, ORG_ID, 'google_calendar')
  if (!integration) return calendarUnavailableJson()

  const accessToken = await getGoogleAccessToken(env.DB, integration, env)
  if (!accessToken) return calendarUnavailableJson()

  // Phase 2: DB commit
  const holdResult = await acquireHold(env.DB, ORG_ID, validated.slotStartUtc, validated.email)
  if (!holdResult.acquired) {
    return jsonResponse(409, {
      error: 'slot_taken',
      message: 'This time slot was just taken. Please choose another time.',
    })
  }

  let dbResult: DbCommitResult
  try {
    dbResult = await commitBookingToDb({ input: validated, preSeeded })
  } catch (err) {
    console.error('[api/booking/reserve] DB commit failed:', err)
    await releaseHold(env.DB, holdResult.id!)
    return jsonResponse(500, { error: 'Internal server error' })
  }

  // Phase 3: Google Calendar sync + entity stage promotion
  const calendarId = integration.calendar_id || BOOKING_CONFIG.consultant.calendar_id
  const googleSyncResult = await syncGoogleCalendarAndPromote({
    accessToken,
    calendarId,
    input: validated,
    dbResult,
    holdId: holdResult.id!,
    preSeeded,
  })
  if (googleSyncResult instanceof Response) return googleSyncResult
  const googleMeetUrl = googleSyncResult

  // Release the hold — the live assessment row is now the lock
  await releaseHold(env.DB, holdResult.id!)

  const { slotStartUtc, slotEndUtc, guestTimezone } = validated
  const { assessmentId, meetingId, scheduleId, meetingScheduleId, manageToken } = dbResult
  const displayTz = guestTimezone || BOOKING_CONFIG.consultant.timezone

  let appBaseUrl: string
  try {
    appBaseUrl = requireAppBaseUrl(env)
  } catch {
    appBaseUrl = 'https://smd.services'
  }
  const manageUrl = `${appBaseUrl}/book/manage?token=${manageToken}`

  // Phase 4: Confirmation emails (best-effort)
  await sendConfirmationEmails({ input: validated, dbResult, googleMeetUrl, manageUrl })

  return jsonResponse(201, {
    ok: true,
    // assessment_id and meeting_id are equal by construction during the
    // monitoring window — callers can use either. New code should prefer meeting_id.
    assessment_id: assessmentId,
    meeting_id: meetingId,
    schedule_id: scheduleId,
    meeting_schedule_id: meetingScheduleId,
    slot_start_utc: slotStartUtc,
    slot_end_utc: slotEndUtc,
    slot_label: formatSlotLabelLong(slotStartUtc, displayTz),
    meet_url: googleMeetUrl,
    manage_url: manageUrl,
  })
}

export const POST: APIRoute = (ctx) => handlePost(ctx)

// ---------------------------------------------------------------------------
