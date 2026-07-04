/**
 * Stripe webhook handling for Operator retainer subscriptions (#1679).
 *
 * The legacy handler (stripe-handler.ts) matches events to PRE-EXISTING
 * local invoice rows — the one-time deposit/completion/milestone flow where
 * the console created the invoice first. Subscription cycle invoices invert
 * that: STRIPE originates them monthly, so this module mirrors them into the
 * local `invoices` table as `type='retainer'` rows (the CHECK constraint has
 * carried the type since the schema was authored; it goes live here), keyed
 * to the customer via `subscriptions.stripe_subscription_id` (migration
 * 0084).
 *
 * Dispatch contract with the route: an invoice event with a subscription
 * linkage is handled HERE; without one it belongs to the legacy handler.
 * Retainer invoices are never console-originated, so linkage splits the two
 * flows exactly.
 *
 * Payment-failure posture: mark the local row `overdue` and alert
 * team@smd.services. NOTHING here touches the customer's Machine — whether
 * a delinquent seat gets paused or decommissioned is a Captain decision
 * under the offboarding doctrine (#1684), never a webhook side effect.
 *
 * Same two-phase discipline as the legacy handler: Phase 1 D1 writes decide
 * the response; Phase 2 emails are best-effort.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { sendEmail } from '../email/resend'
import { paymentConfirmationEmailHtml } from '../email/templates'
import {
  getSubscriptionByStripeId,
  setSubscriptionBillingStatus,
  type SubscriptionBillingRow,
} from '../db/subscriptions'

/** SMD operational-alert address (CLAUDE.md Contact Addresses). */
const ALERT_EMAIL = 'team@smd.services'

function ok(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function serverError(): Response {
  return new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Pull the parent subscription id off an invoice payload. Stripe moved the
 * linkage across API versions — older versions carry a top-level
 * `subscription` string; newer versions nest it under
 * `parent.subscription_details.subscription`. This client pins no
 * Stripe-Version header, so both shapes must parse (parse, never cast).
 */
export function extractStripeSubscriptionId(invoice: unknown): string | null {
  if (typeof invoice !== 'object' || invoice === null) return null
  const obj = invoice as Record<string, unknown>

  const direct = obj['subscription']
  if (typeof direct === 'string' && direct.length > 0) return direct

  const parent = obj['parent']
  if (typeof parent === 'object' && parent !== null) {
    const details = (parent as Record<string, unknown>)['subscription_details']
    if (typeof details === 'object' && details !== null) {
      const nested = (details as Record<string, unknown>)['subscription']
      if (typeof nested === 'string' && nested.length > 0) return nested
    }
  }
  return null
}

/** The invoice-payload fields the retainer mirror consumes. */
export interface RetainerInvoicePayload {
  id: string
  amount_due: number
  amount_paid: number
  hosted_invoice_url: string | null
  due_date: number | null
  status_transitions: { paid_at: number | null }
}

function unixToIso(unix: number | null): string | null {
  return unix === null ? null : new Date(unix * 1000).toISOString()
}

async function getLocalRetainerInvoice(
  db: D1Database,
  stripeInvoiceId: string
): Promise<{ id: string; org_id: string; status: string } | null> {
  const row = await db
    .prepare('SELECT id, org_id, status FROM invoices WHERE stripe_invoice_id = ?')
    .bind(stripeInvoiceId)
    .first<{ id: string; org_id: string; status: string }>()
  return row ?? null
}

/**
 * Mirror a finalized cycle invoice as a local `retainer` row (status
 * `sent` — Stripe emails the hosted invoice itself on finalization). Runs
 * before payment, so the portal shows the open invoice the client received.
 * Idempotent: an existing mirror row is refreshed, never duplicated.
 */
export async function handleRetainerInvoiceFinalized(
  db: D1Database,
  stripeSubscriptionId: string,
  invoice: RetainerInvoicePayload
): Promise<Response> {
  const sub = await getSubscriptionByStripeId(db, stripeSubscriptionId)
  if (!sub) {
    // A Stripe subscription we did not attach (e.g. a smoke test) — honest skip.
    console.log(
      `[stripe-subscription] No local subscription for ${stripeSubscriptionId}; skipping invoice ${invoice.id}`
    )
    return ok()
  }

  try {
    const existing = await getLocalRetainerInvoice(db, invoice.id)
    const now = new Date().toISOString()
    const amount = invoice.amount_due / 100
    const dueDate = unixToIso(invoice.due_date)

    if (existing) {
      await db
        .prepare(
          `UPDATE invoices SET amount = ?, due_date = ?, stripe_hosted_url = ?, sent_at = COALESCE(sent_at, ?), updated_at = ?
           WHERE id = ? AND status IN ('draft', 'sent')`
        )
        .bind(amount, dueDate, invoice.hosted_invoice_url, now, now, existing.id)
        .run()
      return ok()
    }

    await db
      .prepare(
        `INSERT INTO invoices (id, org_id, entity_id, type, amount, description, status,
                               stripe_invoice_id, stripe_hosted_url, due_date, sent_at, created_at, updated_at)
         VALUES (?, ?, ?, 'retainer', ?, ?, 'sent', ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        sub.org_id,
        sub.entity_id,
        amount,
        'Operator retainer — monthly',
        invoice.id,
        invoice.hosted_invoice_url,
        dueDate,
        now,
        now,
        now
      )
      .run()
    return ok()
  } catch (err) {
    console.error('[stripe-subscription] finalized mirror failed:', err)
    return serverError() // let Stripe retry
  }
}

/**
 * Mark a cycle invoice paid. Upserts (a paid event may arrive without the
 * finalized mirror having landed), then sends the same confirmation email
 * the one-time flow sends. Idempotent on the paid state.
 */
export async function handleRetainerInvoicePaid(
  db: D1Database,
  resendApiKey: string | undefined,
  stripeSubscriptionId: string,
  invoice: RetainerInvoicePayload
): Promise<Response> {
  const sub = await getSubscriptionByStripeId(db, stripeSubscriptionId)
  if (!sub) {
    console.log(
      `[stripe-subscription] No local subscription for ${stripeSubscriptionId}; skipping paid invoice ${invoice.id}`
    )
    return ok()
  }

  const amount = (invoice.amount_paid > 0 ? invoice.amount_paid : invoice.amount_due) / 100
  const paidAt = unixToIso(invoice.status_transitions.paid_at) ?? new Date().toISOString()
  const now = new Date().toISOString()

  try {
    const existing = await getLocalRetainerInvoice(db, invoice.id)
    if (existing?.status === 'paid') return ok() // idempotency guard

    if (existing) {
      await db
        .prepare(
          `UPDATE invoices SET status = 'paid', amount = ?, paid_at = ?, payment_method = 'stripe',
                               stripe_hosted_url = COALESCE(?, stripe_hosted_url), updated_at = ?
           WHERE id = ?`
        )
        .bind(amount, paidAt, invoice.hosted_invoice_url, now, existing.id)
        .run()
    } else {
      await db
        .prepare(
          `INSERT INTO invoices (id, org_id, entity_id, type, amount, description, status,
                                 stripe_invoice_id, stripe_hosted_url, due_date, sent_at, paid_at, payment_method,
                                 created_at, updated_at)
           VALUES (?, ?, ?, 'retainer', ?, ?, 'paid', ?, ?, ?, ?, ?, 'stripe', ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          sub.org_id,
          sub.entity_id,
          amount,
          'Operator retainer — monthly',
          invoice.id,
          invoice.hosted_invoice_url,
          unixToIso(invoice.due_date),
          now,
          paidAt,
          now,
          now
        )
        .run()
    }
  } catch (err) {
    console.error('[stripe-subscription] paid mirror failed:', err)
    return serverError() // let Stripe retry
  }

  // Phase 2: confirmation email, best-effort.
  await sendRetainerConfirmationEmail(db, resendApiKey, sub, amount)
  return ok()
}

/** Phase-2 side effect for a paid cycle invoice: the same confirmation email
 * the one-time flow sends. Best-effort — never turns a mirrored payment into
 * a webhook failure. */
async function sendRetainerConfirmationEmail(
  db: D1Database,
  resendApiKey: string | undefined,
  sub: SubscriptionBillingRow,
  amount: number
): Promise<void> {
  try {
    const contact = await db
      .prepare(
        'SELECT email FROM contacts WHERE org_id = ? AND entity_id = ? AND email IS NOT NULL ORDER BY created_at ASC LIMIT 1'
      )
      .bind(sub.org_id, sub.entity_id)
      .first<{ email: string }>()
    if (!contact?.email) return
    const entity = await db
      .prepare('SELECT name FROM entities WHERE id = ? AND org_id = ?')
      .bind(sub.entity_id, sub.org_id)
      .first<{ name: string }>()
    const formatted = `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    await sendEmail(resendApiKey, {
      to: contact.email,
      subject: 'Payment received — thank you',
      html: paymentConfirmationEmailHtml(entity?.name ?? 'there', formatted),
    })
  } catch (err) {
    console.error('[stripe-subscription] confirmation email failed:', err)
  }
}

/**
 * A cycle invoice's payment failed. Mark the local mirror `overdue` and
 * alert the firm. Deliberately does NOT touch the subscription row, the
 * portal gate, or the customer's Machine (#1684 owns that ladder).
 */
export async function handleRetainerInvoicePaymentFailed(
  db: D1Database,
  resendApiKey: string | undefined,
  stripeSubscriptionId: string,
  invoice: RetainerInvoicePayload
): Promise<Response> {
  const sub = await getSubscriptionByStripeId(db, stripeSubscriptionId)
  if (!sub) return ok()

  try {
    await db
      .prepare(
        `UPDATE invoices SET status = 'overdue', updated_at = datetime('now')
         WHERE stripe_invoice_id = ? AND status IN ('sent', 'draft')`
      )
      .bind(invoice.id)
      .run()
  } catch (err) {
    console.error('[stripe-subscription] overdue update failed:', err)
    return serverError()
  }

  try {
    const entity = await db
      .prepare('SELECT name FROM entities WHERE id = ? AND org_id = ?')
      .bind(sub.entity_id, sub.org_id)
      .first<{ name: string }>()
    const amount = (invoice.amount_due / 100).toFixed(2)
    await sendEmail(resendApiKey, {
      to: ALERT_EMAIL,
      subject: `Retainer payment failed — ${entity?.name ?? sub.entity_id}`,
      html:
        `<p>A retainer cycle invoice payment failed.</p>` +
        `<ul><li>Customer: ${entity?.name ?? sub.entity_id}</li>` +
        `<li>Amount: $${amount}</li>` +
        `<li>Stripe invoice: ${invoice.id}</li>` +
        `<li>Stripe subscription: ${stripeSubscriptionId}</li></ul>` +
        `<p>No automatic action was taken. Pause/decommission is a Captain decision (offboarding doctrine, ss-console#1684).</p>`,
    })
  } catch (err) {
    console.error('[stripe-subscription] failure alert email failed:', err)
  }

  return ok()
}

/** The subscription-payload fields the status mirror consumes. */
export interface StripeSubscriptionEventPayload {
  id: string
  status: string
  pause_collection?: unknown
}

/**
 * Mirror `customer.subscription.updated` / `.deleted` onto the local row.
 * Transitions are billing-scoped (see setSubscriptionBillingStatus): a
 * deleted subscription cancels the row; pause_collection presence maps to
 * paused/active. Unknown Stripe subscriptions are skipped honestly.
 */
export async function handleSubscriptionLifecycle(
  db: D1Database,
  eventType: 'customer.subscription.updated' | 'customer.subscription.deleted',
  payload: StripeSubscriptionEventPayload
): Promise<Response> {
  const sub = await getSubscriptionByStripeId(db, payload.id)
  if (!sub) {
    console.log(
      `[stripe-subscription] No local subscription for ${payload.id}; skipping ${eventType}`
    )
    return ok()
  }

  try {
    if (eventType === 'customer.subscription.deleted' || payload.status === 'canceled') {
      await setSubscriptionBillingStatus(db, sub.id, 'cancelled')
    } else if (payload.pause_collection !== null && payload.pause_collection !== undefined) {
      await setSubscriptionBillingStatus(db, sub.id, 'paused')
    } else if (payload.status === 'active' || payload.status === 'past_due') {
      // past_due keeps access: the failure alert + Captain decide, never the webhook.
      await setSubscriptionBillingStatus(db, sub.id, 'active')
    }
    return ok()
  } catch (err) {
    console.error('[stripe-subscription] lifecycle mirror failed:', err)
    return serverError()
  }
}

export type { SubscriptionBillingRow }
