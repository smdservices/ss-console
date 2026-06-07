/**
 * CallTracking capability — call records, call recordings, attribution
 * data. READ-ONLY.
 *
 * No write methods. The agent reads call history and recordings to
 * inform drafts (intake-call-follow-up skill, attribution analytics)
 * but never originates calls or modifies call records. Phone-call
 * outreach, if ever implemented, lives in a separate Voice/Phone
 * capability — not here.
 *
 * Implemented by adapters for CallRail, CallTrackingMetrics, Aircall.
 * Adapters for vendor systems that bundle call tracking with CRM
 * (e.g. RingCentral with HubSpot integration) implement the
 * call-data portion here and the CRM portion in IntakeCRM.
 */

import type { AdapterBase, DateRange } from './types'

// ---------------------------------------------------------------------------
// Call records
// ---------------------------------------------------------------------------

export type CallDirection = 'inbound' | 'outbound'

export type CallOutcome = 'answered' | 'missed' | 'voicemail' | 'busy' | 'no_answer' | 'forwarded'

export interface CallRecord {
  id: string
  direction: CallDirection
  /** Caller's phone number (E.164 when the adapter normalizes). */
  from_number: string
  /** Recipient's phone number. */
  to_number: string
  /** Customer's tracking number that received/originated the call.
   * Distinct from to_number when forwarding is involved. */
  tracked_number: string | null
  /** ISO 8601 timestamps. */
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  outcome: CallOutcome
  /** Whether a recording exists for this call. Adapters that cannot
   * determine return null. */
  has_recording: boolean | null
  /** Reference to attribution data (campaign, source). Null when the
   * call wasn't attributed. */
  attribution_ref: string | null
  /** Lead reference when the adapter can correlate. */
  lead_ref: string | null
}

export interface CallQuery {
  direction?: CallDirection
  outcome?: CallOutcome
  from_number?: string
  to_number?: string
  date_range?: DateRange
  has_recording?: boolean
  /** Filter to calls correlated with a specific lead. */
  lead_ref?: string
  limit?: number
  cursor?: string
}

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------

export interface CallRecording {
  call_id: string
  /** Time-limited URL to retrieve the recording media. Adapters set
   * the expiry; skill code re-requests when stale. */
  media_url: string
  /** ISO 8601 expiry. */
  url_expires_at: string
  mime_type: string
  /** Duration in seconds. */
  duration_seconds: number
  /** When the adapter has a transcription, this is the text body.
   * Null when no transcription exists or the adapter cannot retrieve
   * it. */
  transcript: string | null
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export interface CallAttribution {
  /** Adapter-internal attribution ID. */
  id: string
  call_id: string
  /** Source identifier as the adapter reports it (e.g.
   * "google-ads:campaign=intake-q2", "referral:jdoe@partner.com"). */
  source: string
  /** Campaign name when the adapter exposes one. */
  campaign: string | null
  /** Medium classification (e.g. "cpc", "organic", "direct", "referral"). */
  medium: string | null
  /** Landing page URL that preceded the call, when known. */
  landing_url: string | null
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface CallTracking extends AdapterBase {
  list_calls(query: CallQuery): Promise<CallRecord[]>
  get_call(call_id: string): Promise<CallRecord | null>

  get_recording(call_id: string): Promise<CallRecording | null>

  get_attribution(call_id: string): Promise<CallAttribution | null>

  // NO write methods. The conformance harness asserts the interface
  // remains read-only.
}
