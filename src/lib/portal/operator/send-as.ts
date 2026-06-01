/**
 * Reviewer-as-sender send pathway for the Operator draft queue.
 *
 * Per ADR 0005 (`docs/adr/0005-reviewer-as-sender.md`), every
 * customer-bound external message MUST ship under the human reviewer's
 * identity. The Operator persona ("Marcus", "Sarah", whatever the
 * customer chose) is fully visible internally but has no external
 * sending identity. This module is the only sanctioned path for the
 * portal to send a drafted message — it routes via the reviewer's
 * email account, lands in the reviewer's Sent folder, and records the
 * audit event under the reviewer's actor id.
 *
 * The reviewer-as-sender contract is enforced by the function
 * signature: `sendAsReviewer` takes the `Reviewer` identity as a
 * REQUIRED positional argument. There is no overload that accepts an
 * "agent" or "system" sender. A code path that wants to send without
 * a reviewer cannot compile.
 *
 * **Connector wiring lands across two PRs.** The Microsoft Graph send
 * surface ships in Python at
 * `operator/connectors/ms_graph/send.py:send_draft_as_reviewer`
 * (issue #881, wave-2). The portal Worker reaches the per-customer
 * Hermes Machine via the Hermes bridge that is still tracked in #821.
 * Until the bridge lands, `sendAsReviewer` returns
 * `{ status: 'pending_connector' }` and the audit row is queued. The
 * UI flow is fully working end-to-end — the network send is the only
 * stub. When #821 lands, the body of `dispatchViaConnector` swaps in
 * the bridge call to the Python module; the rest of this module stays
 * put.
 *
 * **Audit emission.** Every send attempt — successful, pending, or
 * failed — emits a `send_approved` event via `recordSendApprovedAudit`.
 * The per-customer Hermes audit_log (see `operator/adapter/audit_log.py`)
 * uses an uppercase vocabulary (DRAFT_APPROVED, etc.) and lives on the
 * Hermes Machine's D1. The portal Worker cannot bind to a per-customer
 * D1 directly, so this module records into a typed `AuditEvent`
 * structure that a Hermes-side drain (tracked in #821 + the audit
 * bridge follow-on) will consume. Until the bridge lands, the event
 * is logged via `console.info` with a stable `[audit]` prefix so it
 * surfaces in Worker tail logs without fabricating a persistence
 * guarantee we cannot honor.
 */

import type { DraftDetail } from './drafts'

/**
 * Identity of the human reviewer approving the send. The send pathway
 * routes via this identity — the reviewer's email account is the
 * sender, the message lands in their Sent folder, and the audit row
 * names them as the approver.
 *
 *   userId       — Portal users.id. Required. Used as the `approver_id`
 *                  in the audit payload.
 *   email        — Reviewer's email address. This is the address the
 *                  message will ship from. Required.
 *   displayName  — Human-readable name for the reviewer (e.g.,
 *                  "Pat Owner"). Surfaced in the confirmation toast
 *                  ("Sent as Pat Owner"). Optional; the email address
 *                  is shown as a fallback.
 *   role         — The reviewer's product role at send time. Either
 *                  'principal' or 'operator'. 'compliance' is read-only
 *                  per ADR 0005 § role gates and cannot reach this
 *                  pathway — the API endpoint enforces that gate
 *                  before constructing a Reviewer.
 */
export interface Reviewer {
  userId: string
  email: string
  displayName: string | null
  role: 'principal' | 'operator'
}

/**
 * Result of a send attempt. The four lifecycle values map 1:1 to the
 * DraftSendStatus vocabulary in drafts.ts:
 *
 *   sent              — Connector confirmed delivery. Draft moves out
 *                       of the queue.
 *   pending_connector — Microsoft Graph OAuth (#822) has not landed
 *                       yet. The audit row is queued, the UI shows
 *                       "sent under [reviewer email]" with a banner
 *                       noting connector pending — no fake success.
 *   failed            — Connector returned an error. Draft returns to
 *                       the queue with `sendStatus: 'send_failed'` and
 *                       the error is surfaced inline.
 *   queued_undo       — Reviewer is within the undo window. The send
 *                       is held; if the window expires without an Undo
 *                       click, the next call commits it. The portal API
 *                       endpoint resolves this state into either `sent`
 *                       or `pending_connector` after the window elapses.
 */
export type SendStatus = 'sent' | 'pending_connector' | 'failed' | 'queued_undo'

export interface SendResult {
  status: SendStatus
  reviewerEmail: string
  sentAt: string | null
  /** Error message when status === 'failed'. null otherwise. */
  error: string | null
}

/**
 * Audit event payload for the `send_approved` action. The portal D1 has
 * no audit table today (no migration owned by this PR; tracked as a
 * follow-on alongside the Hermes audit bridge). The event is emitted
 * as a structured log line with a stable prefix so the Worker tail
 * pipeline can pick it up and forward to the per-customer Hermes D1
 * once the drain ships.
 *
 *   approverId      — users.id of the reviewer
 *   approverEmail   — reviewer's email (the sending identity, ADR 0005)
 *   draftId         — opaque draft identifier
 *   draftHash       — SHA-256 hex of the message body at approve time,
 *                     so the audit row is bound to the exact bytes the
 *                     reviewer saw, not a later edit
 *   reviewerEmail   — duplicated for legibility on tail logs and to
 *                     match the metadata shape the issue specifies
 *                     ({ approver_id, draft_hash, reviewer_email,
 *                        send_window_ms, timestamp })
 *   personaSlug     — Canonical persona slug for the Operator that
 *                     drafted the message (per ADR 0011 §3). Nullable
 *                     at v1 — every customer ships with a single
 *                     persona and the writer populates from
 *                     `customer.yaml.personas[0].slug`. Carried on
 *                     every send audit so Phase 2's multi-persona
 *                     back-fill rule (ADR 0011 §6) has a stable join
 *                     key. The bridge's per-customer Hermes D1 maps
 *                     this to the `audit_log.persona_slug` column.
 *   sendWindowMs    — configured undo window the send was committed
 *                     against (or 0 if Undo was used / send was
 *                     dispatched without an undo window)
 *   timestamp       — ISO 8601 UTC ms when the audit was recorded
 *   sendStatus      — final SendStatus value emitted with this event
 */
export interface SendApprovedAuditEvent {
  approverId: string
  approverEmail: string
  draftId: string
  draftHash: string
  reviewerEmail: string
  personaSlug: string | null
  sendWindowMs: number
  timestamp: string
  sendStatus: SendStatus
}

/**
 * Default undo window in milliseconds. The issue (AC: undo window
 * default 5s, configurable via `customer.yaml` `send.undo_window_seconds`)
 * fixes 5000ms as the launch value. The configurable read path lives
 * on the Hermes side and surfaces through the bridge; the portal
 * accepts the value as a parameter on the send endpoint so the bridge
 * can override per-customer once #821 lands.
 */
export const DEFAULT_UNDO_WINDOW_MS = 5_000

/**
 * Upper bound on the undo window. A hostile customer.yaml that set a
 * 24-hour window would block the queue. 60 seconds is the longest
 * plausible "wait, undo that" window — beyond that the operator
 * should just open a new draft.
 */
export const MAX_UNDO_WINDOW_MS = 60_000

/**
 * Coerce a candidate undo-window value into the safe range. Accepts a
 * number of milliseconds. Negatives and NaN collapse to the default;
 * values above MAX clamp down. Used by the API endpoint when reading
 * a customer.yaml override.
 */
export function clampUndoWindowMs(candidate: number | null | undefined): number {
  if (candidate === null || candidate === undefined) return DEFAULT_UNDO_WINDOW_MS
  if (!Number.isFinite(candidate) || candidate < 0) return DEFAULT_UNDO_WINDOW_MS
  return Math.min(Math.floor(candidate), MAX_UNDO_WINDOW_MS)
}

/**
 * SHA-256 hex digest of the supplied string. Used to bind the audit
 * row to the bytes the reviewer saw at approve time. The Web Crypto
 * API is available in Cloudflare Workers and in the Node test
 * environment via the same `crypto.subtle` surface.
 */
export async function hashDraftBody(bodyPlain: string): Promise<string> {
  const enc = new TextEncoder().encode(bodyPlain)
  const digest = await crypto.subtle.digest('SHA-256', enc)
  const bytes = new Uint8Array(digest)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

/**
 * The one true send pathway for customer-bound messages. Routes the
 * draft via the reviewer's email account per ADR 0005.
 *
 * Connector wiring is pending #822 — today this returns
 * `{ status: 'pending_connector' }`. The function still emits the
 * audit event so the reviewer action is recorded even before the
 * network send lands.
 *
 * @param draft     The draft being approved. Must include the body
 *                  hash-able content; otherwise the audit row cannot
 *                  bind to specific bytes.
 * @param reviewer  REQUIRED. The human approving the send. The
 *                  reviewer's email is the sending identity per
 *                  ADR 0005. There is no overload that allows a null
 *                  or "system" reviewer.
 */
export async function sendAsReviewer(draft: DraftDetail, reviewer: Reviewer): Promise<SendResult> {
  // ADR 0005 invariant: the reviewer's email is the sending identity.
  // The draft carries a `reviewerEmail` field; it should match the
  // resolved reviewer. If a mismatch occurs (rare — only if the draft
  // was staged for a different mailbox than the approver controls),
  // we refuse to send. A draft staged to mailbox X cannot ship under
  // identity Y.
  if (draft.reviewerEmail.toLowerCase() !== reviewer.email.toLowerCase()) {
    return {
      status: 'failed',
      reviewerEmail: reviewer.email,
      sentAt: null,
      error:
        'Reviewer-as-sender mismatch: this draft was staged into a different reviewer mailbox. ' +
        'Have the staged reviewer approve it, or ask your principal to re-stage the draft.',
    }
  }

  return await dispatchViaConnector(draft, reviewer)
}

/**
 * Connector dispatch — bridge call to the per-customer Hermes Machine
 * that holds the reviewer's OAuth grant and invokes
 * `operator/connectors/ms_graph/send.py:send_draft_as_reviewer`.
 *
 * The Python module is the wave-2 reviewer-as-sender concrete impl
 * (issue #881). The portal Worker cannot reach it directly because
 * the per-customer Machine binding is owned by Hermes; the Hermes
 * bridge is the seam, tracked in #821.
 *
 * Today this returns the `pending_connector` sentinel because the
 * bridge has not landed. When #821 ships, replace the body with the
 * bridge call (HTTP POST to the Hermes Machine's internal send
 * endpoint) and translate the Python `SendOutcome` shape into the
 * TS `SendResult` shape. The mapping is 1:1:
 *
 *   Python SendOutcome.status="sent"   -> SendResult.status="sent"
 *   Python SendOutcome.status="failed" -> SendResult.status="failed"
 *
 * The function is split out from `sendAsReviewer` so the validation
 * (reviewer-as-sender invariant, draft integrity) stays in the
 * exported surface and the network call is the one mutation point
 * for the bridge PR.
 */
// eslint-disable-next-line @typescript-eslint/require-await
async function dispatchViaConnector(_draft: DraftDetail, reviewer: Reviewer): Promise<SendResult> {
  // Connector pending. The UI surfaces this honestly — the audit row
  // records the approver action, but no message has gone out yet.
  // When #821 lands, the body of this function changes; nothing else.
  return {
    status: 'pending_connector',
    reviewerEmail: reviewer.email,
    sentAt: null,
    error: null,
  }
}

/**
 * Record the `send_approved` audit event for a draft approval.
 *
 * The per-customer Hermes audit_log (see
 * `operator/adapter/audit_log.py`) is the eventual destination.
 * Today the portal cannot reach it directly — the bridge is the
 * subject of #821 plus a follow-on audit drain issue. Until then,
 * the event is emitted as a structured log line with a stable
 * `[audit:send_approved]` prefix. A Hermes-side worker that drains
 * the portal Worker's tail logs will consume the line and persist
 * to the per-customer D1.
 *
 * The function is async to match the eventual shape (the bridge
 * call will be async) so the call site stays stable when the bridge
 * lands.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function recordSendApprovedAudit(event: SendApprovedAuditEvent): Promise<void> {
  // Stable structured prefix so a tail-log drain can JSON.parse the
  // payload without scraping arbitrary log text. The payload is a
  // single JSON object on one line.
  const line = JSON.stringify({
    type: 'audit:send_approved',
    ...event,
  })
  console.info(line)
}

/**
 * Build a `SendApprovedAuditEvent` from the inputs the API endpoint
 * already has. Exposed for unit-testing the payload shape — the
 * endpoint constructs the event inline.
 */
export function buildSendApprovedAuditEvent(input: {
  approverId: string
  approverEmail: string
  draftId: string
  draftHash: string
  reviewerEmail: string
  personaSlug: string | null
  sendWindowMs: number
  sendStatus: SendStatus
  now?: Date
}): SendApprovedAuditEvent {
  const ts = (input.now ?? new Date()).toISOString()
  return {
    approverId: input.approverId,
    approverEmail: input.approverEmail,
    draftId: input.draftId,
    draftHash: input.draftHash,
    reviewerEmail: input.reviewerEmail,
    personaSlug: input.personaSlug,
    sendWindowMs: input.sendWindowMs,
    timestamp: ts,
    sendStatus: input.sendStatus,
  }
}
