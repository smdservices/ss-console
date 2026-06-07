/**
 * Calendar capability — read events, draft proposed events, suggest
 * times.
 *
 * Calendar events with attendees implicitly send invitations when saved.
 * Per ADR 0005 (reviewer-as-sender), the agent does not send invites to
 * external attendees. v1 split:
 *
 *   - Read methods (list_events, get_event) are unrestricted within the
 *     customer.yaml calendar scope.
 *   - create_event_draft creates a private event on the reviewer's
 *     calendar with no attendees (or only internal-team attendees, when
 *     the adapter can distinguish). The reviewer reviews, adds external
 *     attendees from their own client, and sends the invite themselves.
 *   - suggest_time is a pure read operation.
 *
 * Implemented by adapters for Microsoft Graph (Outlook Calendar) and
 * Google Workspace (Google Calendar). Apple Calendar / CalDAV are
 * possible future adapters.
 */

import type { AdapterBase, DateRange } from './types'
import type { EmailAddress } from './email'

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventStatus = 'tentative' | 'confirmed' | 'cancelled'

export interface Attendee {
  email: EmailAddress
  /** Whether this attendee is part of the customer's organization. Null
   * when the adapter cannot determine (e.g. the email domain isn't
   * recognized). */
  is_internal: boolean | null
  response_status: 'needs_action' | 'accepted' | 'declined' | 'tentative'
  /** Whether attendance is required vs optional (vendor-specific). */
  required: boolean
}

export interface CalendarEvent {
  id: string
  /** Calendar ID the event lives on. Adapters that surface only one
   * calendar may return the reviewer's primary calendar slug here. */
  calendar_id: string
  organizer: EmailAddress
  title: string
  description: string | null
  location: string | null
  start: string
  end: string
  all_day: boolean
  status: EventStatus
  attendees: Attendee[]
  /** Whether this event has external attendees. Null when the adapter
   * cannot determine (e.g. organizer-only events). */
  has_external_attendees: boolean | null
  /** When the event was created in the source calendar. */
  created_at: string
  last_modified_at: string
}

export interface EventQuery {
  /** Which calendar to read. Adapters MAY accept the reviewer's primary
   * calendar slug; the customer.yaml may also list additional readable
   * calendars (matter calendars, shared resource calendars). */
  calendar_id?: string
  date_range: DateRange
  /** Free-text title/description search. Adapters translate to the
   * vendor's query syntax. */
  search?: string
  limit?: number
  cursor?: string
}

// ---------------------------------------------------------------------------
// Time suggestion
// ---------------------------------------------------------------------------

export interface SuggestTimeInput {
  /** Email addresses to find a common free slot for. The reviewer's
   * email must be in the list; adapters MUST refuse otherwise. */
  attendees: string[]
  duration_minutes: number
  /** When to start looking. */
  earliest_start: string
  /** When to stop looking. */
  latest_end: string
  /** Preferred hours-of-day in the reviewer's timezone. Adapters that
   * can't honor this return slots regardless. */
  preferred_hours?: { start_hour: number; end_hour: number }
  /** How many candidate slots to return. */
  limit?: number
}

export interface SuggestedSlot {
  start: string
  end: string
  /** Adapter's confidence that every requested attendee is actually free
   * during this slot. Null when the adapter can only see the reviewer's
   * own calendar. */
  attendee_availability_known: boolean
}

// ---------------------------------------------------------------------------
// Draft events
// ---------------------------------------------------------------------------

/**
 * Input for a draft event. Per ADR 0005, drafts may include internal
 * attendees but adapters MUST omit external attendees — the reviewer
 * adds those from their own client before sending the invite. The
 * `internal_attendees` field is advisory; adapters that cannot
 * distinguish internal-vs-external must reject inputs with any
 * attendees and require the reviewer to add them.
 */
export interface CreateEventDraftInput {
  /** The reviewer's calendar to create the draft on. */
  reviewer_account_id: string
  calendar_id?: string
  title: string
  description?: string
  location?: string
  start: string
  end: string
  all_day?: boolean
  /** Internal-only attendees the adapter can verify are inside the
   * customer's organization. Adapters that cannot verify this MUST
   * leave the attendee list empty and document the limitation in
   * CapabilitySet.field_coverage. */
  internal_attendees?: string[]
  /** Skill that authored the draft. Audit-required. */
  drafted_by_skill: string
  /** Matter the event relates to. */
  matter_ref?: string | null
}

export interface EventDraftRef {
  id: string
  calendar_id: string
  /** When the draft is materialized, where the reviewer can find it.
   * Vendor-specific (e.g. "Tentative" on Outlook, the calendar UI on
   * Google). */
  status_in_reviewer_ui: 'tentative' | 'unconfirmed' | 'draft'
  created_at: string
}

export interface EventDraftUpdate {
  title?: string
  description?: string
  location?: string
  start?: string
  end?: string
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface Calendar extends AdapterBase {
  // Read
  list_events(query: EventQuery): Promise<CalendarEvent[]>
  get_event(event_id: string): Promise<CalendarEvent | null>

  // Time suggestion
  suggest_time(input: SuggestTimeInput): Promise<SuggestedSlot[]>

  // Drafts — reviewer-as-sender per ADR 0005
  create_event_draft(input: CreateEventDraftInput): Promise<EventDraftRef>
  update_event_draft(event_id: string, updates: EventDraftUpdate): Promise<EventDraftRef>

  // NO send_invitation method. The reviewer adds external attendees
  // and sends invites from their own calendar client. The conformance
  // harness asserts adapters do not implement an autonomous send path.

  /**
   * Calendars the customer.yaml scope envelope makes readable.
   * Skills never bypass this list — querying outside the scoped
   * calendars throws `scope_violation`.
   */
  get_scoped_calendars(): string[]
}
