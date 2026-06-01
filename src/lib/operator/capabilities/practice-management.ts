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

/**
 * Webhook event types the PracticeManagement adapter can subscribe to.
 *
 * Added by ADR 0021 Stream E. Initial set covers matter lifecycle plus
 * document/note attach events — the vendor-direct events that trigger
 * intake-triage and discovery-response skills. Vendor-specific events
 * outside this set carry a `vendor_event_type` field in metadata.
 */
export type MatterEvent =
  | 'matter.created'
  | 'matter.updated'
  | 'matter.closed'
  | 'document.added'
  | 'note.added'

/**
 * Returned by `subscribe()` — the per-customer record of a webhook
 * subscription registered with the underlying PM system. The id is the
 * adapter-side handle (used to unsubscribe); the `vendor_subscription_id`
 * is the vendor's own id for the same record.
 *
 * Per ADR 0021 Stream E. The overlay's `hermes-smd-webhook-router`
 * plugin reads inbound webhook payloads, matches them against
 * `customer.yaml.webhook_triggers` (schema in #1052), and dispatches
 * the configured skill.
 */
export interface SubscriptionRef {
  id: string
  events: ReadonlyArray<MatterEvent>
  webhook_url: string
  registered_at: string
  vendor_subscription_id: string
}

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

  // Subscription operations (ADR 0021 Stream E). Adapters that do not
  // support vendor-side webhooks declare `subscribe` / `unsubscribe`
  // in `CapabilitySet.unsupported_methods` and raise
  // `capability_not_supported` at call time.
  subscribe(events: ReadonlyArray<MatterEvent>, webhook_url: string): Promise<SubscriptionRef>
  unsubscribe(subscription_id: string): Promise<void>
}
