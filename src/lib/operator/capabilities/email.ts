/**
 * Email capability — watch inboxes, read threads, create drafts, apply
 * labels, watch the sent folder.
 *
 * Send is a configurable entitlement (ADR 0035), not a fixed posture. An
 * adapter MAY expose a send method; whether a send executes autonomously,
 * routes to a reviewer draft, or is refused is decided at runtime by
 * `trust_ceiling.enforce()` per the authored EXTERNAL_SEND ceiling
 * (fail-closed when unauthored). The draft-for-review external send posture
 * (ADR 0035) is one authored option among several — the agent is not
 * categorically barred from an autonomous send path; the engagement authors
 * the posture. This interface currently ships create/update-draft methods; a
 * send method is added per adapter as the configured entitlement requires.
 *
 * Implemented by adapters for Microsoft Graph (Outlook), Google
 * Workspace (Gmail), IMAP/SMTP (rare), and any future vendor.
 */

import type { AdapterBase, DateRange } from './types'

// ---------------------------------------------------------------------------
// Threads and messages
// ---------------------------------------------------------------------------

export interface EmailAddress {
  email: string
  /** Display name when the vendor provides one. */
  name: string | null
}

export interface EmailMessage {
  id: string
  thread_id: string
  from: EmailAddress
  to: EmailAddress[]
  cc: EmailAddress[]
  bcc: EmailAddress[]
  subject: string
  /** Raw body in the format the vendor provided. Adapters MAY normalize
   * to text-only and set body_html to null; skills receive whichever the
   * adapter populates. */
  body_text: string | null
  body_html: string | null
  /** ISO 8601 timestamp. */
  sent_at: string
  /** Labels / folders the vendor reports for this message. */
  labels: string[]
}

export interface EmailThread {
  id: string
  subject: string
  participants: EmailAddress[]
  messages: EmailMessage[]
  /** ISO 8601 timestamp of the most recent message in the thread. */
  last_message_at: string
  labels: string[]
  /** When the adapter cannot return the full message list (e.g. Gmail's
   * limit), this is the unread/oldest cursor for follow-up reads. */
  next_cursor: string | null
}

export interface ThreadQuery {
  /** Folder name in the reviewer's mail UI (e.g. "Inbox", "Clients"). */
  folder?: string
  /** Free-form text search; adapters translate to the vendor's search
   * syntax. */
  search?: string
  /** Sender email filter. */
  from?: string
  /** Recipient email filter. */
  to?: string
  date_range?: DateRange
  /** Only threads matching at least one of these labels. */
  any_labels?: string[]
  limit?: number
  /** Cursor from a prior list_threads response. */
  cursor?: string
}

// ---------------------------------------------------------------------------
// Drafts — draft-for-review contract
// ---------------------------------------------------------------------------

/**
 * Draft input. CRITICAL: per ADR 0005, the `reviewer_account_id` MUST
 * resolve to the human reviewer's email account, not the agent's
 * AgentMail identity. Adapters that cannot enforce this routing must
 * throw `validation_failed` at construction; they must not silently
 * route to the agent's account.
 */
export interface DraftInput {
  /** The human reviewer's account ID as known to the adapter. */
  reviewer_account_id: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  body_html: string
  body_text: string
  /** When null, this is a new thread. When set, the draft is a reply
   * within the named thread. */
  thread_id?: string | null
  /** Audit correlation: the matter the draft pertains to, when known.
   * Surfaces in the dashboard "what Marcus used" sourcing block. */
  matter_ref?: string | null
  /** Skill that authored the draft. Audit-required. */
  drafted_by_skill: string
}

export interface DraftRef {
  id: string
  /** The thread the draft sits in (existing thread for replies, new
   * thread ID for new conversations). */
  thread_id: string
  /** Where in the reviewer's UI the draft is visible (vendor-specific
   * folder path). */
  folder: string
  /** ISO 8601 timestamp. */
  created_at: string
  /** ISO 8601 timestamp; null until the reviewer edits it. */
  last_edited_at: string | null
}

export interface DraftUpdate {
  to?: string[]
  cc?: string[]
  bcc?: string[]
  subject?: string
  body_html?: string
  body_text?: string
}

// ---------------------------------------------------------------------------
// Sent-folder watching (optional capability)
// ---------------------------------------------------------------------------

export interface SentItem {
  message_id: string
  thread_id: string
  to: EmailAddress[]
  cc: EmailAddress[]
  subject: string
  body_text: string | null
  body_html: string | null
  sent_at: string
  /** Whether this sent item appears to have originated from an
   * agent-drafted message (heuristic; null when the adapter cannot
   * determine). */
  likely_agent_drafted: boolean | null
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface Email extends AdapterBase {
  // Inbox watching (poll or webhook depending on adapter)
  list_threads(query: ThreadQuery): Promise<EmailThread[]>
  get_thread(thread_id: string): Promise<EmailThread | null>

  /**
   * Create a draft in the REVIEWER'S drafts folder. Per ADR 0005, this
   * is the only outbound surface in the Email interface. Adapters MUST
   * route via the reviewer's account; routing to the agent's AgentMail
   * identity is a critical bug and must throw `validation_failed`.
   */
  create_draft(input: DraftInput): Promise<DraftRef>
  update_draft(draft_id: string, updates: DraftUpdate): Promise<DraftRef>

  // No `send` method ships on this interface today, but adding one is NOT an
  // architectural regression: send is a configurable entitlement (ADR 0035),
  // gated at runtime by `trust_ceiling.enforce()` per the authored EXTERNAL_SEND
  // ceiling (fail-closed when unauthored). A `send()` method is added per adapter
  // when an engagement authors a send posture; draft-for-review external send is
  // one such authored option, not a hard interface constraint.

  // Label / folder operations
  apply_label(thread_id: string, label: string): Promise<void>
  move_to_folder(thread_id: string, folder: string): Promise<void>

  // Sent-folder watching (opt-in; only active when customer.yaml enables it)
  list_sent_since(cursor: string): Promise<SentItem[]>
  get_sent_item(message_id: string): Promise<SentItem | null>

  /**
   * Returns the folders the customer.yaml scope envelope allows reading.
   * Adapters consult their scope binding at boot. Skills never bypass
   * this list — calling `list_threads` with a folder outside this set
   * throws `scope_violation`.
   */
  get_scoped_folders(): string[]
}
