/**
 * PracticeManagement capability — search/create/update entities (matters,
 * contacts), time and billing entries, documents.
 *
 * Implemented by adapters for Filevine, SmartAdvocate, Clio, CASEpeer,
 * Neos, MyCase, etc. (Law-firm PRD §7.2 Tier-1 ladder).
 *
 * Phase-1 signatures adopted from the Tech Lead contribution (round-1
 * synthesis Theme 4). Vertical-specific fields (PI-only attributes,
 * employment-only attributes) live in `Matter.custom_fields`; adapters
 * populate what their source system exposes; skills must not assume any
 * custom field is present without checking.
 */

import type { AdapterBase, DateRange } from './types'

// ---------------------------------------------------------------------------
// Matter
// ---------------------------------------------------------------------------

export type MatterStatus = 'open' | 'closed' | 'pending' | 'intake'

export interface Matter {
  id: string
  client_name: string
  matter_type: string
  status: MatterStatus
  opened_at: string
  closed_at: string | null
  /**
   * Vertical-specific and adapter-specific fields. Adapters populate what
   * their underlying PM system exposes. Skill code must check for presence
   * before reading; the conformance harness asserts adapters declare
   * which custom_fields they populate in their CapabilitySet.
   */
  custom_fields: Record<string, unknown>
}

export interface MatterQuery {
  client_name?: string
  matter_type?: string
  status?: MatterStatus
  date_range?: DateRange
  limit?: number
  offset?: number
}

export interface CreateMatterInput {
  client_name: string
  matter_type: string
  status?: MatterStatus
  custom_fields?: Record<string, unknown>
}

export interface MatterUpdate {
  client_name?: string
  matter_type?: string
  status?: MatterStatus
  custom_fields?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

export interface Contact {
  id: string
  name: string
  email: string | null
  phone: string | null
  /** Free-form role (e.g. "client", "opposing-counsel", "expert-witness"). */
  role: string | null
  custom_fields: Record<string, unknown>
}

export interface ContactQuery {
  name?: string
  email?: string
  role?: string
  limit?: number
  offset?: number
}

export interface CreateContactInput {
  name: string
  email?: string
  phone?: string
  role?: string
  custom_fields?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Time and billing
// ---------------------------------------------------------------------------

export interface TimeEntry {
  id: string
  matter_id: string
  date: string
  duration_minutes: number
  description: string
  billable: boolean
  /** Hourly rate in minor units (cents). null when not yet billed. */
  rate_cents: number | null
  /**
   * Status as known to the PM system. Adapters normalize to this
   * vocabulary; vendor-specific statuses live in custom_fields.
   */
  status: 'draft' | 'pending_review' | 'billed' | 'written_off'
  custom_fields: Record<string, unknown>
}

export interface TimeEntryInput {
  matter_id: string
  date: string
  duration_minutes: number
  description: string
  billable: boolean
  rate_cents?: number
}

// ---------------------------------------------------------------------------
// Documents (PM-system-scoped)
// ---------------------------------------------------------------------------

export interface DocumentRef {
  id: string
  matter_id: string
  filename: string
  mime_type: string
  size_bytes: number
  uploaded_at: string
  uploaded_by: string | null
}

export interface DocumentUpload {
  filename: string
  mime_type: string
  content: Uint8Array
  /** Optional folder path within the matter, vendor-permitting. */
  folder?: string
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface PracticeManagement extends AdapterBase {
  // Matter operations
  search_matters(query: MatterQuery): Promise<Matter[]>
  get_matter(id: string): Promise<Matter | null>
  create_matter(input: CreateMatterInput): Promise<Matter>
  update_matter(id: string, updates: MatterUpdate): Promise<Matter>

  // Contact operations
  search_contacts(query: ContactQuery): Promise<Contact[]>
  get_contact(id: string): Promise<Contact | null>
  create_contact(input: CreateContactInput): Promise<Contact>

  // Time and billing (read-only at v1 except for draft creation; no
  // autonomous billing posts per ADR 0006 + invariant #3 spirit)
  list_time_entries(matter_id: string, range: DateRange): Promise<TimeEntry[]>
  create_time_entry_draft(input: TimeEntryInput): Promise<TimeEntry>

  // Document operations within the PM system
  list_matter_documents(matter_id: string): Promise<DocumentRef[]>
  upload_matter_document(matter_id: string, doc: DocumentUpload): Promise<DocumentRef>
}
