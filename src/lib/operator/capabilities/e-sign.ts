/**
 * ESign capability — envelope status monitoring, reminder drafts,
 * completed-document retrieval.
 *
 * Per ADR 0005 (reviewer-as-sender), the agent NEVER initiates a
 * signing flow. The reviewer creates the envelope and sends it; the
 * agent tracks, drafts reminder language for stalled signers, and
 * retrieves completed documents.
 *
 * Phase-1 signatures adopted from the Tech Lead contribution. Implemented
 * by adapters for DocuSign, PandaDoc, Adobe Sign, HelloSign.
 */

import type { AdapterBase, DateRange } from './types'
import type { DraftRef } from './email'

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

export type EnvelopeStatus =
  | 'sent'
  | 'delivered'
  | 'partial_signed'
  | 'completed'
  | 'declined'
  | 'voided'
  | 'expired'

export interface Signer {
  email: string
  name: string
  /** Role in the envelope (e.g. "client", "co-counsel"). */
  role: string | null
  /** Whether this signer has signed. */
  signed: boolean
  /** ISO 8601 timestamp of signing. Null when not yet signed. */
  signed_at: string | null
  /** When the platform last reminded this signer. Null when never
   * reminded. */
  last_reminded_at: string | null
}

export interface Envelope {
  id: string
  /** Subject as set in the source platform. */
  subject: string
  status: EnvelopeStatus
  /** Who created/sent the envelope. */
  sender_email: string
  signers: Signer[]
  created_at: string
  sent_at: string | null
  completed_at: string | null
  /** Adapter-specific matter or correlation reference, when known. */
  matter_ref: string | null
}

export interface EnvelopeQuery {
  status?: EnvelopeStatus
  sender_email?: string
  signer_email?: string
  date_range?: DateRange
  /** Free-text subject search. */
  subject?: string
  limit?: number
  cursor?: string
}

// ---------------------------------------------------------------------------
// Reminder drafts
// ---------------------------------------------------------------------------

export interface ReminderInput {
  /** Which signer to chase. */
  signer_email: string
  /** The reviewer who will send the reminder. */
  reviewer_account_id: string
  /** Optional message override. Adapters fall back to a default body
   * when omitted. */
  body_html?: string
  body_text?: string
  drafted_by_skill: string
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ESign extends AdapterBase {
  list_envelopes(query: EnvelopeQuery): Promise<Envelope[]>
  get_envelope(envelope_id: string): Promise<Envelope | null>

  /**
   * Drafts a reminder for a stalled signer. Per ADR 0005 (and the
   * Tech Lead's Phase-1 signature note), the agent never initiates
   * signing flows or sends reminders directly. The returned DraftRef
   * is in the reviewer's email drafts; the reviewer reviews and
   * sends.
   */
  create_reminder_draft(envelope_id: string, input: ReminderInput): Promise<DraftRef>

  download_completed(envelope_id: string): Promise<Uint8Array>

  // NO send_envelope method. The reviewer creates and sends envelopes
  // from the source platform's native UI. The agent only tracks and
  // chases. Implementing autonomous send here would violate ADR 0005
  // and is blocked by the conformance harness.
}
