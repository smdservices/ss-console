# Technical Lead Contribution - PRD Review Round 1

**Author:** Tech Lead Agent
**Date:** 2026-05-19
**Scope:** MVP / Phase 1 only (per platform PRD §0 and §20 Phase 1)
**Source documents reviewed:** `platform-prd.md` v0, `law-firm-prd.md` v0, `CLAUDE.md`

---

## Summary

Both PRDs have a solid architectural spine. The critique pass addressed product-level concerns well. What the critique pass did not fully address is the implementation-level precision required before a single line of code is written. This contribution surfaces gaps in contract definitions, schema completeness, enforcement mechanism specifics, cross-PRD contradictions, and automation coverage. Many of these are "undefined in the PRD but probably thought about" — this review makes that ambiguity explicit so it can be resolved before Phase 1 build begins.

The most critical findings (in order of build-blocking severity):

1. Capability interface contracts are named but not defined — adapters cannot be written without them
2. `customer.yaml` schema has no validation contract, versioning, or secret-handling strategy
3. Invariant #7 (cross-Machine query prohibition) has a boot-time check described in prose but no testable implementation spec
4. Invariant #8 (fabrication discipline) enforcement mechanism is circular — the `context-detector` skill cannot be invoked to catch fabrication in skill output if that output is itself a skill invocation
5. `bin/decommission-customer.sh` is mentioned as a Phase 1 deliverable but has no spec, and the deletion sequence across five storage substrates is order-sensitive
6. Cost telemetry instrumentation (§15.1) has no event-emission spec — cannot instrument what is not specified

---

## Architecture & Technical Design

### 7.1 Multi-tenant model — what's locked vs. what's implicit

The PRD correctly locks the one-Machine-per-customer isolation model. However, the following are architectural facts implied by the model but not stated, each of which has implementation consequences:

**Control-plane / data-plane separation is not defined.** The PRD describes the Captain operating through a "control-plane interface" (§7.7) that provides provisioning, telemetry, audit access, and emergency-stop. But it does not specify where the control plane lives. Three options exist, each with different security boundaries:

```
Option A — Control plane is a separate Fly.io app
  ┌─────────────────────┐    ┌───────────────────────────────┐
  │  control-plane app  │──▶│  hermes-{customer-slug} [N]   │
  │  (crane-console     │    │  Machine                       │
  │   extended)         │    │  D1 + R2 + Vectorize           │
  └─────────────────────┘    └───────────────────────────────┘

Option B — Control plane is a separate service on each Machine
  ┌──────────────────────────────────────────────────────────┐
  │  hermes-{customer-slug}                                  │
  │  ┌──────────────────┐   ┌─────────────────────────────┐ │
  │  │  agent runtime   │   │  control-plane sidecar       │ │
  │  │  (Hermes)        │   │  (metrics, emergency-stop)   │ │
  │  └──────────────────┘   └─────────────────────────────┘ │
  └──────────────────────────────────────────────────────────┘

Option C — Control plane is inside the Hermes process
  [Same process, different event loop / thread]
```

**Issue:** Option A is the only architecture that enforces the cross-Machine query prohibition at the network layer (invariant #7). Options B and C require the prohibition to be enforced inside the Hermes process itself, which is weaker. The PRD does not specify which option is intended. Given that §7.5 invariant #7 describes a "boot-time storage-binding check," the PRD appears to assume Option B or C (the check is inside the runtime), but this contradicts the clean isolation goal. The ADR for per-customer Machine isolation (§19) must address this.

**Fly.io Machine scaling policy is not specified.** The PRD mentions the "Fly.io Machine baseline" as a cost driver (§15.1) and notes the "always-on vs. scale-to-zero tradeoff." Scale-to-zero on a Fly Machine creates a cold-start latency: the first request after the Machine sleeps incurs a 2-10 second boot penalty. For a product where "voice calibration scenario draft ≤8s per draft" is a measured commitment (§16.2), this is a problem. The scale-to-zero decision is load-bearing for both cost and the demo performance commitment. It must be resolved before Phase 1 build.

**Hermes runtime "pinned SHA" boot process is not described.** §7.1 states the runtime is "pinned to a content-hash SHA" and §7.4 states skills are "pinned per customer by content-hash." But the mechanism by which Hermes verifies its own SHA at boot, and the mechanism by which it refuses to start if the skill catalog hash doesn't match the customer.yaml pin, is not described. Without this, the "no silent regressions" guarantee (§7.4) is a statement, not an enforcement.

### Current architecture diagram (as specified)

```
┌────────────────────────────────────────────────────────┐
│  SMD Control Plane (crane-console-extended)            │
│  - provision-customer.sh                               │
│  - skill catalog management                            │
│  - per-customer telemetry                              │
│  - emergency-stop                                      │
└─────────────────────────┬──────────────────────────────┘
                          │ (mechanism unspecified)
          ┌───────────────┼────────────────────┐
          ▼               ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ hermes-{cust-A} │  │ hermes-{cust-B} │  │ hermes-{cust-C} │
│ Fly.io Machine  │  │ Fly.io Machine  │  │ Fly.io Machine  │
│ ─────────────── │  │ ─────────────── │  │ ─────────────── │
│ Hermes runtime  │  │ Hermes runtime  │  │ Hermes runtime  │
│ customer.yaml   │  │ customer.yaml   │  │ customer.yaml   │
│ ─────────────── │  │ ─────────────── │  │ ─────────────── │
│ D1 (structured) │  │ D1 (structured) │  │ D1 (structured) │
│ R2 (markdown)   │  │ R2 (markdown)   │  │ R2 (markdown)   │
│ Vectorize       │  │ Vectorize       │  │ Vectorize       │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                   │                    │
         ▼                   ▼                    ▼
  [Customer A             [Customer B           [Customer C
   connectors]             connectors]           connectors]
  Filevine, O365,         Clio, Gmail,          PracticePanther,
  DocuSign, LawPay        DocuSign, QBO         etc.
```

**What the diagram does not show (gaps):**

- Where AgentMail mailboxes live and how they bind to Machine instances
- How Composio sessions are scoped per customer
- Whether D1/R2/Vectorize are provisioned inside the Machine boundary or as separate Cloudflare resources
- The audit log write path (D1 write from inside the Machine is synchronous; if the Machine crashes mid-action, the last audit entry may be missing)

---

## Proposed Data Model

### D1 schema (per customer, one D1 database per Machine)

The PRD describes memory layers (§10.1) in prose. Translating to SQL-shaped schema:

```sql
-- Audit log (immutable append-only)
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,          -- ULID, lexicographically sorted
  ts            TEXT NOT NULL,             -- ISO 8601 UTC
  action_type   TEXT NOT NULL,             -- enum: DRAFT_CREATED | DRAFT_APPROVED | DRAFT_REJECTED |
                                           --        MEMORY_RULE_ADDED | MEMORY_RULE_EDITED | MEMORY_RULE_DELETED |
                                           --        TRUST_PROMOTED | TRUST_DEMOTED |
                                           --        SKILL_ENABLED | SKILL_DISABLED |
                                           --        AGENT_STOPPED | AGENT_RESUMED |
                                           --        CONNECTOR_BOUND | CONNECTOR_UNBOUND |
                                           --        SCOPE_CHANGED | SENT_DETECTED
  actor         TEXT NOT NULL,             -- 'agent' | 'captain' | person_id (human actor)
  skill_name    TEXT,                      -- null if not skill-driven
  matter_ref    TEXT,                      -- external system reference; null if firm-level
  input_digest  TEXT,                      -- SHA-256 of the input payload (not the payload itself)
  output_digest TEXT,                      -- SHA-256 of the output (draft) payload
  diff_digest   TEXT,                      -- SHA-256 of structural delta for sent-folder events
  trust_ceiling TEXT,                      -- ceiling at time of action
  metadata      TEXT                       -- JSON blob for action-type-specific data
  -- NOTE: No raw content stored in audit_log. Digests only.
  -- Raw content lives in R2; this table is the ledger.
);

-- Hard rules (customer-defined, versioned)
CREATE TABLE memory_rules (
  id            TEXT PRIMARY KEY,          -- ULID
  rule_type     TEXT NOT NULL,             -- 'case_acceptance' | 'voice' | 'process' | 'scope' | 'escalation'
  category      TEXT,                      -- customer-defined label (e.g., 'intake', 'billing')
  content       TEXT NOT NULL,             -- the rule text (human-readable)
  source        TEXT NOT NULL,             -- 'direct_teach' | 'edit_inferred' | 'captain'
  source_ref    TEXT,                      -- audit_log.id of the originating event (if inferred)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT,                      -- soft-delete; NULL = active
  version       INTEGER NOT NULL DEFAULT 1
);

-- Person mappings
CREATE TABLE person_mappings (
  id            TEXT PRIMARY KEY,          -- ULID
  canonical_name TEXT NOT NULL,
  role          TEXT NOT NULL,             -- 'partner' | 'paralegal' | 'intake_coordinator' |
                                           -- 'billing_coordinator' | 'client' | 'opposing_counsel' |
                                           -- 'vendor' | 'referral_source' | 'other'
  email_addresses TEXT,                    -- JSON array; may be null
  external_ids  TEXT,                      -- JSON obj: {"filevine": "...", "clio": "..."}
  firm_internal BOOLEAN NOT NULL DEFAULT 1,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

-- Skill state per customer
CREATE TABLE skill_state (
  skill_name    TEXT PRIMARY KEY,
  trust_ceiling TEXT NOT NULL,             -- 'autonomous' | 'draft_for_review' | 'disabled'
  content_hash  TEXT NOT NULL,             -- pinned SHA of the SKILL.md at last activation
  activated_at  TEXT NOT NULL,
  last_run_at   TEXT,
  run_count     INTEGER NOT NULL DEFAULT 0,
  config        TEXT                       -- JSON: skill-specific config params from customer.yaml
);

-- Draft queue (pending human review)
CREATE TABLE draft_queue (
  id            TEXT PRIMARY KEY,          -- ULID
  skill_name    TEXT NOT NULL,
  matter_ref    TEXT,
  created_at    TEXT NOT NULL,
  expires_at    TEXT,                      -- null = no expiry; set for time-sensitive drafts
  status        TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected' | 'expired'
  reviewed_at   TEXT,
  reviewed_by   TEXT,                      -- person_mappings.id
  r2_draft_key  TEXT NOT NULL,             -- R2 object key for the draft content
  r2_sent_key   TEXT,                      -- R2 object key for final sent version (post-approval)
  priority      INTEGER NOT NULL DEFAULT 5  -- 1 (highest) to 10 (lowest)
);

-- Cost telemetry (per day, per driver category)
CREATE TABLE cost_telemetry (
  date          TEXT NOT NULL,             -- YYYY-MM-DD
  driver        TEXT NOT NULL,             -- matches §15.1 cost driver list
  amount_cents  INTEGER NOT NULL,          -- integer cents to avoid float precision issues
  units         REAL,                      -- tokens, API calls, GB-hours, etc.
  unit_type     TEXT,                      -- 'input_tokens' | 'output_tokens' | 'api_calls' |
                                           -- 'gb_hours' | 'machine_minutes' | 'captain_minutes'
  PRIMARY KEY (date, driver)
);

-- Safety invariant boot-check log
CREATE TABLE invariant_boot_checks (
  id            TEXT PRIMARY KEY,          -- ULID
  ts            TEXT NOT NULL,             -- boot timestamp
  invariant_num INTEGER NOT NULL,          -- 1-8
  passed        BOOLEAN NOT NULL,
  failure_detail TEXT                      -- null if passed; description if failed
);
```

**Schema gaps the PRD does not address:**

1. **No voice sample table.** Voice samples are mentioned as stored in R2 (§10.1), but there is no D1 index table tracking: sample ID, upload timestamp, recipient cohort, sanitization status, whether used in the current voice model, and whether used in blind-test scoring. Without this table, the voice quality gate (§9.6) cannot be enforced programmatically.

2. **No per-recipient cohort definition table.** Layer 3 of the voice model (§9.3) declares "cohorts in customer.yaml" — but if cohorts are only in YAML, the agent cannot query "which cohort applies to this recipient" at draft time without parsing the full YAML. This should be a D1 table.

3. **No sent-folder watch state table.** If sent-folder watching (§10.4 Path A) is opt-in per customer, there must be a record of: which skills have it enabled, the last-checked Sent folder cursor (to avoid reprocessing), and the scope constraints active. Without this state in D1, the watching process has no persistent cursor.

4. **No escalation event log.** §7.3 shows an `escalation` block in `customer.yaml` with `red_flag_recipients`. There is no D1 table recording when escalations were triggered, to whom, whether acknowledged, and outcome. This is both a compliance need and a Captain operational need.

### R2 object naming conventions (not specified in PRD)

R2 has no native hierarchy, only key namespaces. The PRD says R2 stores "markdown vault — narrative knowledge, voice samples, past edit-diff exemplars, large unstructured artifacts" and "drafts, generated documents, exported memory packages." Without a key naming convention, the decommissioning script cannot enumerate and delete all customer objects.

Proposed convention (for PRD to adopt or revise):

```
{customer-slug}/drafts/{draft-id}.md
{customer-slug}/drafts/{draft-id}.sent.md       (post-approval version)
{customer-slug}/voice-samples/{sample-id}.md
{customer-slug}/vault/process/{document-id}.md
{customer-slug}/vault/corrections/{correction-id}.md
{customer-slug}/vault/exports/{export-id}.zip
{customer-slug}/audit-exports/{export-id}.json
```

**The decommissioning script must list all keys with prefix `{customer-slug}/` and delete them.** This requires a defined prefix convention. The PRD does not have one.

### Vectorize namespace naming (not specified in PRD)

Cloudflare Vectorize is a global service; indexes are per-account, not per-Machine. The current architecture ("per-customer storage isolation") must therefore use per-customer Vectorize index names, not a shared index with customer-slug metadata filtering. A shared index with metadata filtering would allow a query from one customer's Machine to technically receive vectors indexed under another customer's slug if the filter is dropped — which directly violates invariant #7.

Required convention:

```
Index name pattern: hermes-{customer-slug}-vault
                    hermes-{customer-slug}-corrections
```

This means N customers = N\*2 Vectorize indexes (minimum). Cloudflare's current Vectorize limits (100 indexes per account on paid plans as of 2026) must be validated against the scale target before committing. At 50 customers, this is 100+ indexes. This is a scaling constraint the PRD does not surface.

---

## API Surface

### Capability interface contracts

The PRD names 11 capability interfaces (§7.2) but provides only one concrete example (`PracticeManagement.create_matter`). Skills cannot be authored and adapters cannot be written without the full method signatures. The following is what Phase 1 minimally requires — the PRD must either adopt these or define alternatives before build begins.

**PracticeManagement**

```typescript
interface PracticeManagement {
  // Matter operations
  search_matters(query: MatterQuery): Promise<Matter[]>
  get_matter(id: string): Promise<Matter | null>
  create_matter(input: CreateMatterInput): Promise<Matter>
  update_matter(id: string, updates: Partial<MatterUpdate>): Promise<Matter>

  // Contact operations
  search_contacts(query: ContactQuery): Promise<Contact[]>
  get_contact(id: string): Promise<Contact | null>
  create_contact(input: CreateContactInput): Promise<Contact>

  // Time / billing entries (read-only in v1 except for draft creation)
  list_time_entries(matter_id: string, range: DateRange): Promise<TimeEntry[]>
  create_time_entry_draft(input: TimeEntryInput): Promise<TimeEntry>

  // Document operations within the PM system
  list_matter_documents(matter_id: string): Promise<DocumentRef[]>
  upload_matter_document(matter_id: string, doc: DocumentUpload): Promise<DocumentRef>

  // Adapter metadata (for health checks and capability disclosure)
  describe_capabilities(): CapabilitySet
  health_check(): Promise<HealthStatus>
}

type MatterQuery = {
  client_name?: string
  matter_type?: string
  status?: MatterStatus
  date_range?: DateRange
  limit?: number
  offset?: number
}

type MatterStatus = 'open' | 'closed' | 'pending' | 'intake'

// NOTE: Matter, Contact, TimeEntry are vertical-generic.
// Practice-area-specific fields live in Matter.custom_fields: Record<string, unknown>
// Adapters populate what the system exposes; skills must not assume any custom_field is present.
```

**Email**

```typescript
interface Email {
  // Inbox watching (poll or webhook depending on adapter)
  list_threads(query: ThreadQuery): Promise<EmailThread[]>
  get_thread(thread_id: string): Promise<EmailThread>

  // Draft operations (reviewer-as-sender pattern enforced here)
  create_draft(input: DraftInput): Promise<DraftRef>
  update_draft(draft_id: string, updates: DraftUpdate): Promise<DraftRef>
  // NOTE: No send method. Drafts go to the reviewer's drafts folder.
  // The reviewer sends from their own email client. No programmatic send.

  // Label / folder operations
  apply_label(thread_id: string, label: string): Promise<void>
  move_to_folder(thread_id: string, folder: string): Promise<void>

  // Sent-folder watching (opt-in; only called when customer.yaml enables it)
  list_sent_since(cursor: string): Promise<SentItem[]>
  get_sent_item(message_id: string): Promise<SentItem>

  // Scope enforcement (adapter enforces; skill never bypasses)
  get_scoped_folders(): string[] // returns only customer.yaml-allowed folders
}

// CRITICAL: The DraftInput must route to the REVIEWER'S drafts folder,
// not to any agent-owned mailbox. The AgentMail address is for INTERNAL
// comms only (§7.8, §19). Adapters must enforce this routing.
type DraftInput = {
  reviewer_account_id: string // the human sender's account, not the agent's
  to: string[]
  cc?: string[]
  subject: string
  body_html: string
  body_text: string
  thread_id?: string // null for new threads
  matter_ref?: string // for audit correlation
}
```

**ESign**

```typescript
interface ESign {
  // Envelope status monitoring
  list_envelopes(query: EnvelopeQuery): Promise<Envelope[]>
  get_envelope(envelope_id: string): Promise<Envelope>

  // Reminder drafting (reviewer-as-sender pattern: agent drafts reminder,
  // reviewer sends or approves automated reminder)
  create_reminder_draft(envelope_id: string, input: ReminderInput): Promise<DraftRef>

  // Document retrieval (completed envelopes)
  download_completed(envelope_id: string): Promise<Buffer>

  // NOTE: No send_envelope method. Agent never initiates signing flows.
  // The reviewer initiates; agent tracks and chases.
}
```

**Issue — the PRD conflates two distinct patterns without naming them:**

- Pattern A: Agent creates a draft in the reviewer's email drafts folder. Reviewer opens their Outlook, sees the draft, edits, and presses Send. The agent has no visibility into whether it was sent (unless sent-folder watching is enabled).
- Pattern B: Agent surfaces a pending action in the dashboard Queue. Reviewer clicks Approve in the dashboard. The platform's backend sends the email (or triggers the e-sign) programmatically on the reviewer's behalf.

These are architecturally different. Pattern A requires only a `create_draft` method. Pattern B requires an orchestrated send path where the platform holds the reviewer's OAuth token for the send action and makes a programmatic API call on approval click. The PRD does not distinguish between them, but they have different trust, security, and OAuth-scope implications. Phase 1 must specify which pattern is the primary.

**CourtAccess** (read-only, no draft/write methods)

```typescript
interface CourtAccess {
  search_cases(query: CaseQuery): Promise<CaseResult[]>
  get_docket(case_id: string): Promise<Docket>
  get_docket_entries(case_id: string, range: DateRange): Promise<DocketEntry[]>
  // NOTE: Citation filtering is NOT this interface's responsibility.
  // The citation-refusal filter (invariant #6, §9) runs on ALL outputs
  // before surfacing to any skill or draft surface — including any content
  // retrieved via this interface. CourtAccess is a raw data retrieval layer.
}
```

**The remaining 7 interfaces (Calendar, DocumentStorage, Payments, Accounting, IntakeCRM, CallTracking, InternalComms)** are not specified in this contribution but must be defined to the same level of detail before Phase 1 adapter implementation begins. The PRD currently has them as names only.

### The `provision-customer.sh` and `decommission-customer.sh` contracts

These scripts are Phase 1 deliverables (§20 Phase 1) but the PRD specifies no contract for either. At minimum the specs must define:

**`bin/provision-customer.sh {customer-slug}`**

```
Input:
  - customer-slug: string matching ^[a-z0-9-]+$
  - customer.yaml must exist at config/customers/{customer-slug}.yaml
  - Dry-run flag: --dry-run (prints plan, makes no changes)
  - Secret injection strategy: reads from Infisical at path
    /ai-employee/{customer-slug}/ — never from customer.yaml directly

Steps (ordered, each must succeed before proceeding):
  1. Validate customer.yaml against schema (see schema section)
  2. Provision Fly.io Machine with config/fly/hermes-template.toml,
     substituting customer-slug; capture machine_id
  3. Create D1 database hermes-{customer-slug}-d1; run migrations/
  4. Create R2 bucket hermes-{customer-slug}-r2
  5. Create Vectorize indexes hermes-{customer-slug}-vault and
     hermes-{customer-slug}-corrections
  6. Bind D1 + R2 + Vectorize to the Machine (Fly.io volumes or
     Cloudflare binding mechanism — TBD per ADR)
  7. Register Composio connections per customer.yaml connectors
  8. Provision AgentMail mailbox for internal-comms persona presence
  9. Write machine_id + db_id + bucket_id + index_ids to
     config/customers/{customer-slug}.state.json (git-ignored,
     Captain-local state file)
  10. Run safety invariant smoke tests (1-8); fail and alert if any fail
  11. Record provision event to platform audit log (cross-customer
      Captain-level log, not the per-customer D1 log)

Output:
  - Exit 0: provisioning complete, all smoke tests passed
  - Exit 1: provisioning failed; state.json reflects partial state;
    Captain must manually clean up or run decommission-customer.sh
  - Exit 2: validation error in customer.yaml (printed to stderr)

Idempotency: The script must be idempotent. Running it twice on an
existing customer must not create duplicate resources. Steps 2-8 must
check for existence before creating.
```

**`bin/decommission-customer.sh {customer-slug}`**

```
Input:
  - customer-slug: string
  - --confirm flag required (no default destructive action)
  - --export-first flag: runs memory export before deletion
  - Reads config/customers/{customer-slug}.state.json for resource IDs

Steps (ordered — order matters for data integrity):
  1. Set agent stop signal in D1 (prevents new drafts during deletion)
  2. Drain draft_queue: mark all pending drafts expired; write final
     audit_log entries
  3. Export memory package to R2 (even without --export-first;
     export is stored as {customer-slug}/vault/exports/final-{ts}.zip)
  4. Notify customer (email from Captain) that decommission is in progress;
     download link for export valid for 30 days
  5. Delete all Vectorize vectors (list + batch-delete by customer-slug prefix)
  6. Delete all R2 objects (list + delete with prefix {customer-slug}/)
     EXCEPT the final export zip (kept for 30-day retrieval)
  7. Delete D1 database (this also deletes all tables and rows)
  8. Deregister Composio connections
  9. Release AgentMail mailbox
  10. Stop and destroy Fly.io Machine
  11. Archive customer.yaml to config/customers/archived/{customer-slug}/
  12. Delete config/customers/{customer-slug}.state.json
  13. Write signed decommission confirmation to platform audit log

Output:
  - Exit 0: decommission complete; confirmation written
  - Exit 1: decommission partially complete; state.json reflects
    remaining resources; Captain must complete manually

The export zip (step 3) is deleted 30 days after decommission
by a separate scheduled cleanup job. The decommission script does
not self-schedule this cleanup — it is a Captain calendar item.
```

**Critical gap the PRD does not address:** What happens if a customer is in the middle of an active draft when decommissioning begins? Step 1 (setting the stop signal) handles new drafts. But an already-in-flight LLM call may complete and attempt to write to D1 after step 7 (D1 deletion). The decommissioning script needs a "drain window" (allow in-flight calls to complete before starting deletion) or a hard kill that sacrifices the in-flight call. The PRD mentions neither.

---

## Non-Functional Requirements

### Performance budgets

The PRD states measured P95 commitments in the demo context (§16.2):

- Connector swap: ≤30s
- Voice calibration scenario draft: ≤8s
- Trust-ceiling promotion: ≤2s

These should be formalized as platform NFRs with measurement methodology:

| Operation                                          | P50 target | P95 target | P99 budget | Measurement method                                  |
| -------------------------------------------------- | ---------- | ---------- | ---------- | --------------------------------------------------- |
| Draft generation (inbox-triage, standard email)    | ≤3s        | ≤8s        | ≤20s       | Audit log timestamps: skill_invoked → draft_created |
| Draft generation (evidence-packet, document-heavy) | ≤30s       | ≤90s       | ≤180s      | Same                                                |
| Trust-ceiling promotion (dashboard action)         | ≤500ms     | ≤2s        | ≤5s        | Dashboard action → D1 write → confirmation          |
| Connector swap (runtime rebind)                    | ≤10s       | ≤30s       | ≤60s       | provision-customer.sh step 7 re-run timing          |
| Memory edit propagation (hard rule)                | ≤1s        | ≤3s        | ≤10s       | D1 write → agent next-invocation verification       |
| Audit log entry write                              | ≤100ms     | ≤500ms     | ≤1s        | D1 write latency                                    |
| Morning digest generation                          | ≤60s       | ≤120s      | ≤300s      | Scheduled trigger → email delivery                  |
| Machine cold start (scale-to-zero)                 | ≤5s        | ≤15s       | ≤30s       | Fly.io boot metrics                                 |
| Memory export (full vault)                         | ≤60s       | ≤5min      | ≤15min     | Export job timing                                   |

**Issue:** The PRD does not specify whether the ≤8s draft target is wall-clock or streaming. If the Hermes response is streamed (tokens arriving progressively), "≤8s" to first token is a very different NFR from "≤8s to complete draft." The demo context implies the partner sees the full draft appear, suggesting complete-draft latency — but this should be stated.

### Security requirements

The PRD is privacy-aware but does not enumerate security controls as requirements. The following are non-negotiable for a product handling privileged legal communications:

**Authentication:**

- Control plane access: Captain authenticates via existing SMD venture auth (Clerk, per CLAUDE.md stack)
- Per-customer Machine SSH: key-based only; no password auth; keys rotated on Captain personnel change
- Connector OAuth tokens: stored in Infisical per `secrets.md` guidance; never in customer.yaml or environment variables in plaintext; injected at Machine boot

**OAuth token handling — a critical gap the PRD does not address:**
The PRD relies on connector OAuth for all external integrations. OAuth access tokens expire (typically 1 hour for Microsoft Graph, Filevine, etc.). Refresh tokens expire if unused (varies: 90 days for Microsoft, indefinite for some others). The PRD does not specify:

- Where refresh tokens are stored (Infisical? D1? R2?)
- Who is responsible for token refresh (Hermes runtime? a sidecar? Captain?)
- What happens when a token refresh fails (the connector goes offline; does the Machine degrade gracefully or throw errors into the draft pipeline?)
- Whether the customer re-authorizes (re-runs OAuth consent) or the Captain handles it

For a product where "connector outage" is a named risk (§18), the OAuth refresh failure path must be specified before Phase 1 ships.

**Data in transit:**

- All API calls from Hermes Machine to external connectors: TLS 1.2+ required; certificate validation enforced; no self-signed certificates accepted
- All internal API calls (control plane → Machines): Fly.io private networking (6PN) where available; mutual TLS otherwise
- D1 / R2 / Vectorize calls: Cloudflare's default TLS (already enforced by the platform)

**Data at rest:**

- R2 objects: encrypted at rest (Cloudflare default; no additional application-layer encryption in v1)
- D1 rows: encrypted at rest (Cloudflare default)
- Fly.io Machine volumes: encrypted at rest (Fly.io AES-256 default)
- customer.yaml: git-committed (config/customers/ path); must not contain any secret values. All secrets injected from Infisical at provision and runtime. This is an absolute requirement; the schema section below enforces it.

**Audit log integrity:**

- The audit log is described as "immutable rows" (§10.1). D1 does not enforce immutability at the database layer — a compromised Hermes process can DELETE from audit_log. True immutability requires either: (a) write-once append-only semantics enforced at the application layer with no DELETE/UPDATE permission granted to the agent runtime, or (b) a secondary write to an append-only external log (e.g., Cloudflare Logpush). The PRD assumes immutability but does not specify how it is enforced.

### Scalability targets

| Dimension                                 | Phase 1 (1 customer) | Phase 4 (≥3 customers) | Phase 5 (10+ customers)       |
| ----------------------------------------- | -------------------- | ---------------------- | ----------------------------- |
| Concurrent Machines                       | 1                    | 3-5                    | 10-20                         |
| D1 databases                              | 1                    | 3-5                    | 10-20 (per Cloudflare limits) |
| R2 buckets                                | 1                    | 3-5                    | 10-20                         |
| Vectorize indexes                         | 2                    | 6-10                   | 20-40                         |
| Composio connections                      | 4-8                  | 12-40                  | 40-160                        |
| Draft volume per customer (heavy profile) | 150/wk               | 150/wk                 | 150/wk                        |
| Audit log rows per customer per month     | ~10,000              | ~10,000                | ~10,000                       |

**Cloudflare D1 limit check:** D1 supports up to 50,000 databases per account on Workers Paid. Phase 1 well within limits. At 10,000 customers (hypothetical), this becomes a constraint — not relevant for Phase 1 but worth noting.

**Vectorize index count (noted above):** 100 index limit on Cloudflare's standard paid tier. At 50 customers with 2 indexes each = 100 indexes. Must confirm the actual limit applies to the account type SMD will provision. This is a Phase 4 constraint, not a Phase 1 blocker.

---

## Technical Risks

### Risk 1: OAuth token lifecycle is unspecified (SEVERITY: HIGH)

**What's missing:** The entire OAuth token management lifecycle — storage of refresh tokens, refresh scheduling, failure handling, and customer re-authorization path — is absent from both PRDs.

**Why it's high severity:** The product's core value proposition depends on real-time connector access. If the Microsoft Graph token expires overnight and isn't refreshed before the 8am morning digest, the partner gets a failure email instead of their "5 drafts pending" summary. At beta-1 day 3, this destroys trust. At demo day, it kills the meeting.

**Mitigation required before Phase 1:** Define the OAuth token lifecycle in a dedicated architecture doc or ADR. Specify token storage (Infisical recommended, consistent with secrets.md), refresh timing (refresh 10 minutes before expiry), failure handling (graceful degradation to "connector unavailable" state, Captain alert, customer notification), and re-authorization path (Captain-initiated OAuth re-consent flow).

### Risk 2: `customer.yaml` has no schema validation or secret-hygiene enforcement (SEVERITY: HIGH)

**What's missing:** The PRD provides one example `customer.yaml` (§7.3) but no formal schema, validation contract, or explicit prohibition on secret values.

**Why it's high severity:** `customer.yaml` is described as git-committed configuration (implied by "changes redeploy with the same script" and it being the "single source of truth"). If someone adds a connector token to `customer.yaml` in a moment of operational pressure, a secret lands in git history permanently. For a law firm customer where the connector token gives access to all client matters, this is a privilege breach with bar-discipline consequences.

**Mitigation required before Phase 1:** Define a JSON Schema or YAML schema for `customer.yaml`. Add a pre-commit hook that rejects any `customer.yaml` containing values matching known secret patterns (tokens, keys, passwords — following the venture's existing secrets.md guidance). Define a clear convention: `customer.yaml` contains references to secret names (e.g., `connector_token_ref: "filevine-oauth-{customer-slug}"`) and `provision-customer.sh` resolves the values from Infisical.

**Schema skeleton (the PRD example needs explicit typing):**

```yaml
# SCHEMA: customer.yaml
# All fields below are REQUIRED unless marked optional.
# NO secret values in this file. Use {service}-{customer-slug} ref patterns.

customer: <string> # slug: ^[a-z0-9-]+$; must match directory name
vertical: <enum> # 'law-firm' | (future verticals)
practice_areas: <list> # validated against vertical's practice area registry
region: <string> # Fly.io region slug (e.g., 'iad', 'lax', 'ord')

persona:
  name: <string> # human first name; max 50 chars
  title: <string> # e.g. "AI Associate" | "AI Operations Coordinator"
  signature_html: <string> # [OPTIONAL] full HTML; generated by provision if absent
  avatar_url: <string> # [OPTIONAL] https URL to SMD-hosted image
  tone: <string> # 3-5 adjective string; free text

connectors:
  <CapabilityName>: <adapter-slug> # e.g. Email: microsoft-graph
  # CapabilityName must be a registered capability interface name
  # adapter-slug must exist in ai-employee/connectors/{capability}/{adapter}/

skills:
  - <skill-name>:
      trust: <enum> # 'autonomous' | 'draft_for_review' | 'disabled'
      scope: <list> # [OPTIONAL] list of scope tags from scope section

scope:
  email_folders_visible: <list> # [OPTIONAL] defaults to all folders
  email_folders_blind: <list> # [OPTIONAL]
  email_keyword_blocks: <list> # [OPTIONAL]
  domain_blocks: <list> # [OPTIONAL]

escalation:
  red_flag_recipients: <list> # email addresses; at least one required
  failure_recipients: <list> # email addresses; at least one required

business_hours: # [OPTIONAL] defaults to M-F 8am-6pm local
  timezone: <IANA tz>
  days: <list>
  start: <HH:MM>
  end: <HH:MM>

# Fields NOT allowed in customer.yaml:
# - Any field containing 'token', 'secret', 'key', 'password', 'credential'
# - Any field whose value looks like a JWT, base64 blob, or UUID secret pattern
# These belong in Infisical at path /ai-employee/{customer-slug}/
```

### Risk 3: The skill loader reference-loading issue is deferred too far (SEVERITY: MEDIUM)

**PRD acknowledgment:** §8.4 explicitly notes "Hermes' current skill loader surfaces description at invocation time but doesn't reliably load references" and calls this "Phase A.6 discipline" — the workaround being to front-load voice rules in the SKILL.md description itself.

**Why this is a medium risk, not just a known tradeoff:** The workaround (front-loading voice rules in description) creates two problems:

1. **SKILL.md description length bloat.** If every skill front-loads its voice rules, the invocation-time context injection grows. At 5-7 active skills, each with 200-400 words of voice rules in the description, the per-draft context overhead is 1,000-2,800 tokens of voice rules alone — before any matter content, memory context, or output specification. At the "heavy" customer profile (150 drafts/week), this adds meaningful token cost that is not captured in the Phase 1 cost model.

2. **Voice rule maintenance divergence.** The canonical voice rules in `references/voice.md` and the front-loaded copy in `SKILL.md` description will diverge if voice rules are updated. There is no mechanism to enforce they stay synchronized. A voice rule update that is applied to `references/voice.md` but not to the SKILL.md description results in silent voice regression.

**Recommendation for Phase 1:** Do not defer the loader fix to Phase 5. It is a two-part fix — (a) load references at invocation time; (b) remove duplicated voice rules from descriptions after the loader is fixed. Estimate: 1-2 days of engineering. The cost and drift risks of the workaround accumulate from the first customer day.

### Risk 4: Invariant #7 boot-time check has no implementation spec (SEVERITY: HIGH)

**What §7.5 says:** "At Machine boot, the runtime verifies its storage bindings include only its own customer's namespaces and refuses to start if it detects bindings outside its namespace."

**What's not specified:**

- What constitutes a "storage binding" in the runtime's view? A Fly.io volume mount? A Cloudflare binding in the Worker config? An environment variable pointing to a D1 database ID?
- How does the runtime know what "its own customer's namespace" is? By comparing the D1 database name to the customer slug in customer.yaml? If so, what is the comparison rule?
- What does "refuse to start" mean operationally? Throw an exception and exit? Write to a health endpoint? Alert Captain? The PRD says the Machine "refuses to start" but does not specify the failure mode.
- Who tests this check? The PRD mentions "CI gate on shared catalog merges" (§18) but not a per-customer-provisioning invariant verification step.

**Without implementation clarity, this invariant exists on paper only.** The boot-time check is the strongest architectural enforcement of customer isolation — but if it is only a prose description in a PRD, it provides no actual enforcement.

**Recommended spec addition:** Write a concrete test: "Given a Machine provisioned for customer A, when the runtime reads its D1 binding and finds a database named `hermes-customer-B-d1`, the runtime must exit with code 3 and write `INVARIANT_7_VIOLATION` to stdout before processing any requests."

### Risk 5: Invariant #8 enforcement mechanism is circular for skill-generated drafts (SEVERITY: MEDIUM)

**What §7.5 says:** "The skill catalog's authoring template enforces this [fabrication discipline]; the `context-detector` skill flags drafts that include suspect fields for partner verification."

**The circularity:** `context-detector` is itself a skill (§8.2). Skills run in the Hermes agent runtime. If the runtime is how invariant #8 is enforced, then invariant #8 enforcement is a skill calling another skill — which means it is subject to the same skill loader, skill state, and trust ceiling mechanics as any other skill. If `context-detector` has `trust: disabled` or has a bug that prevents it from running, invariant #8 has no enforcement.

**The safer pattern:** Invariant #8 should be enforced as a **pre-output filter** at the runtime level, not as a skill call. Similar to the citation-refusal substrate (invariant #6), which runs as a filter on "every agent output before it reaches a draft surface" (§9.3), invariant #8 should be a runtime filter that pattern-matches fabrication indicators (plausible-but-uncited dollar amounts, dates, commitments, named persons) and blocks or flags the draft before it reaches the Queue. The `context-detector` skill can be a supplementary check, but the primary enforcement must not depend on a skill being enabled and running correctly.

### Risk 6: Cost telemetry has no event emission spec (SEVERITY: MEDIUM)

**§15.1 describes what to track** (a solid list of 9 cost drivers) and **what to model** (three customer profiles). It does not describe how the data is emitted and collected.

**Specific gaps:**

- Claude API token costs: Anthropic's API returns token counts in the response. Does Hermes capture this per-call and write to `cost_telemetry`? Or does it rely on Anthropic's billing dashboard, which is per-account, not per-customer?
- Fly.io Machine baseline: Fly.io billing is account-level, not per-Machine-tagged-by-customer. Without explicit resource tagging (Machine name = `hermes-{customer-slug}`), correlating Fly.io charges to customers requires a naming convention — which the PRD has (good) but has no automated extraction script for.
- Composio per-action billing: Composio provides usage data via API. Is there a nightly job that pulls Composio usage by connection ID (per customer) and writes to `cost_telemetry`?
- Captain operations time: "Tied to customer complexity + incident frequency." This is the one cost driver that requires manual input. There must be a mechanism for Captain to log time against a customer (a simple CLI command writing to `cost_telemetry`) — otherwise this row is always empty and the margin model is incomplete.

**Without event emission**, the Phase 1 cost telemetry requirement (§20 Phase 1: "Cost telemetry instrumented per §15.1") will be marked "done" when a table exists in D1, but will contain no data.

---

## Open Decisions / ADRs

### ADRs the PRD flags as needed (§19) — confirming these are load-bearing for Phase 1

The following nine proposed ADRs from §19 are all Phase 1 dependencies, not Phase 4 niceties. They should be drafted before Phase 1 build begins, not after:

1. **Reviewer-as-sender architecture** — needed before Email adapter is written
2. **Capability-interface + adapter pattern** — needed before any adapter is written
3. **Per-customer Machine isolation** — needed before provisioning script is written
4. **Memory as customer-owned, editable, exportable artifact** — needed before D1 schema is locked
5. **Cross-Machine query prohibition (invariant #7)** — needed before invariant is implemented
6. **Fabrication discipline (invariant #8)** — needed before citation-refusal filter is positioned as the enforcement mechanism
7. **Sent-folder watching as opt-in with structural-diff-only storage** — needed before Email adapter is written (DPA implications)
8. **Voice quality gates** — needed before first external draft is scheduled
9. **Captain operational budget and backup-operator gate** — needed before customer #1 onboarding

### Additional ADRs identified in this review (not in §19)

**ADR (proposed) — OAuth token lifecycle management:**
Storage location (Infisical), refresh timing and retry policy, failure handling (graceful degradation vs. Machine restart), and customer re-authorization flow. Phase 1 blocking.

**ADR (proposed) — Audit log immutability enforcement:**
D1 does not enforce append-only at the storage layer. The ADR must specify: whether a separate append-only log (Cloudflare Logpush, external SIEM) is required for v1, or whether application-layer enforcement (no DELETE/UPDATE in Hermes code, verified by code review) is sufficient for beta-1. Has compliance implications: if a customer's ethics counsel asks "can the AI Employee operator alter the audit log," the answer must be architecturally grounded, not "we just don't do that."

**ADR (proposed) — Scale-to-zero policy for Fly.io Machines:**
Always-on vs. scale-to-zero affects: cost (always-on ~$20-40/mo/Machine at minimum; scale-to-zero near-zero when idle), cold-start latency (2-10s), and the morning digest reliability (must be running at 8am regardless of overnight activity). For Phase 1 with one customer, always-on is affordable and removes the cold-start risk. The ADR should record this decision.

**ADR (proposed) — Vectorize index naming and per-customer isolation:**
Specifies the naming convention, confirms the per-customer-index model (not shared index with metadata filtering), validates the Vectorize index count limits against the scale target, and records the rationale.

**ADR (proposed) — `customer.yaml` secret-exclusion policy:**
Formalizes that `customer.yaml` is git-committed, secret-free configuration; defines the reference pattern for secret values; specifies the pre-commit validation hook. Cross-references secrets.md guidance.

### Open technical decisions that are not ADR-shaped but need resolution

**Control plane / data plane separation:** Where does the Captain control plane run (separate app vs. sidecar vs. in-process)? The control plane must be able to reach all customer Machines for emergency-stop without those Machines being able to reach each other. The answer affects the invariant #7 enforcement architecture.

**Composio session model:** Composio manages OAuth connections by connection ID. Is one Composio connection per customer per capability, or can multiple customers share a Composio app? If shared app, the per-customer isolation of Composio actions must be enforced at the Composio API layer (connection IDs are per-customer) — but this must be verified against Composio's data model.

**Dashboard hosting:** The PRD describes a "dashboard" (§12) but does not specify where it is hosted. The existing SMD venture uses Astro SSR on Cloudflare Workers (per CLAUDE.md). Is the AI Employee dashboard part of the same Astro app (e.g., `admin.smd.services/ai-employee/{customer-slug}/`)? Or a separate Astro deployment? This is a Phase 1 dependency.

**AgentMail binding to Machine:** §7.8 states AgentMail is for "internal-facing presence." How is the AgentMail mailbox bound to a specific Hermes Machine instance? When an internal Slack message comes in addressed to the agent persona, which Machine processes it — and how does AgentMail route to that Machine? The routing architecture is not specified.

---

## Cross-PRD Contradictions

### Contradiction 1: Phase 1 skill count mismatch

**Platform PRD §20 Phase 1:** "5-7 skills, not 30."

**Law-firm PRD §17 Phase 1:** Lists the following as Phase 1 scope:

- 6 universal primitives (as scaffolds, 3-4 enabled)
- `inbox-triage-and-draft`, `morning-digest`, `memory-curator`, `compliance-audit-export` (4 cross-cutting skills enabled)
- `pi-intake-triage` (1 PI skill minimum)
- Citation-refusal substrate (infrastructure, not a skill, but authoring overhead)
- 4 law-firm-specific cross-cutting skills authored (law-court-context-detector, law-engagement-letter-jurisdictional, law-privilege-scope-guard, law-compliance-audit-export)

If "authored as scaffolds" counts, Phase 1 involves authoring 6 primitives + 4 cross-cutting + 4 law-specific cross-cutting + 1 PI overlay = 15+ skill files. If "5-7 skills" means "active/enabled" only, the count may be consistent — but the authoring overhead for scaffolded skills is real and should not be invisible to planning. The PRDs should align on what "5-7 skills" means: authored, scaffolded, or enabled.

### Contradiction 2: `pi-demand-letter-text-only` status

**Law-firm PRD §0 (scope):** "PI specialized skills: minimum is `pi-intake-triage`; `pi-demand-letter-text-only` only if Captain authorizes the legal-sensitivity risk in advance."

**Law-firm PRD §16 Open Decisions:** "Demand-letter scope on launch. `pi-demand-letter-text-only` ships in v1 of the PI overlay, but it's the most legally-sensitive operational skill. Captain decision: do we ship it with the first demo, or hold for beta-1?"

**Law-firm PRD §6.2:** `pi-demand-letter-text-only` is listed as "Pulled from v1, deferred to Phase 3+" and replaced by `pi-demand-letter-evidence-packet`.

These three sections say three different things about the same skill. §0 treats it as possible-with-authorization. §16 treats it as a live open decision. §6.2 treats it as deferred. The synthesis pass should resolve this to a single authoritative position. The Technical Lead's recommendation: §6.2's evidence-packet replacement is the correct v1 call; §0 and §16 should be updated to match.

### Contradiction 3: Voice quality gate calibration session duration

**Platform PRD §9.6 Gate 2:** "A scheduled 4-6 hour Captain session with the customer (typically the reviewer + designated operator)."

**Law-firm PRD §11.9:** "The platform's voice quality gates (§9.6) require: ≥30 anchor samples + 4-6 hour calibration session... For law-firm beta-1, this work is split between partner and paralegal: Partner session (90 minutes maximum)... Paralegal session (4-6 hours, with Captain)."

These are not contradictory (the law-firm PRD is correctly overriding the platform default for law-firm context), but the platform PRD does not have an extension point that says "vertical PRDs may split the calibration session." A reader of the platform PRD alone would believe the 4-6 hours is the partner's time. The platform PRD should state that vertical PRDs may specify how the calibration session is structured within the time budget.

### Contradiction 4: Litify adapter pre-build scope

**Law-firm PRD §7.2 Tier-1 table:** Litify is listed with "Read-only adapter shipped in v1 pre-build; write capability in Phase 2."

**Law-firm PRD §7.5 pre-build sequence:** Litify does not appear in the 15-item priority list. It also appears in the "build-when-discovered" list earlier in §7.2 ("Litify (via Salesforce REST + Docrio)").

These three references are inconsistent. If the read-only adapter is a v1 pre-build, it should appear in §7.5. If it's build-when-discovered, the table entry should say so. The table in §7.2 was added per Devil's Advocate critic feedback but was not reconciled with the pre-build sequence.

---

## Summary of Blocking Items (Phase 1)

The following must be resolved before Phase 1 implementation begins:

| #   | Item                                                            | Blocking what                              | Owner               |
| --- | --------------------------------------------------------------- | ------------------------------------------ | ------------------- |
| 1   | OAuth token lifecycle ADR                                       | Email, Calendar, all connector adapters    | Tech Lead           |
| 2   | Capability interface method signatures (all 11)                 | All adapter implementation                 | Tech Lead           |
| 3   | `customer.yaml` formal schema with secret-exclusion validation  | provision-customer.sh, all adapter binding | Tech Lead           |
| 4   | Invariant #7 concrete implementation spec                       | Safety substrate boot sequence             | Tech Lead           |
| 5   | Invariant #8 runtime-filter implementation spec                 | All draft generation                       | Tech Lead           |
| 6   | `bin/decommission-customer.sh` step spec including drain window | Phase 1 compliance requirement             | Tech Lead           |
| 7   | R2 object key naming convention                                 | decommissioning, export, vault operations  | Tech Lead           |
| 8   | Vectorize index naming + per-customer isolation confirmation    | Memory retrieval, cross-customer isolation | Tech Lead           |
| 9   | Control plane / data plane separation architecture              | invariant #7 enforcement, emergency-stop   | Tech Lead + Captain |
| 10  | Dashboard hosting decision (Astro app location)                 | Dashboard tab implementation               | Tech Lead + Captain |
| 11  | Cost telemetry event emission spec                              | §17.1 per-customer COGS/MRR kill criterion | Tech Lead           |
| 12  | D1 `voice_samples` and `draft_queue` table definitions          | Voice gate enforcement, draft routing      | Tech Lead           |

Items 1-11 map to ADRs or spec artifacts that can be authored in 1-2 days each. They are not blocking in the sense of requiring external dependencies — they block because the code cannot be written correctly without them. The recommendation is to resolve all 12 before the first adapter is merged.

---

_End of Technical Lead Contribution — PRD Review Round 1_
