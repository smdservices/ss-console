import type { APIContext, APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { requireAdminSession } from '../../../../../lib/auth/admin-session'
import { getOperatorServiceForEntity } from '../../../../../lib/db/services'
import {
  activateOperatorSubscriptionForBilling,
  attachStripeSubscription,
  getSubscriptionForBilling,
  setSubscriptionBillingStatus,
} from '../../../../../lib/db/subscriptions'
import {
  cancelOperatorSubscription,
  createOperatorSubscription,
  pauseOperatorSubscription,
  resumeOperatorSubscription,
} from '../../../../../lib/stripe/subscriptions'

/**
 * POST /api/admin/clients/[id]/subscription-billing
 *
 * Drives the Operator retainer's Stripe billing from the client hub
 * (#1679). Form field `action` ∈ start | pause | resume | cancel.
 *
 *   start  — creates the Stripe subscription (send_invoice, monthly) priced
 *            from the authored `services.recurring_price` (ADR 0063 wrote
 *            5000 on live seats) against the entity's primary contact email,
 *            and attaches it to the (entity,'operator') subscriptions row.
 *            Optional form field `billing_start` (YYYY-MM-DD, today or
 *            later): the Billing Start Date. Stripe issues the first cycle
 *            invoice on that date, no proration, and monthly from there; the
 *            subscription itself exists (and shows in the portal's Billing)
 *            from this act. Omitted = bill from now.
 *            Starting billing is ALSO the go-live flip: a `provisioning`
 *            operator row is promoted to `active` here, which is what reveals
 *            Home and Billing to the client (offerings.ts). Nothing else
 *            promotes an operator row; the webhooks are guarded against it.
 *            Refused when: no subscriptions row (provisioning owns access
 *            grants, billing never creates one), no authored price (never
 *            invent a number), no billing contact, billing already
 *            attached, or a billing_start in the past.
 *   pause  — pause_collection[behavior]=void at Stripe + local row `paused`.
 *   resume — clears pause_collection + local row `active`.
 *   cancel — cancels at Stripe immediately + local row `cancelled`.
 *
 * Local status is ALSO mirrored by the customer.subscription.* webhooks;
 * writing it here too keeps the console truthful between webhook deliveries.
 * Payment failure handling lives in the webhook (alert, never auto-act) —
 * see stripe-subscription-handler.ts and the offboarding doctrine (#1684).
 */

const ACTIONS = ['start', 'pause', 'resume', 'cancel'] as const
type BillingAction = (typeof ACTIONS)[number]

function parseAction(raw: FormDataEntryValue | null): BillingAction | null {
  return typeof raw === 'string' && (ACTIONS as readonly string[]).includes(raw)
    ? (raw as BillingAction)
    : null
}

async function getPrimaryContactEmail(
  db: D1Database,
  orgId: string,
  entityId: string
): Promise<string | null> {
  const contact = await db
    .prepare(
      'SELECT email FROM contacts WHERE org_id = ? AND entity_id = ? AND email IS NOT NULL ORDER BY created_at ASC LIMIT 1'
    )
    .bind(orgId, entityId)
    .first<{ email: string }>()
  return contact?.email ?? null
}

/**
 * Parse the optional Billing Start Date. Empty → undefined (bill now). A
 * date is anchored at 16:00 UTC (09:00 Arizona, business hours) so the cycle
 * invoice lands during the working day, not at midnight. Past dates are
 * refused: Stripe rejects a past anchor, and back-dated billing is not a
 * thing this console does. An anchor earlier today (already past 16:00 UTC)
 * is still "today": Stripe needs a future timestamp, so it becomes now + 5
 * minutes.
 */
export function parseBillingStart(
  raw: FormDataEntryValue | null,
  now: Date = new Date()
): { ok: true; anchor: number | undefined } | { ok: false } {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: true, anchor: undefined }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim())
  if (!m) return { ok: false }
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const anchorMs = Date.UTC(year, month - 1, day, 16, 0, 0)
  // Date.UTC rolls an impossible date forward (2026-13-40 → a real day in
  // 2027); a calendar date is valid only if it round-trips.
  const check = new Date(anchorMs)
  if (
    Number.isNaN(anchorMs) ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return { ok: false }
  }
  const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  if (anchorMs < todayStartMs) return { ok: false }
  const anchor = Math.max(anchorMs, now.getTime() + 5 * 60 * 1000)
  return { ok: true, anchor: Math.floor(anchor / 1000) }
}

/** `start`: create + attach the Stripe subscription, then promote the row to
 * active (go-live). Refusals return a redirect query; billing never grants
 * access and never invents a number. */
async function handleStart(
  orgId: string,
  entityId: string,
  sub: { id: string; stripe_subscription_id: string | null },
  billingStart: number | undefined
): Promise<string> {
  if (sub.stripe_subscription_id) return 'error=billing_already_attached'
  const service = await getOperatorServiceForEntity(env.DB, orgId, entityId)
  const price = service?.recurring_price
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return 'error=no_authored_price'
  }
  const email = await getPrimaryContactEmail(env.DB, orgId, entityId)
  if (!email) return 'error=no_billing_contact'

  const created = await createOperatorSubscription(env.STRIPE_API_KEY, {
    customer_email: email,
    monthly_amount_cents: Math.round(price * 100),
    entity_id: entityId,
    subscription_row_id: sub.id,
    billing_cycle_anchor: billingStart,
  })
  await attachStripeSubscription(env.DB, sub.id, created.id)
  await activateOperatorSubscriptionForBilling(env.DB, sub.id)
  return 'billing=started'
}

/** pause / resume / cancel: drive Stripe, mirror the local row. */
async function handleAttachedAction(
  action: 'pause' | 'resume' | 'cancel',
  subRowId: string,
  stripeSubscriptionId: string
): Promise<string> {
  if (action === 'pause') {
    await pauseOperatorSubscription(env.STRIPE_API_KEY, stripeSubscriptionId)
    await setSubscriptionBillingStatus(env.DB, subRowId, 'paused')
    return 'billing=paused'
  }
  if (action === 'resume') {
    await resumeOperatorSubscription(env.STRIPE_API_KEY, stripeSubscriptionId)
    await setSubscriptionBillingStatus(env.DB, subRowId, 'active')
    return 'billing=resumed'
  }
  await cancelOperatorSubscription(env.STRIPE_API_KEY, stripeSubscriptionId)
  await setSubscriptionBillingStatus(env.DB, subRowId, 'cancelled')
  return 'billing=cancelled'
}

async function handlePost({ request, locals, params, redirect }: APIContext): Promise<Response> {
  const auth = requireAdminSession(locals)
  if (!auth.ok) return auth.response

  const entityId = params.id
  if (!entityId) return redirect('/admin/clients?error=missing', 302)
  const back = (q: string) => redirect(`/admin/clients/${entityId}?${q}`, 302)

  let action: BillingAction | null
  let billingStart: ReturnType<typeof parseBillingStart> = { ok: true, anchor: undefined }
  try {
    const formData = await request.formData()
    action = parseAction(formData.get('action'))
    billingStart = parseBillingStart(formData.get('billing_start'))
  } catch {
    action = null
  }
  if (!action) return back('error=bad_billing_action')
  if (!billingStart.ok) return back('error=bad_billing_start')

  try {
    const sub = await getSubscriptionForBilling(env.DB, entityId, 'operator')
    if (!sub) return back('error=no_subscription_row')

    if (action === 'start') {
      return back(await handleStart(auth.session.orgId, entityId, sub, billingStart.anchor))
    }
    if (!sub.stripe_subscription_id) return back('error=no_billing_attached')
    return back(await handleAttachedAction(action, sub.id, sub.stripe_subscription_id))
  } catch (err) {
    console.error('[api/admin/clients/subscription-billing] error:', err)
    return back('error=billing_server')
  }
}

export const POST: APIRoute = (ctx) => handlePost(ctx)
