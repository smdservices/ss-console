/**
 * Subscription-row helpers for the Operator billing engine (#1679).
 *
 * The `subscriptions` table is the product-access gate the portal reads
 * (src/lib/portal/product-access.ts): status provisioning/active/paused/
 * cancelled decides what a client sees. Provisioning owns row CREATION;
 * this module only attaches/detaches Stripe billing to an existing row and
 * mirrors billing-driven status transitions. It never inserts rows —
 * granting portal access remains provisioning's decision, not billing's.
 */

import type { D1Database } from '@cloudflare/workers-types'

export interface SubscriptionBillingRow {
  id: string
  org_id: string
  entity_id: string
  product_slug: string
  status: string
  stripe_subscription_id: string | null
}

const BILLING_COLUMNS = 'id, org_id, entity_id, product_slug, status, stripe_subscription_id'

/** The (entity, product) subscription row, or null. */
export async function getSubscriptionForBilling(
  db: D1Database,
  entityId: string,
  productSlug: string
): Promise<SubscriptionBillingRow | null> {
  const row = await db
    .prepare(
      `SELECT ${BILLING_COLUMNS} FROM subscriptions WHERE entity_id = ? AND product_slug = ?`
    )
    .bind(entityId, productSlug)
    .first<SubscriptionBillingRow>()
  return row ?? null
}

/** Resolve the local row a Stripe subscription event belongs to. Webhooks
 * carry no org context; the stripe id is globally unique (partial unique
 * index, migration 0084). */
export async function getSubscriptionByStripeId(
  db: D1Database,
  stripeSubscriptionId: string
): Promise<SubscriptionBillingRow | null> {
  const row = await db
    .prepare(`SELECT ${BILLING_COLUMNS} FROM subscriptions WHERE stripe_subscription_id = ?`)
    .bind(stripeSubscriptionId)
    .first<SubscriptionBillingRow>()
  return row ?? null
}

/**
 * Attach a Stripe subscription (and its customer) to the local row. The
 * customer id lands in settings_json.stripe_customer_id, the single key the
 * portal's Manage Billing door reads (src/lib/portal/billing.ts); the
 * merge keeps any other settings the row carries.
 */
export async function attachStripeSubscription(
  db: D1Database,
  subscriptionRowId: string,
  stripeSubscriptionId: string,
  stripeCustomerId: string | null = null
): Promise<void> {
  await db
    .prepare(
      `UPDATE subscriptions
         SET stripe_subscription_id = ?,
             settings_json = CASE WHEN ? IS NULL THEN settings_json
                                  ELSE json_set(COALESCE(settings_json, '{}'), '$.stripe_customer_id', ?) END,
             updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(stripeSubscriptionId, stripeCustomerId, stripeCustomerId, subscriptionRowId)
    .run()
}

/**
 * Mirror a billing-driven status transition onto the local row. Restricted
 * to the transitions billing legitimately drives — it must never resurrect
 * a cancelled row or skip provisioning:
 *
 *   * `paused`    — collection paused (audit-only access)
 *   * `active`    — collection resumed
 *   * `cancelled` — subscription deleted at Stripe; ended_at is stamped
 *
 * Provisioning guard (ADR 0067): a `provisioning` row is promoted to
 * `active` by the provisioning/activation flow ONLY — for the Hosted Agent
 * a Stripe subscription attaches at checkout, so subscription.updated
 * events arrive while the seat is still being stood up and must not flip
 * it live. Cancellation still applies to a provisioning row (a buyer who
 * cancels before activation is honestly cancelled).
 */
export async function setSubscriptionBillingStatus(
  db: D1Database,
  subscriptionRowId: string,
  status: 'active' | 'paused' | 'cancelled'
): Promise<void> {
  if (status === 'cancelled') {
    await db
      .prepare(
        "UPDATE subscriptions SET status = 'cancelled', ended_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
      )
      .bind(subscriptionRowId)
      .run()
    return
  }
  await db
    .prepare(
      "UPDATE subscriptions SET status = ?, updated_at = datetime('now') WHERE id = ? AND status NOT IN ('cancelled', 'provisioning')"
    )
    .bind(status, subscriptionRowId)
    .run()
}

/**
 * Promote a `provisioning` Operator row to `active` because the client has
 * started (paid) the retainer. This is the go-live flip the portal reads:
 * `provisioning` keeps a client in the review-and-configure window (Home
 * hidden, Billing hidden, landing on the operator page); `active` reveals
 * the full portal (src/lib/portal/offerings.ts, hasBillingRelationship).
 * Only the operator checkout.session.completed handler calls it, for the
 * operator product, from `provisioning`: the client's own payment is the
 * act. The generic subscription-status mirror keeps its provisioning guard
 * (the Hosted Agent's checkout-before-standup flow must not be promoted by
 * billing events). Returns true when a row was promoted.
 */
export async function activateOperatorSubscriptionForBilling(
  db: D1Database,
  subscriptionRowId: string
): Promise<boolean> {
  const res = await db
    .prepare(
      "UPDATE subscriptions SET status = 'active', started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now') WHERE id = ? AND product_slug = 'operator' AND status = 'provisioning'"
    )
    .bind(subscriptionRowId)
    .run()
  return (res.meta.changes ?? 0) > 0
}
