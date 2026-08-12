/**
 * Core intake processing — shared between POST /api/intake (standalone) and
 * POST /api/booking/reserve (booking flow).
 *
 * Handles entity dedup, contact creation, optional meeting creation,
 * and context append. Callers decide what notifications to send.
 */

import { findOrCreateEntity, getEntity } from '../db/entities'
import { createContact } from '../db/contacts'
import { updateAssessment, getAssessment } from '../db/assessments'
import { createMeetingWithLegacyAssessment, ensureMeetingForAssessment } from '../db/meetings'
import { appendContext } from '../db/context'
import { EMAIL_IDENTITY_PREDICATE, normalizeEmail } from '../identity/email'
import { interestLabel } from './config'
import { attributionSummary, type AdAttribution } from '../marketing/attribution'

export interface IntakeInput {
  name: string
  email: string
  businessName: string
  phone?: string | null
  website?: string | null
  /**
   * Free-text "tell us about your business" content from the unified
   * intake's textarea. When non-empty, always written as a context row
   * so the consultant has the prospect's own words even when no
   * categorical fields were collected.
   *
   * Closes the silent-loss bug where the Book path would lose the
   * textarea content entirely if categorical fields were absent.
   */
  userMessage?: string | null
  vertical?: string | null
  employeeCount?: number | null
  yearsInBusiness?: number | null
  biggestChallenge?: string | null
  howHeard?: string | null
  /**
   * Productized SKU the prospect arrived inquiring about (e.g.
   * 'operator'). Set when /book is reached from a product-detail
   * marketing CTA. Stored in context metadata and surfaced in the
   * admin notification so sales can route the lead. Allowed values
   * are validated at the API boundary; this field accepts the
   * canonical code, not the display label.
   */
  interest?: string | null
  /**
   * First-touch ad-click attribution (enumerated utm_*, gclid, fbclid),
   * read server-side from the ss_attr cookie at the API boundary
   * (ADR 0066 launch gate 1, #1722). Stored in context metadata for
   * campaign attribution. INTERNAL-ONLY: never rendered on client-facing
   * surfaces — keep it out of intakeLines, which flow into the
   * guest-visible calendar event description.
   */
  attribution?: AdAttribution | null
}

/**
 * Optional pre-seeded identifiers produced by the admin "Send booking link"
 * flow (#467). When present, the intake bypasses entity dedup and reuses the
 * pre-created `scheduled` assessment row instead of creating a new one.
 */
export interface PreSeededIntake {
  entityId: string
  assessmentId: string
  meetingType?: string | null
  /**
   * When the admin identified a primary contact at send-link time, pass the
   * id here so we can reuse it rather than creating a duplicate contact when
   * the guest books with the same email.
   */
  contactId?: string | null
}

export interface IntakeResult {
  entityId: string
  contactId: string
  /**
   * Non-null only when scheduledAt was provided (booking flow).
   *
   * By construction meetings.id == assessments.id for the same booking —
   * the booking flow creates the meeting first and seeds the legacy
   * assessments row with the same primary key so live FKs
   * (quotes.assessment_id, assessment_schedule.assessment_id) continue to
   * resolve throughout the monitoring window.
   */
  assessmentId: string | null
  /** Same value as `assessmentId` — meetings are the new canonical entity. */
  meetingId: string | null
  /** Whether the entity was freshly created (vs. found by slug dedup). */
  entityCreated: boolean
  /** Whether this intake created a new contact row. */
  contactCreated: boolean
  /** Context row id for compensating rollback on booking failures. */
  contextId: string | null
  /** Whether this intake created a new legacy assessment row. */
  assessmentCreated: boolean
  /** Whether this intake created a new canonical meeting row. */
  meetingCreated: boolean
  /** Previous legacy assessment scheduled_at before any booking mutation. */
  previousAssessmentScheduledAt: string | null
  /** Previous canonical meeting scheduled_at before any booking mutation. */
  previousMeetingScheduledAt: string | null
  /** Formatted intake lines for use in admin notification emails. */
  intakeLines: string[]
}

export interface IntakeOptions {
  /** ISO 8601 UTC string. When provided a meeting is created with `scheduled_at` set (used by /reserve). */
  scheduledAt?: string | null
  /** Pipeline identifier for entity creation and context. Defaults to `'website_booking'`. */
  source?: string
  preSeeded?: PreSeededIntake | null
}

interface EntityResolution {
  entityId: string
  entityCreated: boolean
}
interface ContactResolution {
  contactId: string
  contactCreated: boolean
}
interface MeetingResolution {
  meetingId: string | null
  assessmentId: string | null
  assessmentCreated: boolean
  meetingCreated: boolean
  previousAssessmentScheduledAt: string | null
  previousMeetingScheduledAt: string | null
}

async function resolveEntity(
  db: D1Database,
  orgId: string,
  input: IntakeInput,
  pipeline: string,
  preSeeded: PreSeededIntake | null
): Promise<EntityResolution> {
  if (preSeeded?.entityId) {
    const entity = await getEntity(db, orgId, preSeeded.entityId)
    if (!entity)
      throw new Error(
        `Pre-seeded entity not found: ${preSeeded.entityId}. The booking link may reference a deleted entity.`
      )
    return { entityId: entity.id, entityCreated: false }
  }
  const { status, entity } = await findOrCreateEntity(db, orgId, {
    name: input.businessName,
    stage: 'prospect',
    source_pipeline: pipeline,
    phone: input.phone ?? null,
    website: input.website ?? null,
  })
  return { entityId: entity.id, entityCreated: status === 'created' }
}

async function resolveContact(
  db: D1Database,
  orgId: string,
  entityId: string,
  input: IntakeInput
): Promise<ContactResolution> {
  // Case-INSENSITIVE, and trimmed on the input side. `contacts.email` carries
  // no COLLATE NOCASE (migrations/0001_create_tables.sql:164), so an exact
  // comparison made `Owner@Example.com` and `owner@example.com` two different
  // people: the same prospect booking twice got a second contact row on the
  // same entity and a split correspondence history. Nobody types their own
  // address the same way twice. See src/lib/identity/email.ts.
  const existing = await db
    .prepare(`SELECT id FROM contacts WHERE org_id = ? AND ${EMAIL_IDENTITY_PREDICATE} LIMIT 1`)
    .bind(orgId, normalizeEmail(input.email))
    .first<{ id: string }>()
  if (existing) return { contactId: existing.id, contactCreated: false }
  const contact = await createContact(db, orgId, entityId, { name: input.name, email: input.email })
  return { contactId: contact.id, contactCreated: true }
}

async function resolveMeeting(
  db: D1Database,
  orgId: string,
  entityId: string,
  scheduledAt: string | null,
  preSeeded: PreSeededIntake | null
): Promise<MeetingResolution> {
  const none: MeetingResolution = {
    meetingId: null,
    assessmentId: null,
    assessmentCreated: false,
    meetingCreated: false,
    previousAssessmentScheduledAt: null,
    previousMeetingScheduledAt: null,
  }
  if (preSeeded?.assessmentId && scheduledAt) {
    const existing = await getAssessment(db, orgId, preSeeded.assessmentId)
    if (!existing)
      throw new Error(
        `Pre-seeded assessment not found: ${preSeeded.assessmentId}. The booking link may be stale.`
      )
    if (existing.entity_id !== entityId)
      throw new Error(
        `Pre-seeded assessment ${preSeeded.assessmentId} does not belong to entity ${entityId}.`
      )
    await updateAssessment(db, orgId, preSeeded.assessmentId, { scheduled_at: scheduledAt })
    const ensured = await ensureMeetingForAssessment(db, orgId, entityId, {
      assessmentId: preSeeded.assessmentId,
      scheduled_at: scheduledAt,
      meeting_type: preSeeded.meetingType,
    })
    return {
      meetingId: ensured.meeting.id,
      assessmentId: preSeeded.assessmentId,
      assessmentCreated: false,
      meetingCreated: ensured.created,
      previousAssessmentScheduledAt: existing.scheduled_at,
      previousMeetingScheduledAt: ensured.previousScheduledAt,
    }
  }
  if (scheduledAt) {
    const meeting = await createMeetingWithLegacyAssessment(db, orgId, entityId, {
      scheduled_at: scheduledAt,
      meeting_type: 'assessment',
    })
    return {
      ...none,
      meetingId: meeting.id,
      assessmentId: meeting.id,
      assessmentCreated: true,
      meetingCreated: true,
    }
  }
  return none
}

function buildIntakeLines(input: IntakeInput): string[] {
  const lines: string[] = []
  if (input.interest) {
    lines.push(`Inquiring about: ${interestLabel(input.interest)}`)
  }
  if (input.vertical) lines.push(`Vertical: ${input.vertical}`)
  if (input.employeeCount) lines.push(`Employees: ${input.employeeCount}`)
  if (input.yearsInBusiness) lines.push(`Years in business: ${input.yearsInBusiness}`)
  if (input.biggestChallenge)
    lines.push(`What they're trying to accomplish: ${input.biggestChallenge}`)
  if (input.howHeard) lines.push(`How they found us: ${input.howHeard}`)
  return lines
}

/**
 * Append the intake context row: the prospect's own words, the categorical
 * intake lines, and (in metadata) the first-touch ad attribution. Returns
 * the context row id, or null when there is nothing to write.
 */
async function appendIntakeContext(
  db: D1Database,
  orgId: string,
  args: { entityId: string; input: IntakeInput; intakeLines: string[]; pipeline: string }
): Promise<string | null> {
  const { entityId, input, intakeLines, pipeline } = args
  const trimmedMessage = input.userMessage?.trim() ?? ''
  const contentParts: string[] = []
  if (trimmedMessage) contentParts.push(trimmedMessage)
  if (intakeLines.length > 0) contentParts.push(intakeLines.join('\n'))

  // Attribution must not be silently dropped when the submission carries no
  // other content (e.g. the V4 booking path sends only name/email/slot): an
  // admin-facing summary line makes the context row exist so the metadata
  // is persisted. Deliberately NOT part of intakeLines — those are rendered
  // into the guest-visible calendar event description.
  const attribution = input.attribution ?? null
  if (attribution && contentParts.length === 0) {
    const summary = attributionSummary(attribution)
    if (summary) contentParts.push(`Ad attribution: ${summary}`)
  }

  if (contentParts.length === 0) return null

  const contextEntry = await appendContext(db, orgId, {
    entity_id: entityId,
    type: 'intake',
    content: contentParts.join('\n\n'),
    source: pipeline,
    metadata: {
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      website: input.website ?? null,
      user_message: trimmedMessage || null,
      vertical: input.vertical,
      employee_count: input.employeeCount,
      years_in_business: input.yearsInBusiness,
      biggest_challenge: input.biggestChallenge,
      how_heard: input.howHeard,
      interest: input.interest,
      attribution,
    },
  })
  return contextEntry.id
}

/**
 * Process an intake submission: find-or-create entity, create contact (if
 * new email), create meeting, and append intake context.
 *
 * Does NOT send any emails — the caller decides what notifications to fire.
 */
export async function processIntakeSubmission(
  db: D1Database,
  orgId: string,
  input: IntakeInput,
  opts?: IntakeOptions | null
): Promise<IntakeResult> {
  const scheduledAt = opts?.scheduledAt ?? null
  const preSeeded = opts?.preSeeded ?? null
  const pipeline = opts?.source ?? 'website_booking'

  const { entityId, entityCreated } = await resolveEntity(db, orgId, input, pipeline, preSeeded)
  const { contactId, contactCreated } = await resolveContact(db, orgId, entityId, input)
  const meetingRes = await resolveMeeting(db, orgId, entityId, scheduledAt, preSeeded)

  const intakeLines = buildIntakeLines(input)
  const contextId = await appendIntakeContext(db, orgId, { entityId, input, intakeLines, pipeline })

  return {
    entityId,
    contactId,
    assessmentId: meetingRes.assessmentId,
    meetingId: meetingRes.meetingId,
    entityCreated,
    contactCreated,
    contextId,
    assessmentCreated: meetingRes.assessmentCreated,
    meetingCreated: meetingRes.meetingCreated,
    previousAssessmentScheduledAt: meetingRes.previousAssessmentScheduledAt,
    previousMeetingScheduledAt: meetingRes.previousMeetingScheduledAt,
    intakeLines,
  }
}
