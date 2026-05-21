/**
 * IntakeCRM capability — lead intake, lead status, intake-form
 * responses.
 *
 * Mutations on lead records (status changes, notes, assignments) are
 * NOT outbound communications and are allowed per ADR 0005 (which
 * governs customer-bound external messages). The lead CRM is internal
 * to the customer's organization; status mutations land in the CRM,
 * not in an external inbox.
 *
 * Outreach to the lead (email, call) is handled by the Email and (when
 * implemented) Voice/Phone capabilities — IntakeCRM does not duplicate
 * those send paths.
 *
 * Implemented by adapters for Lead Docket, Captorra, Lawmatics (when
 * client uses it for intake), HubSpot, Salesforce.
 */

import type { AdapterBase, DateRange } from './types'

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualifying'
  | 'qualified'
  | 'disqualified'
  | 'converted'
  | 'lost'
  | 'archived'

export interface Lead {
  id: string
  /** Display name (full name or business name). */
  name: string
  email: string | null
  phone: string | null
  status: LeadStatus
  /** Source attribution — e.g. "google-ads", "referral:jdoe@partner.com". */
  source: string | null
  /** When the lead was first captured. */
  intake_at: string
  /** When the status was last changed. */
  status_changed_at: string
  /** Matter the lead converted into. Null until conversion. */
  converted_matter_ref: string | null
  /** Adapter-specific extra fields. */
  custom_fields: Record<string, unknown>
}

export interface LeadQuery {
  status?: LeadStatus
  source?: string
  /** Lead capture window. */
  intake_window?: DateRange
  /** Free-text search across name, email, phone. */
  search?: string
  limit?: number
  cursor?: string
}

export interface UpdateLeadInput {
  status?: LeadStatus
  /** Internal note appended to the lead's record. */
  note?: string
  /** Assignment to a human in the customer's org. Email is the
   * canonical identifier. */
  assigned_to?: string
  drafted_by_skill: string
}

// ---------------------------------------------------------------------------
// Intake forms
// ---------------------------------------------------------------------------

export interface IntakeFormResponse {
  id: string
  lead_id: string | null
  form_name: string
  /** ISO 8601. */
  submitted_at: string
  /** Form fields keyed by field name as defined in the source form. */
  fields: Record<string, unknown>
  /** Optional source URL where the form lives (for audit). */
  source_url: string | null
}

export interface IntakeFormResponseQuery {
  form_name?: string
  date_range?: DateRange
  /** Filter to responses for a specific lead. */
  lead_id?: string
  limit?: number
  cursor?: string
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export interface LeadNote {
  id: string
  lead_id: string
  author: string
  /** ISO 8601. */
  created_at: string
  body: string
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IntakeCRM extends AdapterBase {
  // Lead read
  list_leads(query: LeadQuery): Promise<Lead[]>
  get_lead(lead_id: string): Promise<Lead | null>

  // Lead mutate (internal — not external comms)
  update_lead(lead_id: string, updates: UpdateLeadInput): Promise<Lead>
  append_lead_note(lead_id: string, body: string, drafted_by_skill: string): Promise<LeadNote>

  // Intake forms
  list_intake_form_responses(query: IntakeFormResponseQuery): Promise<IntakeFormResponse[]>
  get_intake_form_response(response_id: string): Promise<IntakeFormResponse | null>

  // NO send_to_lead method. Outreach to the lead happens through Email
  // (drafted in the reviewer's drafts folder per ADR 0005). The
  // conformance harness asserts IntakeCRM does not duplicate the
  // Email send path.
}
