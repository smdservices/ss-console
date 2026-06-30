/**
 * Booking system configuration.
 *
 * Single consultant (Scott Durgan), Phoenix America/Phoenix tz (no DST ever).
 * The hardcoded weekly schedule and slot rules are read by the availability
 * engine (`./availability.ts`) on every slot computation.
 *
 * In v2 we'll expose this via an admin UI backed by a config table; v1 keeps
 * it as a TypeScript const so changes require a deploy. Three lines today
 * vs an admin form + DB read on every booking page load.
 */

export interface WeeklyWindow {
  /** 24h local time, "HH:MM". */
  start: string
  /** 24h local time, "HH:MM" — exclusive (a 16:00 end means the last 30-min slot starts at 15:30). */
  end: string
}

export type WeeklyDayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'

export interface BookingConfig {
  consultant: {
    name: string
    email: string
    /** Google Calendar id; 'primary' for the OAuth-connected account's main calendar. */
    calendar_id: string
    /** IANA timezone for the consultant. */
    timezone: string
  }
  /** Slot length in minutes. v1 only supports a single slot length. */
  slot_minutes: number
  /** Buffer enforced before AND after every busy/booked range. */
  buffer_minutes: number
  /** Minimum lead time before the next bookable slot (24h = 1440). */
  min_notice_minutes: number
  /** How far in the future slots may be offered. */
  max_lookahead_days: number
  /** Working hours per local day. Empty array = closed that day. */
  weekly_schedule: Record<WeeklyDayKey, WeeklyWindow[]>
  /** Human-readable label used in emails / ICS / page copy. */
  meeting_label: string
  /** Per-call timeout for Google Calendar API requests. */
  google_call_timeout_ms: number
  /** Number of retries on transient Google failures (5xx, network). */
  google_call_retries: number
  /**
   * Manage token TTL after the slot ends. The guest can cancel/reschedule
   * for this many hours after their assessment slot before the token expires.
   */
  manage_token_ttl_hours_after_slot: number
  /** Static video call URL used for all booking events. */
  meeting_url: string
}

export const BOOKING_CONFIG: BookingConfig = {
  consultant: {
    name: 'Scott Durgan',
    email: 'team@smd.services',
    calendar_id: 'primary',
    timezone: 'America/Phoenix',
  },
  slot_minutes: 30,
  buffer_minutes: 15,
  min_notice_minutes: 24 * 60,
  max_lookahead_days: 60,
  weekly_schedule: {
    sun: [],
    mon: [{ start: '09:00', end: '16:00' }],
    tue: [{ start: '09:00', end: '16:00' }],
    wed: [{ start: '09:00', end: '16:00' }],
    thu: [{ start: '09:00', end: '16:00' }],
    fri: [{ start: '09:00', end: '16:00' }],
    sat: [],
  },
  meeting_label: '30-minute intro call',
  google_call_timeout_ms: 8_000,
  google_call_retries: 1,
  manage_token_ttl_hours_after_slot: 48,
  meeting_url: 'https://zoom.us/j/4284801619',
}

/**
 * Productized SKU codes that may be carried through /book?interest=<sku>
 * from a marketing CTA, paired with the human label shown to the prospect.
 *
 * This is the single source of truth for BOTH the allow-list AND the label.
 * It backs four surfaces that previously each carried their own copy and
 * drifted apart (2026-06-30 review: the visitor chip and CRM-context maps
 * had only 3 of the 15 entries, so the 12 vertical packs rendered no
 * "Inquiring about" chip): the /book validation (page prefill), the
 * /api/intake/send API boundary, the IntakeIntroCard intent chip, and the
 * intake-core CRM context line. Extending the product line is one edit here.
 *
 * Unknown values are silently dropped to null at the /book and
 * /api/intake/send boundaries rather than rejected, so a stale URL or
 * cached link cannot break a legitimate submission.
 */
export const INTEREST_LABELS: Record<string, string> = {
  operator: 'Operator',
  'law-firm': 'Operator for Law Firms',
  insurance: 'Operator for Insurance Agencies',
  veterinary: 'Operator for Veterinary Clinics',
  title: 'Operator for Title & Escrow',
  accounting: 'Operator for Accounting Firms',
  ria: 'Operator for Advisory Firms',
  mortgage: 'Operator for Mortgage Brokers',
  dental: 'Operator for Dental Practices',
  'med-spa': 'Operator for Med Spas',
  'marketing-agency': 'Operator for Marketing Agencies',
  'property-management': 'Operator for Property Managers',
  'home-services': 'Operator for Home Services',
  ai: 'AI & Automation',
  consulting: 'Solutions Consulting',
}

/** Strict allow-list, derived from the label map so the two can never drift. */
export const ALLOWED_INTERESTS: ReadonlySet<string> = new Set(Object.keys(INTEREST_LABELS))

/**
 * Slug → human label, with a safe raw-slug fallback for an unrecognized
 * value. Shared by the intent chip, the CRM context line, and the admin
 * email so all three render identically. This only renders — the allow-list
 * is enforced at the /book and /api/intake/send boundaries.
 */
export function interestLabel(slug?: string | null): string | null {
  if (!slug) return null
  return INTEREST_LABELS[slug] ?? slug
}

/**
 * Builds a /book href. Pass an `interest` only from a surface that is
 * genuinely about that solution (the /operator page or a vertical pack) so
 * the prospect sees an "Inquiring about …" chip. Firm-level surfaces
 * (homepage, about, contact, footer, the nav on generic pages) call this
 * with no argument: the assessment is the objectives-first front door and
 * must not presume a solution before the conversation. Does NOT validate —
 * the allow-list is enforced at /book and /api/intake/send.
 */
export function bookHref(interest?: string): string {
  return interest ? `/book?interest=${interest}` : '/book'
}
