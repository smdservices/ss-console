/**
 * POST /api/portal/ai-employee/drafts/:id/send
 *
 * Approve & Send endpoint for the AI Employee draft queue. Per ADR 0005
 * (reviewer-as-sender), every customer-bound external message ships
 * under the human reviewer's identity. This endpoint is the only
 * portal-side path that triggers the connector send.
 *
 * Authorization:
 *   - Clerk session present                (middleware)
 *   - Local entity bound to Clerk org      (resolveAiEmployeeAccess)
 *   - Active AI Employee subscription      (resolveAiEmployeeAccess)
 *   - Caller holds `principal` OR `operator` role on the subscription.
 *     `compliance` is read-only per ADR 0005 — this endpoint rejects
 *     compliance callers with 403.
 *
 * Request shape:
 *   POST with optional JSON body `{ confirmed: true, undoWindowMs?: number }`.
 *   The body is optional because the action is gated by the caller's
 *   role + the draft state; `confirmed` is purely advisory (the UI
 *   sends it after the confirm-then-undo flow) and is logged in the
 *   audit metadata.
 *
 * Response shape:
 *   200 OK with JSON `{ status, reviewerEmail, sentAt, error }`. The
 *   `status` mirrors the `SendStatus` vocabulary in send-as.ts.
 *   4xx / 5xx with JSON `{ error: string }` for auth + validation
 *   failures.
 *
 * Audit:
 *   Every call emits a `send_approved` audit event via
 *   `recordSendApprovedAudit`. The event records the approver, the
 *   draft hash, the reviewer email, the configured undo window, the
 *   timestamp, and the final send status. The audit fires even when
 *   the connector returns `pending_connector` — the reviewer's
 *   approval is still a recorded action.
 *
 * Failure handling:
 *   On `sendAsReviewer` returning `{ status: 'failed' }`, the
 *   response includes the error so the UI can surface it inline.
 *   The draft does not move out of the queue — the next list render
 *   shows it with `sendStatus: 'send_failed'`. There is no silent
 *   failure path.
 */

import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resolveAiEmployeeAccess } from '../../../../../../lib/portal/ai-employee-access'
import { getDraft } from '../../../../../../lib/portal/ai-employee/drafts'
import {
  buildSendApprovedAuditEvent,
  clampUndoWindowMs,
  hashDraftBody,
  recordSendApprovedAudit,
  sendAsReviewer,
  type Reviewer,
} from '../../../../../../lib/portal/ai-employee/send-as'

const ROLES_THAT_CAN_SEND = ['principal', 'operator'] as const

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface ParsedBody {
  confirmed: boolean
  undoWindowMs: number | null
}

async function parseBody(request: Request): Promise<ParsedBody> {
  // Defensive: the UI sends JSON; ill-formed requests get the defaults.
  try {
    const raw: unknown = await request.json()
    if (raw === null || typeof raw !== 'object') {
      return { confirmed: false, undoWindowMs: null }
    }
    const obj = raw as Record<string, unknown>
    const confirmed = obj.confirmed === true
    const undoCandidate = obj.undoWindowMs
    const undoWindowMs =
      typeof undoCandidate === 'number' && Number.isFinite(undoCandidate) ? undoCandidate : null
    return { confirmed, undoWindowMs }
  } catch {
    return { confirmed: false, undoWindowMs: null }
  }
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  const draftId = params.id
  if (typeof draftId !== 'string' || draftId === '') {
    return jsonResponse(400, { error: 'Missing draft id.' })
  }

  // Single access gate covers all four checks (Clerk → entity →
  // subscription → role). `compliance` callers fail the role check
  // and get redirected; the API equivalent here is a 403.
  const access = await resolveAiEmployeeAccess(env.DB, locals, {
    allowedRoles: ROLES_THAT_CAN_SEND,
  })
  if (access.kind === 'redirect') {
    return jsonResponse(403, { error: 'You do not have access to send this draft.' })
  }

  const { user, subscription, roles } = access

  // Narrow the role to the send-pathway vocabulary. The access gate
  // only let us through if at least one of ROLES_THAT_CAN_SEND is
  // present, so this find is total — but we keep the explicit guard
  // so a future widening of the allowed role list cannot silently
  // promote `compliance` into the send pathway.
  const sendingRole = roles.find((r): r is 'principal' | 'operator' =>
    (ROLES_THAT_CAN_SEND as readonly string[]).includes(r)
  )
  if (!sendingRole) {
    return jsonResponse(403, { error: 'Your role does not include sending drafts.' })
  }

  const body = await parseBody(request)

  // Fetch the draft from the per-customer Hermes bridge. Returns null
  // today because the bridge has not landed (#821). When the bridge
  // ships, this resolves to a real DraftDetail.
  const draft = await getDraft(subscription, draftId)
  if (!draft) {
    return jsonResponse(404, { error: 'Draft not found.' })
  }

  // ADR 0005 invariant: the draft must already be staged into the
  // reviewer's mailbox. The reviewer's email IS the sending identity;
  // a mismatch is a programmer error or a stale draft from a prior
  // reviewer assignment. `sendAsReviewer` re-checks this, but the
  // endpoint short-circuits here so the audit row records the
  // mismatch reason rather than a generic failure.
  if (user.email.toLowerCase() !== draft.reviewerEmail.toLowerCase()) {
    return jsonResponse(403, {
      error:
        'This draft was staged for a different reviewer. The original reviewer must approve, ' +
        'or your principal can re-stage the draft to your inbox.',
    })
  }

  const reviewer: Reviewer = {
    userId: user.id,
    email: user.email,
    displayName: user.name && user.name !== user.email ? user.name : null,
    role: sendingRole,
  }

  const undoWindowMs = clampUndoWindowMs(body.undoWindowMs)
  const result = await sendAsReviewer(draft, reviewer)
  const draftHash = await hashDraftBody(draft.bodyPlain)

  // Audit fires for every approval. The send status field on the
  // event records whether the connector actually shipped the
  // message, queued it, or refused — keeping the approval action
  // and the dispatch outcome bound in the same row.
  //
  // personaSlug carries the AI Employee identity that drafted the
  // message (per ADR 0011 §3). v1 ships single-persona customers, so
  // the draft's personaSlug is sourced from `customer.yaml.personas[0].slug`
  // by the Hermes bridge. Nullable for forward-compatibility with the
  // pre-bridge stub which returns null until #821 lands.
  const auditEvent = buildSendApprovedAuditEvent({
    approverId: reviewer.userId,
    approverEmail: reviewer.email,
    draftId,
    draftHash,
    reviewerEmail: result.reviewerEmail,
    personaSlug: draft.personaSlug,
    sendWindowMs: undoWindowMs,
    sendStatus: result.status === 'queued_undo' ? 'pending_connector' : result.status,
  })
  await recordSendApprovedAudit(auditEvent)

  return jsonResponse(200, {
    status: result.status,
    reviewerEmail: result.reviewerEmail,
    sentAt: result.sentAt,
    error: result.error,
  })
}
