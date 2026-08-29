/**
 * checkout.session.completed handling for the Operator retainer.
 *
 * The client's own act starts the retainer (Captain, 2026-08-29): a portal
 * principal clicked Start, paid the first month on Stripe's page, and Stripe
 * created the subscription. This handler binds that subscription to the
 * local row the session named in metadata (`smd_subscription_id`), records
 * the Stripe customer so the Manage Billing door renders, and promotes the
 * row from `provisioning` to `active` — the go-live flip that reveals the
 * full portal. It is the ONLY path that promotes an operator row.
 *
 * Unlike the Hosted Agent handler it creates nothing: the operator's
 * subscription row exists from provisioning (the seat was stood up before
 * the client ever saw Billing), so a session that names a row this org
 * does not have is recorded as failed and left for a human, never invented.
 *
 * Idempotency: the `stripe_checkout_orders` ledger keyed by session id, the
 * same discipline as the Hosted Agent handler. Phase 1 D1 writes decide the
 * response (500 → Stripe retries); there is no Phase 2 email here — the
 * portal is the surface, and what Stripe emails is an account setting.
 */

import type { D1Database } from '@cloudflare/workers-types'
import {
  activateOperatorSubscriptionForBilling,
  attachStripeSubscription,
} from '../db/subscriptions'
import { OPERATOR_CHECKOUT_PRODUCT_SLUG } from '../stripe/subscriptions'

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

/** The session-payload fields this handler consumes. */
export interface OperatorCheckoutSessionPayload {
  id: string
  client_reference_id: string | null
  customer: string | null
  subscription: string | null
  amount_total: number | null
  customer_details: { email: string | null; name: string | null } | null
  metadata: Record<string, string>
}

/** Returns true when the session was already fully processed. */
async function recordOrder(
  db: D1Database,
  payload: OperatorCheckoutSessionPayload
): Promise<boolean> {
  const existing = await db
    .prepare('SELECT status FROM stripe_checkout_orders WHERE session_id = ?')
    .bind(payload.id)
    .first<{ status: string }>()
  if (existing?.status === 'processed') return true
  if (!existing) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO stripe_checkout_orders
           (session_id, clerk_user_id, email, stripe_customer_id, stripe_subscription_id,
            product_slug, plan, amount_total, status)
         VALUES (?, ?, ?, ?, ?, ?, 'standard', ?, 'received')`
      )
      .bind(
        payload.id,
        payload.client_reference_id,
        payload.customer_details?.email ?? null,
        payload.customer,
        payload.subscription,
        OPERATOR_CHECKOUT_PRODUCT_SLUG,
        payload.amount_total
      )
      .run()
  }
  return false
}

async function setOrderStatus(
  db: D1Database,
  sessionId: string,
  status: 'processed' | 'failed'
): Promise<void> {
  await db
    .prepare(
      "UPDATE stripe_checkout_orders SET status = ?, updated_at = datetime('now') WHERE session_id = ?"
    )
    .bind(status, sessionId)
    .run()
}

export async function handleOperatorCheckoutCompleted(
  db: D1Database,
  payload: OperatorCheckoutSessionPayload
): Promise<Response> {
  if (payload.metadata['product_slug'] !== OPERATOR_CHECKOUT_PRODUCT_SLUG) return ok()

  try {
    if (await recordOrder(db, payload)) return ok()

    const rowId = payload.metadata['smd_subscription_id']
    const row = rowId
      ? await db
          .prepare("SELECT id FROM subscriptions WHERE id = ? AND product_slug = 'operator'")
          .bind(rowId)
          .first<{ id: string }>()
      : null
    if (!row || !payload.subscription) {
      // A paid session the console cannot bind: never 500-loop Stripe over
      // it; record it failed so a human reconciles, and say so in the log.
      console.error('[operator-checkout] unbound session', payload.id, rowId, payload.subscription)
      await setOrderStatus(db, payload.id, 'failed')
      return ok()
    }

    await attachStripeSubscription(db, row.id, payload.subscription, payload.customer)
    await activateOperatorSubscriptionForBilling(db, row.id)
    await setOrderStatus(db, payload.id, 'processed')
    return ok()
  } catch (err) {
    console.error('[operator-checkout] pipeline failed:', err)
    return serverError() // let Stripe retry
  }
}
