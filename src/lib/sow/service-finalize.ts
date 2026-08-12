/**
 * SOW signature completion and outbox processing.
 * Extracted from service.ts to keep that file under the 500-line ceiling.
 * All exports here are re-exported from service.ts for backward compatibility.
 */

import type { Quote } from '../db/quotes'
import {
  getSOWRevision,
  getSignatureRequestByProviderRequestId,
  listOutboxJobsForSignatureRequest,
  type OutboxJob,
  type SignatureRequest,
} from './store'
import { getSowRevisionSignedKey, uploadSignedSowRevisionPdf } from '../storage/r2'
import { getSignedPdf } from '../signwell/client'
import type { SignWellWebhookPayload } from '../signwell/types'
import { sendEmail } from '../email/resend'
import { normalizeEmail } from '../identity/email'
import { portalWelcomeEmailHtml, signatureConfirmationEmailHtml } from '../email/templates'
import { createStripeInvoice, sendStripeInvoice } from '../stripe/client'

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// prettier-ignore
function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function unknownDocumentResponse(documentId: string): Response {
  console.log(`[signwell-handler] Unknown SignWell document: ${documentId}`)
  return okResponse()
}

// prettier-ignore
export async function handleSignedEmailJob(db: D1Database, orgId: string, resendApiKey: string | undefined, job: OutboxJob): Promise<void> {
  const payload = JSON.parse(job.payload_json) as { entity_id: string }
  const contact = await db
    .prepare(
      'SELECT email FROM contacts WHERE org_id = ? AND entity_id = ? AND email IS NOT NULL ORDER BY created_at ASC LIMIT 1'
    )
    .bind(orgId, payload.entity_id)
    .first<{ email: string }>()

  if (!contact?.email) return

  const entity = await db
    .prepare('SELECT name FROM entities WHERE id = ? AND org_id = ?')
    .bind(payload.entity_id, orgId)
    .first<{ name: string }>()

  const result = await sendEmail(resendApiKey, {
    to: contact.email,
    subject: 'SOW Signed - Next Steps',
    html: signatureConfirmationEmailHtml(entity?.name ?? 'there'),
  })
  // Never swallow a Resend rejection: a discarded {success:false} here means a
  // client signs and never learns next steps, with zero visibility. Throw so the
  // outbox marks the job failed (last_error recorded) and re-attempts — instead
  // of marking it completed as if the email sent.
  if (!result.success) {
    throw new Error(`SOW-signed email send failed: ${result.error ?? 'unknown'}`)
  }
}

// prettier-ignore
export async function handlePortalInvitationJob(_db: D1Database, _orgId: string, resendApiKey: string | undefined, appBaseUrl: string | undefined, job: OutboxJob): Promise<void> {
  const payload = JSON.parse(job.payload_json) as {
    user_email: string
    user_name: string
  }

  if (!resendApiKey) {
    console.log('[sow/outbox] Portal invitation skipped (no RESEND_API_KEY)')
    return
  }

  const portalLoginUrl = appBaseUrl
    ? `${appBaseUrl.replace('://', '://portal.')}`
    : 'https://portal.smd.services'
  const loginUrlWithEmail = `${portalLoginUrl}?email=${encodeURIComponent(payload.user_email)}`

  const result = await sendEmail(resendApiKey, {
    to: payload.user_email,
    subject: 'Your SMD Services portal is ready',
    html: portalWelcomeEmailHtml(payload.user_name, loginUrlWithEmail),
  })
  // Never swallow a Resend rejection: a discarded {success:false} here means a
  // client never gets portal access, with zero visibility. Throw so the outbox
  // marks the job failed (last_error recorded) and re-attempts.
  if (!result.success) {
    throw new Error(`Portal-invitation email send failed: ${result.error ?? 'unknown'}`)
  }
}

export async function handleDepositInvoiceJob(
  db: D1Database,
  orgId: string,
  stripeApiKey: string | undefined,
  job: OutboxJob
): Promise<void> {
  const payload = JSON.parse(job.payload_json) as {
    entity_id: string
    quote_id: string
    engagement_id: string
    invoice_id: string
    amount: number
  }

  if (!stripeApiKey) return

  const contact = await db
    .prepare(
      'SELECT email FROM contacts WHERE org_id = ? AND entity_id = ? AND email IS NOT NULL ORDER BY created_at ASC LIMIT 1'
    )
    .bind(orgId, payload.entity_id)
    .first<{ email: string }>()

  if (!contact?.email) return

  // Invoice description must come from AUTHORED content, never a synthesized
  // scope phrase. The prior hardcoded deposit scope label was a Pattern-B
  // fabrication (CLAUDE.md P0; see docs/reviews/code-review-2026-06-30.md).
  // Source the quote's authored engagement_overview (quote_id is already carried
  // on the outbox payload); fall back to a neutral, non-scope label when it has
  // not been authored yet.
  const quoteRow = await db
    .prepare('SELECT engagement_overview FROM quotes WHERE id = ? AND org_id = ?')
    .bind(payload.quote_id, orgId)
    .first<{ engagement_overview: string | null }>()
  const authoredOverview = quoteRow?.engagement_overview?.trim()
  const invoiceDescription =
    authoredOverview && authoredOverview.length > 0 ? authoredOverview : 'Deposit invoice'

  const amountCents = Math.round((payload.amount ?? 0) * 100)
  const stripeResult = await createStripeInvoice(stripeApiKey, {
    customer_email: contact.email,
    description: invoiceDescription,
    line_items: [
      {
        amount: amountCents,
        currency: 'usd',
        description: 'Deposit (50% of project price)',
        quantity: 1,
      },
    ],
    days_until_due: 3,
    metadata: {
      invoice_id: payload.invoice_id,
      engagement_id: payload.engagement_id,
    },
  })

  const sentResult = await sendStripeInvoice(stripeApiKey, stripeResult.id)
  await db
    .prepare(
      `UPDATE invoices
       SET stripe_invoice_id = ?, stripe_hosted_url = ?, status = 'sent', sent_at = ?, updated_at = ?
       WHERE id = ? AND org_id = ?`
    )
    .bind(
      sentResult.id,
      sentResult.hosted_invoice_url,
      new Date().toISOString(),
      new Date().toISOString(),
      payload.invoice_id,
      orgId
    )
    .run()
}

// prettier-ignore
async function processOutboxJobsForSignatureRequest(db: D1Database, request: SignatureRequest, resendApiKey: string | undefined, stripeApiKey: string | undefined, appBaseUrl: string | undefined): Promise<void> {
  const jobs = await listOutboxJobsForSignatureRequest(db, request.org_id, request.id)
  for (const job of jobs) {
    if (job.status === 'completed') continue

    try {
      await db
        .prepare(
          `UPDATE outbox_jobs
           SET status = 'processing', attempt_count = attempt_count + 1, updated_at = ?
           WHERE id = ? AND org_id = ?`
        )
        .bind(new Date().toISOString(), job.id, request.org_id)
        .run()

      if (job.type === 'send_sow_signed_email') {
        await handleSignedEmailJob(db, request.org_id, resendApiKey, job)
      } else if (job.type === 'send_deposit_invoice') {
        await handleDepositInvoiceJob(db, request.org_id, stripeApiKey, job)
      } else if (job.type === 'send_portal_invitation') {
        await handlePortalInvitationJob(db, request.org_id, resendApiKey, appBaseUrl, job)
      }

      await db
        .prepare(
          `UPDATE outbox_jobs
           SET status = 'completed', last_error = NULL, updated_at = ?
           WHERE id = ? AND org_id = ?`
        )
        .bind(new Date().toISOString(), job.id, request.org_id)
        .run()
    } catch (err) {
      console.error('[sow/outbox] Job failed:', job.type, err)
      await db
        .prepare(
          `UPDATE outbox_jobs
           SET status = 'failed', last_error = ?, updated_at = ?
           WHERE id = ? AND org_id = ?`
        )
        .bind(
          err instanceof Error ? err.message : String(err),
          new Date().toISOString(),
          job.id,
          request.org_id
        )
        .run()
    }
  }
}

// prettier-ignore
interface SignerSnapshot { contactId: string; name: string; email: string; title: string | null }
// prettier-ignore
interface FinalizeCtx {
  db: D1Database; orgId: string; requestId: string; entityId: string; quoteId: string
  engagementId: string; serviceId: string; invoiceId: string; depositAmount: number; signer: SignerSnapshot
  now: string; signedKey: string; revisionId: string; totalHours: number
}

function buildOutboxStmts(ctx: FinalizeCtx): D1PreparedStatement[] {
  // prettier-ignore
  const { db, orgId, requestId, entityId, quoteId, engagementId, invoiceId, depositAmount, signer, now } = ctx
  const normalizedEmail = normalizeEmail(signer.email)
  return [
    db
      .prepare(
        `INSERT INTO outbox_jobs (id, org_id, signature_request_id, type, status, dedupe_key, payload_json, available_at, created_at, updated_at) VALUES (?, ?, ?, 'send_sow_signed_email', 'pending', ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        orgId,
        requestId,
        `signature-email:${requestId}`,
        JSON.stringify({ signature_request_id: requestId, entity_id: entityId, quote_id: quoteId }),
        now,
        now,
        now
      ),
    db
      .prepare(
        `INSERT INTO outbox_jobs (id, org_id, signature_request_id, type, status, dedupe_key, payload_json, available_at, created_at, updated_at) VALUES (?, ?, ?, 'send_deposit_invoice', 'pending', ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        orgId,
        requestId,
        `deposit-invoice:${requestId}`,
        JSON.stringify({
          signature_request_id: requestId,
          entity_id: entityId,
          quote_id: quoteId,
          engagement_id: engagementId,
          invoice_id: invoiceId,
          amount: depositAmount,
        }),
        now,
        now,
        now
      ),
    db
      .prepare(
        `INSERT INTO outbox_jobs (id, org_id, signature_request_id, type, status, dedupe_key, payload_json, available_at, created_at, updated_at) VALUES (?, ?, ?, 'send_portal_invitation', 'pending', ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        orgId,
        requestId,
        `portal-invitation:${requestId}`,
        JSON.stringify({
          signature_request_id: requestId,
          entity_id: entityId,
          user_email: normalizedEmail,
          user_name: signer.name,
        }),
        now,
        now,
        now
      ),
  ]
}

// prettier-ignore
type CoreStmtIds = { contextEntryId: string; clientUserId: string; stageChangeContent: string; stageChangeMetadata: string; normalizedEmail: string }

function buildCoreStmts(ctx: FinalizeCtx, ids: CoreStmtIds): D1PreparedStatement[] {
  // prettier-ignore
  const { db, orgId, requestId, entityId, quoteId, engagementId, serviceId, invoiceId, signer, signedKey, revisionId, totalHours, now } = ctx
  // prettier-ignore
  const { contextEntryId, clientUserId, stageChangeContent, stageChangeMetadata, normalizedEmail } = ids
  return [
    db
      .prepare(
        `UPDATE signature_requests SET status = 'completed', signed_storage_key = ?, completed_at = COALESCE(completed_at, ?), webhook_last_at = ?, updated_at = ? WHERE id = ? AND org_id = ? AND status = 'completed_pending_artifact'`
      )
      .bind(signedKey, now, now, now, requestId, orgId),
    db
      .prepare(
        `UPDATE sow_revisions SET status = 'signed', signed_storage_key = ?, signed_at = ?, updated_at = ? WHERE id = ? AND org_id = ?`
      )
      .bind(signedKey, now, now, revisionId, orgId),
    db
      .prepare(
        `UPDATE quotes SET status = 'accepted', accepted_at = ?, updated_at = ? WHERE id = ? AND org_id = ? AND status = 'sent'`
      )
      .bind(now, now, quoteId, orgId),
    db
      .prepare(
        `UPDATE entities SET stage = 'engaged', stage_changed_at = ?, updated_at = ? WHERE id = ? AND org_id = ?`
      )
      .bind(now, now, entityId, orgId),
    // ADR 0046: the commercial `service` spine row (parent of the engagement).
    // Born 'active' — acceptance is the trigger and the revenue line is live at
    // signature. Inlined here (not via createService) to stay in the atomic
    // batch. All ids are JS-side constants, so statement order is immaterial.
    db
      .prepare(
        `INSERT INTO services (id, org_id, entity_id, quote_id, type, cadence, status, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'consulting', 'one_time', 'active', ?, ?, ?)`
      )
      .bind(serviceId, orgId, entityId, quoteId, now, now, now),
    db
      .prepare(
        `INSERT INTO engagements (id, org_id, entity_id, quote_id, service_id, status, estimated_hours, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)`
      )
      .bind(engagementId, orgId, entityId, quoteId, serviceId, totalHours, now, now),
    db
      .prepare(
        `INSERT INTO invoices (id, org_id, engagement_id, entity_id, type, amount, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'deposit', ?, 'draft', ?, ?)`
      )
      .bind(invoiceId, orgId, engagementId, entityId, ctx.depositAmount, now, now),
    db
      .prepare(
        `INSERT INTO context (id, entity_id, org_id, type, content, source, content_size, metadata, created_at) VALUES (?, ?, ?, 'stage_change', ?, 'signwell-webhook', ?, ?, ?)`
      )
      .bind(
        contextEntryId,
        entityId,
        orgId,
        stageChangeContent,
        stageChangeContent.length,
        stageChangeMetadata,
        now
      ),
    db
      .prepare(
        `INSERT INTO users (id, org_id, email, name, role, entity_id, created_at) VALUES (?, ?, ?, ?, 'client', ?, ?) ON CONFLICT(org_id, email) DO UPDATE SET entity_id = COALESCE(users.entity_id, excluded.entity_id)`
      )
      .bind(clientUserId, orgId, normalizedEmail, signer.name, entityId, now),
  ]
}

function buildFinalizationBatch(
  ctx: FinalizeCtx,
  lineItems: Array<{ problem: string; description: string }>
): D1PreparedStatement[] {
  const { db, orgId, requestId, quoteId, engagementId, signer, now } = ctx
  const milestoneIds = lineItems.map(() => crypto.randomUUID())
  const clientUserId = crypto.randomUUID()
  const contextEntryId = crypto.randomUUID()
  const normalizedEmail = normalizeEmail(signer.email)
  const stageChangeContent = 'Stage: proposing -> engaged. SOW signed via SignWell.'
  const stageChangeMetadata = JSON.stringify({
    from: 'proposing',
    to: 'engaged',
    reason: 'SOW signed via SignWell',
    quote_id: quoteId,
    engagement_id: engagementId,
    signature_request_id: requestId,
  })
  const milestoneStmts = lineItems.map((item, i) =>
    db
      .prepare(
        `INSERT INTO milestones (id, engagement_id, org_id, name, description, status, payment_trigger, sort_order, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      )
      .bind(
        milestoneIds[i],
        engagementId,
        orgId,
        item.problem,
        item.description,
        i === lineItems.length - 1 ? 1 : 0,
        i,
        now
      )
  )
  return [
    ...buildCoreStmts(ctx, {
      contextEntryId,
      clientUserId,
      stageChangeContent,
      stageChangeMetadata,
      normalizedEmail,
    }),
    ...milestoneStmts,
    ...buildOutboxStmts(ctx),
  ]
}

// prettier-ignore
interface ClaimArgs { db: D1Database; request: SignatureRequest; providerRequestId: string; now: string; resendApiKey: string | undefined; stripeApiKey: string | undefined; appBaseUrl: string | undefined }

/**
 * Claim the `sent` -> `completed_pending_artifact` transition.
 * Returns true if this invocation won the race, false if another already did.
 * Handles dedup by re-triggering outbox processing if the winner already completed.
 */
async function claimSignatureTransition(args: ClaimArgs): Promise<boolean> {
  const { db, request, providerRequestId, now, resendApiKey, stripeApiKey, appBaseUrl } = args
  const claimResult = await db
    .prepare(
      `UPDATE signature_requests
       SET status = 'completed_pending_artifact', completed_at = COALESCE(completed_at, ?),
           webhook_last_at = ?, updated_at = ?
       WHERE id = ? AND org_id = ? AND status = 'sent'`
    )
    .bind(now, now, now, request.id, request.org_id)
    .run()

  if ((claimResult.meta?.changes ?? 0) > 0) return true

  // Another invocation beat us; if it already completed, process outbox now.
  const latestRequest = await getSignatureRequestByProviderRequestId(
    db,
    'signwell',
    providerRequestId
  )
  if (latestRequest?.status === 'completed') {
    await processOutboxJobsForSignatureRequest(
      db,
      latestRequest,
      resendApiKey,
      stripeApiKey,
      appBaseUrl
    )
  }
  return false
}

async function persistAndFinalizeArtifact(args: {
  db: D1Database
  storage: R2Bucket
  apiKey: string
  request: SignatureRequest
  quote: Quote
  providerRequestId: string
  signedKey: string
  now: string
}): Promise<Response | null> {
  const { db, storage, apiKey, request, quote, providerRequestId, signedKey, now } = args
  try {
    const signedPdf = await getSignedPdf(apiKey, providerRequestId)
    await uploadSignedSowRevisionPdf(storage, signedKey, signedPdf, {
      quoteId: quote.id,
      revisionId: request.sow_revision_id,
      providerRequestId,
      signedAt: now,
    })
  } catch (err) {
    console.error('[sow/finalize] Failed to persist signed artifact:', err)
    return new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const lineItems = JSON.parse(quote.line_items) as Array<{ problem: string; description: string }>
  const signerSnapshot = JSON.parse(request.signer_snapshot_json) as SignerSnapshot
  const ctx: FinalizeCtx = {
    db,
    orgId: request.org_id,
    requestId: request.id,
    entityId: quote.entity_id,
    quoteId: quote.id,
    engagementId: crypto.randomUUID(),
    // ADR 0046: the commercial `service` parent. 'svc_' prefix is the shared
    // invariant with the backfill (migrations 0069/0070).
    serviceId: `svc_${crypto.randomUUID()}`,
    invoiceId: crypto.randomUUID(),
    depositAmount: quote.deposit_amount ?? 0,
    signer: signerSnapshot,
    now,
    signedKey,
    revisionId: request.sow_revision_id,
    totalHours: quote.total_hours,
  }
  try {
    await db.batch(buildFinalizationBatch(ctx, lineItems))
  } catch (err) {
    console.error('[sow/finalize] Finalization batch failed:', err)
    return new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return null
}

// ---------------------------------------------------------------------------
// Exported function
// ---------------------------------------------------------------------------

export async function finalizeCompletedSOWSignature(args: {
  db: D1Database
  storage: R2Bucket
  apiKey: string
  resendApiKey: string | undefined
  stripeApiKey: string | undefined
  appBaseUrl: string | undefined
  payload: SignWellWebhookPayload
}): Promise<Response> {
  const { db, storage, apiKey, resendApiKey, stripeApiKey, appBaseUrl, payload } = args
  const providerRequestId = payload.data.object.id
  const request = await getSignatureRequestByProviderRequestId(db, 'signwell', providerRequestId)

  if (!request) return unknownDocumentResponse(providerRequestId)

  if (request.status === 'completed') {
    await processOutboxJobsForSignatureRequest(db, request, resendApiKey, stripeApiKey, appBaseUrl)
    return okResponse()
  }

  const revision = await getSOWRevision(db, request.org_id, request.sow_revision_id)
  if (!revision) throw new Error(`Missing SOW revision for signature request ${request.id}`)

  const quote = await db
    .prepare('SELECT * FROM quotes WHERE id = ? AND org_id = ?')
    .bind(request.quote_id, request.org_id)
    .first<Quote>()
  if (!quote) throw new Error(`Missing quote for signature request ${request.id}`)

  const now = new Date().toISOString()

  if (request.status === 'sent') {
    const claimed = await claimSignatureTransition({
      db,
      request,
      providerRequestId,
      now,
      resendApiKey,
      stripeApiKey,
      appBaseUrl,
    })
    if (!claimed) return okResponse()
  } else if (request.status !== 'completed_pending_artifact') {
    return okResponse()
  }

  const signedKey =
    revision.signed_storage_key ?? getSowRevisionSignedKey(request.org_id, quote.id, revision.id)
  const errorResponse = await persistAndFinalizeArtifact({
    db,
    storage,
    apiKey,
    request,
    quote,
    providerRequestId,
    signedKey,
    now,
  })
  if (errorResponse) return errorResponse

  const completedRequest = await getSignatureRequestByProviderRequestId(
    db,
    'signwell',
    providerRequestId
  )
  if (completedRequest) {
    await processOutboxJobsForSignatureRequest(
      db,
      completedRequest,
      resendApiKey,
      stripeApiKey,
      appBaseUrl
    )
  }
  return okResponse()
}
