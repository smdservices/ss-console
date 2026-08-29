/**
 * Stripe subscription operations for the Operator retainer (#1679).
 *
 * The Operator is sold as a flat monthly retainer (ADR 0004 shape, ADR 0063
 * price). This module gives the retainer a real billing engine: a Stripe
 * subscription with `collection_method=send_invoice`, so Stripe emails the
 * hosted invoice each cycle and the existing invoice webhooks
 * (src/pages/api/webhooks/stripe.ts) mirror cycle invoices into the local
 * `invoices` table as `type='retainer'` rows.
 *
 * Design choices, in order of consequence:
 *
 *   * **send_invoice, not charge_automatically.** The retainer is a B2B
 *     relationship invoiced monthly; no card-on-file is required, the client
 *     pays the hosted invoice exactly like the one-time deposit/completion
 *     invoices they already know, and a payment failure is a dunning email
 *     thread, never a surprise charge. Stripe auto-activates send_invoice
 *     subscriptions regardless of first-invoice status.
 *   * **One shared Product, inline per-seat prices.** Stripe's inline
 *     `price_data` requires an existing product id, and every seat's price is
 *     authored per engagement (services.recurring_price) — so we resolve one
 *     "SMD Operator Retainer" product by metadata (create on first use, same
 *     resolve-or-create idiom as customers) and attach a fresh inline monthly
 *     price per subscription. Inline prices are single-use by design, which
 *     matches per-seat authored pricing.
 *   * **Pause = pause_collection[behavior]=void.** A paused seat (audit-only
 *     access, drafts suspended) must not accumulate charges; cycle invoices
 *     generated while paused are voided. Resume clears `pause_collection`
 *     (the dedicated /resume endpoint is charge_automatically-only).
 *   * **Payment failure never touches the Machine.** The webhook alerts
 *     team@smd.services and marks the local invoice overdue; whether to
 *     pause or decommission is a Captain decision under the offboarding
 *     doctrine (#1684). No imposed default.
 *
 * DEV-MODE PATTERN: when apiKey is undefined, log and return a mock — same
 * as client.ts / resend.ts.
 */

const STRIPE_API_BASE = 'https://api.stripe.com/v1'

/** Metadata marker that identifies the shared retainer product. */
const RETAINER_PRODUCT_MARKER = { key: 'smd_product', value: 'operator-retainer' } as const
const RETAINER_PRODUCT_NAME = 'SMD Operator Retainer'

function stripeHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

export interface StripeSubscriptionResult {
  id: string
  status: string
}

export interface CreateOperatorSubscriptionParams {
  /** Billing contact — Stripe resolves/creates the customer record by email. */
  customer_email: string
  /** Monthly retainer in cents (from services.recurring_price × 100). */
  monthly_amount_cents: number
  /** Local entity id, stamped into metadata for cross-reference. */
  entity_id: string
  /** Local subscriptions.id, stamped into metadata for cross-reference. */
  subscription_row_id: string
  /** Days the client has to pay each cycle invoice. */
  days_until_due?: number
  /**
   * Unix timestamp (seconds) of the Billing Start Date. When set and in the
   * future, the subscription exists from creation (the portal lists it under
   * Billing) but Stripe issues the first cycle invoice ON this date, with no
   * proration for the gap. Mirrors the agreement's billing-start clause:
   * nothing accrues before implementation testing completes, then monthly in
   * advance. Omit to bill from creation.
   */
  billing_cycle_anchor?: number
  /** Extra metadata (e.g. a smoke-test marker). */
  metadata?: Record<string, string>
}

async function resolveStripeCustomerId(apiKey: string, email: string): Promise<string> {
  const searchRes = await fetch(
    `${STRIPE_API_BASE}/customers/search?query=email:'${encodeURIComponent(email)}'`,
    { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } }
  )
  if (searchRes.ok) {
    const data: { data: Array<{ id: string }> } = await searchRes.json()
    if (data.data.length > 0) return data.data[0].id
  }
  const body = new URLSearchParams()
  body.append('email', email)
  const res = await fetch(`${STRIPE_API_BASE}/customers`, {
    method: 'POST',
    headers: stripeHeaders(apiKey),
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`Stripe customer creation failed ${res.status}: ${await res.text()}`)
  }
  const data: { id: string } = await res.json()
  return data.id
}

/**
 * Resolve the shared retainer Product by its metadata marker; create it on
 * first use. One product for the whole SKU — per-seat prices are inline.
 */
async function resolveRetainerProductId(apiKey: string): Promise<string> {
  const query = `metadata['${RETAINER_PRODUCT_MARKER.key}']:'${RETAINER_PRODUCT_MARKER.value}'`
  const searchRes = await fetch(
    `${STRIPE_API_BASE}/products/search?query=${encodeURIComponent(query)}`,
    { method: 'GET', headers: { Authorization: `Bearer ${apiKey}` } }
  )
  if (searchRes.ok) {
    const data: { data: Array<{ id: string }> } = await searchRes.json()
    if (data.data.length > 0) return data.data[0].id
  }
  const body = new URLSearchParams()
  body.append('name', RETAINER_PRODUCT_NAME)
  body.append(`metadata[${RETAINER_PRODUCT_MARKER.key}]`, RETAINER_PRODUCT_MARKER.value)
  const res = await fetch(`${STRIPE_API_BASE}/products`, {
    method: 'POST',
    headers: stripeHeaders(apiKey),
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`Stripe product creation failed ${res.status}: ${await res.text()}`)
  }
  const data: { id: string } = await res.json()
  return data.id
}

/**
 * Create the monthly retainer subscription. Stripe generates and emails the
 * first hosted invoice immediately (send_invoice), then one per month; the
 * subscription is active regardless of invoice status. With
 * `billing_cycle_anchor` set to a future date, the first invoice is issued on
 * that date instead (no proration), and the subscription still exists now.
 */
export async function createOperatorSubscription(
  apiKey: string | undefined,
  params: CreateOperatorSubscriptionParams
): Promise<StripeSubscriptionResult> {
  const dollars = (params.monthly_amount_cents / 100).toFixed(2)
  if (!apiKey) {
    const devId = 'dev_sub_' + crypto.randomUUID()
    console.log(`[DEV] Stripe: would create $${dollars}/mo retainer subscription`)
    console.log(`[DEV] Stripe: customer_email=${params.customer_email}`)
    return { id: devId, status: 'active' }
  }

  const customerId = await resolveStripeCustomerId(apiKey, params.customer_email)
  const productId = await resolveRetainerProductId(apiKey)

  const body = new URLSearchParams()
  body.append('customer', customerId)
  body.append('collection_method', 'send_invoice')
  body.append('days_until_due', String(params.days_until_due ?? 30))
  body.append('description', 'Operator retainer')
  // Retainer cycle invoices are ACH only: the agreement's no-fee method. A
  // firm that wants to pay a cycle by card gets a card invoice with the
  // processing-fee line instead (§3.8); no fee-free card path exists.
  body.append('payment_settings[payment_method_types][]', 'ach_debit')
  body.append('items[0][price_data][unit_amount]', String(params.monthly_amount_cents))
  body.append('items[0][price_data][currency]', 'usd')
  body.append('items[0][price_data][product]', productId)
  body.append('items[0][price_data][recurring][interval]', 'month')
  if (params.billing_cycle_anchor !== undefined) {
    body.append('billing_cycle_anchor', String(params.billing_cycle_anchor))
    body.append('proration_behavior', 'none')
  }
  body.append('metadata[smd_entity_id]', params.entity_id)
  body.append('metadata[smd_subscription_id]', params.subscription_row_id)
  for (const [key, value] of Object.entries(params.metadata ?? {})) {
    body.append(`metadata[${key}]`, value)
  }

  const res = await fetch(`${STRIPE_API_BASE}/subscriptions`, {
    method: 'POST',
    headers: stripeHeaders(apiKey),
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`Stripe subscription creation failed ${res.status}: ${await res.text()}`)
  }
  const data: { id: string; status: string } = await res.json()
  return { id: data.id, status: data.status }
}

/**
 * Pause collection: cycle invoices generated while paused are voided — a
 * paused seat is never charged. The subscription object stays `active` in
 * Stripe's status vocabulary; `pause_collection` is the pause.
 */
export async function pauseOperatorSubscription(
  apiKey: string | undefined,
  subscriptionId: string
): Promise<StripeSubscriptionResult> {
  if (!apiKey) {
    console.log(`[DEV] Stripe: would pause collection on ${subscriptionId}`)
    return { id: subscriptionId, status: 'active' }
  }
  const body = new URLSearchParams()
  body.append('pause_collection[behavior]', 'void')
  const res = await fetch(`${STRIPE_API_BASE}/subscriptions/${subscriptionId}`, {
    method: 'POST',
    headers: stripeHeaders(apiKey),
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`Stripe pause failed ${res.status}: ${await res.text()}`)
  }
  const data: { id: string; status: string } = await res.json()
  return { id: data.id, status: data.status }
}

/**
 * Resume collection by clearing `pause_collection` (posting the bare key
 * unsets it). The dedicated /resume endpoint applies only to
 * charge_automatically subscriptions, not this send_invoice retainer.
 */
export async function resumeOperatorSubscription(
  apiKey: string | undefined,
  subscriptionId: string
): Promise<StripeSubscriptionResult> {
  if (!apiKey) {
    console.log(`[DEV] Stripe: would resume collection on ${subscriptionId}`)
    return { id: subscriptionId, status: 'active' }
  }
  const body = new URLSearchParams()
  body.append('pause_collection', '')
  const res = await fetch(`${STRIPE_API_BASE}/subscriptions/${subscriptionId}`, {
    method: 'POST',
    headers: stripeHeaders(apiKey),
    body: body.toString(),
  })
  if (!res.ok) {
    throw new Error(`Stripe resume failed ${res.status}: ${await res.text()}`)
  }
  const data: { id: string; status: string } = await res.json()
  return { id: data.id, status: data.status }
}

/**
 * Cancel immediately. The customer is not charged again; Stripe stops
 * automatic collection of finalized invoices. Used on decommission and by
 * the offboarding runbook (#1684).
 */
export async function cancelOperatorSubscription(
  apiKey: string | undefined,
  subscriptionId: string
): Promise<StripeSubscriptionResult> {
  if (!apiKey) {
    console.log(`[DEV] Stripe: would cancel subscription ${subscriptionId}`)
    return { id: subscriptionId, status: 'canceled' }
  }
  const res = await fetch(`${STRIPE_API_BASE}/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    throw new Error(`Stripe cancel failed ${res.status}: ${await res.text()}`)
  }
  const data: { id: string; status: string } = await res.json()
  return { id: data.id, status: data.status }
}

/** Fetch current subscription state (status + pause posture) for display/verification. */
export async function getOperatorSubscription(
  apiKey: string | undefined,
  subscriptionId: string
): Promise<{ id: string; status: string; paused: boolean }> {
  if (!apiKey) {
    console.log(`[DEV] Stripe: would get subscription ${subscriptionId}`)
    return { id: subscriptionId, status: 'active', paused: false }
  }
  const res = await fetch(`${STRIPE_API_BASE}/subscriptions/${subscriptionId}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) {
    throw new Error(`Stripe subscription get failed ${res.status}: ${await res.text()}`)
  }
  const data: { id: string; status: string; pause_collection: unknown } = await res.json()
  return {
    id: data.id,
    status: data.status,
    paused: data.pause_collection !== null && data.pause_collection !== undefined,
  }
}
