# Capability Interface Contracts

**Spec for issue #791.** TypeScript signatures for all 11 capability interfaces. Adapters bind to these interfaces; skills call interface methods without knowing the concrete adapter. Phase-1-minimum coverage; verticals may extend per-interface.

## Source

- Send modality: see "Send is a configurable entitlement" below

## Send is a configurable entitlement (ADR 0035)

**Send is configured per engagement, never assumed.** Earlier drafts of this spec locked "Pattern A only" — agent drafts, reviewer always sends — as an architectural invariant. That is the dead default struck by [ADR 0035](../../adr/0035-no-imposed-entitlement-defaults.md) (amending [ADR 0005](../../adr/0005-reviewer-as-sender.md) / [ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md)). The current holding:

- An adapter **may** expose a send method. Whether a send executes autonomously, routes to a reviewer draft (reviewer-as-sender), or is refused is decided **at runtime** by `trust_ceiling.enforce()` per the authored `EXTERNAL_SEND` ceiling, **fail-closed when unauthored** (no send, no draft).
- **Reviewer-as-sender** ([ADR 0005](../../adr/0005-reviewer-as-sender.md)) is **one authored option**, not the default — and a regulated-vertical pack may pin it as a non-raisable floor. The capability layer does not enforce it by omitting `send`; the trust ceiling enforces the authored posture.
- The interfaces below currently ship create/update-draft methods; a `send` method is added per adapter as the configured entitlement requires. Irreversible actions (money movement, ledger posting, court filing) remain `COMMITMENT`/`DESTRUCTIVE` and additionally require explicit current-turn approval ([ADR 0025](../../adr/0025-autonomy-ceilings-configurable-exposure-vs-initiation.md) reversibility floor).

## Contract

All interfaces live under `operator/capabilities/<name>.ts`. Adapters at `operator/connectors/<capability>/<system>/` implement the interface.

```typescript
// Shared error types
type CapabilityError =
  | { kind: 'auth_expired'; capability: string; adapter: string }
  | { kind: 'rate_limited'; retry_after_seconds: number }
  | { kind: 'not_found'; resource: string }
  | { kind: 'forbidden'; reason: string }
  | { kind: 'upstream_error'; status: number; message: string }
  | { kind: 'scope_violation'; field: string }

type HealthStatus = {
  healthy: boolean
  last_ok_at: string // ISO 8601 UTC
  last_error?: CapabilityError
}

type CapabilitySet = {
  capability: string // e.g. "Email"
  adapter: string // e.g. "microsoft-graph"
  version: string // adapter semver
  features: string[] // optional sub-features (e.g. "labels", "folders")
}

type DateRange = { start: string; end: string } // ISO 8601
type DraftRef = { id: string; storage_uri: string; created_at: string }

// ---------- 1. PracticeManagement ----------
type MatterEvent =
  | 'matter.created'
  | 'matter.updated'
  | 'matter.closed'
  | 'document.added'
  | 'note.added'

interface SubscriptionRef {
  id: string // adapter-prefixed: `<adapter-slug>:<vendor_id>`
  events: ReadonlyArray<MatterEvent>
  webhook_url: string
  registered_at: string
  vendor_subscription_id: string
}

interface PracticeManagement {
  search_matters(query: MatterQuery): Promise<Matter[]>
  get_matter(id: string): Promise<Matter | null>
  create_matter(input: CreateMatterInput): Promise<Matter>
  update_matter(id: string, updates: Partial<MatterUpdate>): Promise<Matter>
  search_contacts(query: ContactQuery): Promise<Contact[]>
  get_contact(id: string): Promise<Contact | null>
  create_contact(input: CreateContactInput): Promise<Contact>
  list_time_entries(matter_id: string, range: DateRange): Promise<TimeEntry[]>
  create_time_entry_draft(input: TimeEntryInput): Promise<TimeEntry>
  list_matter_documents(matter_id: string): Promise<DocumentRef[]>
  upload_matter_document(matter_id: string, doc: DocumentUpload): Promise<DocumentRef>
  // Subscription (ADR 0021 Stream E). Adapters without vendor-side
  // webhook support declare these in CapabilitySet.unsupported_methods.
  subscribe(events: ReadonlyArray<MatterEvent>, webhook_url: string): Promise<SubscriptionRef>
  unsubscribe(subscription_id: string): Promise<void>
  describe_capabilities(): CapabilitySet
  health_check(): Promise<HealthStatus>
}

// ---------- 2. Email ----------
interface Email {
  list_threads(query: ThreadQuery): Promise<EmailThread[]>
  get_thread(thread_id: string): Promise<EmailThread>
  create_draft(input: DraftInput): Promise<DraftRef> // -> reviewer's drafts folder
  update_draft(draft_id: string, updates: DraftUpdate): Promise<DraftRef>
  apply_label(thread_id: string, label: string): Promise<void>
  move_to_folder(thread_id: string, folder: string): Promise<void>
  list_sent_since(cursor: string): Promise<SentItem[]> // opt-in per customer.yaml
  get_sent_item(message_id: string): Promise<SentItem>
  get_scoped_folders(): string[] // customer.yaml-allowed only
  describe_capabilities(): CapabilitySet
  health_check(): Promise<HealthStatus>
}

type DraftInput = {
  reviewer_account_id: string // human sender; never an agent mailbox
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body_html: string
  body_text: string
  thread_id?: string
  matter_ref?: string
}

// ---------- 3. Calendar ----------
interface Calendar {
  list_events(query: EventQuery): Promise<CalendarEvent[]>
  get_event(event_id: string): Promise<CalendarEvent | null>
  create_event_draft(input: EventInput): Promise<DraftRef> // reviewer confirms before send
  update_event_draft(draft_id: string, updates: Partial<EventInput>): Promise<DraftRef>
  suggest_times(input: SuggestInput): Promise<TimeSlot[]>
  respond_to_invitation_draft(
    event_id: string,
    response: 'accept' | 'decline' | 'tentative',
    comment?: string
  ): Promise<DraftRef>
  describe_capabilities(): CapabilitySet
  health_check(): Promise<HealthStatus>
}

// ---------- 4. DocumentStorage ----------
interface DocumentStorage {
  list_folder(path: string): Promise<DocumentRef[]>
  get_document(id: string): Promise<DocumentContent>
  put_document(path: string, content: DocumentUpload): Promise<DocumentRef>
  copy_document(src_id: string, dest_path: string): Promise<DocumentRef>
  delete_document(id: string): Promise<void> // requires current-turn approval per trust_ceiling
  list_versions(id: string): Promise<VersionRef[]>
  describe_capabilities(): CapabilitySet
  health_check(): Promise<HealthStatus>
}

// ---------- 5. ESign ----------
interface ESign {
  list_envelopes(query: EnvelopeQuery): Promise<Envelope[]>
  get_envelope(envelope_id: string): Promise<Envelope>
  create_envelope_draft(input: EnvelopeInput): Promise<DraftRef> // reviewer initiates send
  create_reminder_draft(envelope_id: string, input: ReminderInput): Promise<DraftRef>
  download_completed(envelope_id: string): Promise<Buffer>
  describe_capabilities(): CapabilitySet
  health_check(): Promise<HealthStatus>
}

// ---------- 6. CourtAccess (read-only) ----------
interface CourtAccess {
  search_cases(query: CaseQuery): Promise<CaseResult[]>
  get_docket(case_id: string): Promise<Docket>
  get_docket_entries(case_id: string, range: DateRange): Promise<DocketEntry[]>
  describe_capabilities(): CapabilitySet
  health_check(): Promise<HealthStatus>
}

// ---------- 7. Payments ----------
interface Payments {
  list_invoices(query: InvoiceQuery): Promise<Invoice[]>
  get_invoice(invoice_id: string): Promise<Invoice>
  create_payment_request_draft(input: PaymentRequestInput): Promise<DraftRef>
  list_transactions(range: DateRange): Promise<Transaction[]>
  get_aging_report(): Promise<AgingReport>
  describe_capabilities(): CapabilitySet
  health_check(): Promise<HealthStatus>
  // Fund movement is COMMITMENT/DESTRUCTIVE: no autonomous-transfer method is
  // exposed, and any such action is gated on explicit current-turn approval
  // (ADR 0025 reversibility floor). External send of a payment request is a
  // configurable entitlement, ceiling-gated like any other send (ADR 0035).
}

// ---------- 8. Accounting ----------
interface Accounting {
  list_invoices(query: InvoiceQuery): Promise<Invoice[]>
  create_invoice_draft(input: InvoiceInput): Promise<DraftRef>
  list_expenses(range: DateRange): Promise<Expense[]>
  create_expense_draft(input: ExpenseInput): Promise<DraftRef>
  get_ar_aging(): Promise<AgingReport>
  describe_capabilities(): CapabilitySet
  health_check(): Promise<HealthStatus>
}

// ---------- 9. IntakeCRM ----------
interface IntakeCRM {
  list_leads(query: LeadQuery): Promise<Lead[]>
  get_lead(lead_id: string): Promise<Lead>
  update_lead_status(lead_id: string, status: LeadStatus, note?: string): Promise<Lead>
  list_intake_responses(form_id: string, range: DateRange): Promise<IntakeResponse[]>
  create_followup_draft(lead_id: string, input: FollowupInput): Promise<DraftRef>
  describe_capabilities(): CapabilitySet
  health_check(): Promise<HealthStatus>
}

// ---------- 10. CallTracking ----------
interface CallTracking {
  list_calls(query: CallQuery): Promise<CallRecord[]>
  get_call(call_id: string): Promise<CallRecord>
  get_recording_url(call_id: string): Promise<string | null> // signed URL; expires
  get_transcript(call_id: string): Promise<CallTranscript | null>
  get_attribution(call_id: string): Promise<CallAttribution>
  describe_capabilities(): CapabilitySet
  health_check(): Promise<HealthStatus>
}

// ---------- 11. InternalComms ----------
interface InternalComms {
  list_channels(): Promise<ChannelRef[]>
  post_to_channel(channel_id: string, body: MessageBody): Promise<MessageRef> // agent persona OK; INTERNAL ONLY
  post_dm(user_id: string, body: MessageBody): Promise<MessageRef>
  list_recent_messages(channel_id: string, since: string): Promise<Message[]>
  describe_capabilities(): CapabilitySet
  health_check(): Promise<HealthStatus>
}
```

## Failure modes

Every method returns `Promise<T>` and rejects with `CapabilityError`. Adapters must NOT throw unstructured exceptions across the capability boundary — runtime relies on `kind` to route handling:

- `auth_expired` → triggers OAuth refresh per oauth-lifecycle.md
- `rate_limited` → runtime backs off per `retry_after_seconds`
- `scope_violation` → audit-logged as invariant-7-related event, raised to Captain
- `forbidden` → returned to skill; skill produces empty-state draft per fabrication-filter.md
- `upstream_error` → returned to skill; connector marked degraded in health view

## Verification

Adapter conformance suite at `operator/capabilities/tests/conformance/<capability>.test.ts`. Every adapter MUST pass:

1. Every method returns the correct TypeScript type at runtime (schema validation)
2. Every error case rejects with a structured `CapabilityError`, never a raw exception
3. `health_check` returns within 5s
4. `describe_capabilities` returns the adapter's actual feature set (no overclaiming)
5. No method for an **irreversible action** — fund movement (`transfer_*`, `disburse`, `initiate_transfer`), ledger posting, or court filing — exists on Payments / Accounting / CourtAccess adapters (the ADR 0025 reversibility floor; conformance harness `BANNED_METHOD_NAMES`). External-send methods (`send_*` on Email/ESign/Calendar/IntakeCRM) are **permitted** — their execution is gated at runtime by the trust ceiling per the authored `EXTERNAL_SEND` posture (ADR 0035), not by method absence.

## Implementation notes

- TypeScript interface signatures at `operator/capabilities/<name>.ts` are the **doctrinal contract** — the binding API shape. Concrete adapters live at `operator/connectors/<capability>/<system>/` and are implemented in **Python** (matching PR #812 and the rest of the substrate at `operator/adapter/`). Each adapter re-declares the capability interface in Python via `typing.Protocol` to enforce the contract at runtime in the implementation language.
- Skill `SKILL.md` frontmatter declares `requires_capabilities: [Email, PracticeManagement]` — runtime fails skill activation if customer.yaml lacks bindings for declared capabilities.
- The full TypeScript domain types (Matter, EmailThread, etc.) live in `operator/capabilities/types.ts` as the doctrinal shape; Python `dataclass` mirrors live alongside each adapter for runtime use. Phase 1 ships minimum-field shapes per Tech Lead's draft; Phase 2 expands per vertical PRDs.

## Resolved decisions

**Adapter language: Python runtime, TypeScript doctrine.** The substrate is already Python end-to-end (Hermes overlay, audit log, memory pipeline, voice pipeline, trust ceiling — all Python; see `operator/adapter/`). PR #812's LawPay and ShipStation Python adapters are correct as shipped. TypeScript signatures here document the contract; Python `typing.Protocol` declarations in each adapter enforce it at runtime. No TS-adapter migration. This avoids a translation layer for no functional gain and keeps the connector adapters co-located with the Python substrate they interact with.

**Calendar.respond_to_invitation_draft shape.** The `DraftRef` return type is correct for the **reviewer-as-sender** posture, which an engagement may author for calendar responses (ADR 0005, one authored option). Under that posture the adapter returns a `DraftRef`, the partner taps Accept/Decline in the dashboard, and the dashboard fires the API call. Where an engagement instead authors `EXTERNAL_SEND: autonomous` for this action, the trust ceiling permits a direct response — the modality is configured per engagement (ADR 0035), not fixed by the interface shape. No interface reshape needed either way.
