import type { APIContext, APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { requireAdminSession } from '../../../../../lib/auth/admin-session'
import { getOperatorServiceForEntity } from '../../../../../lib/db/services'
import {
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
 *            Refused when: no subscriptions row (provisioning owns access
 *            grants, billing never creates one), no authored price (never
 *            invent a number), no billing contact, or billing already
 *            attached.
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

/** `start`: create + attach the Stripe subscription. Refusals return a
 * redirect query; billing never grants access and never invents a number. */
async function handleStart(
  orgId: string,
  entityId: string,
  sub: { id: string; stripe_subscription_id: string | null }
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
  })
  await attachStripeSubscription(env.DB, sub.id, created.id)
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
  try {
    action = parseAction((await request.formData()).get('action'))
  } catch {
    action = null
  }
  if (!action) return back('error=bad_billing_action')

  try {
    const sub = await getSubscriptionForBilling(env.DB, entityId, 'operator')
    if (!sub) return back('error=no_subscription_row')

    if (action === 'start') {
      return back(await handleStart(auth.session.orgId, entityId, sub))
    }
    if (!sub.stripe_subscription_id) return back('error=no_billing_attached')
    return back(await handleAttachedAction(action, sub.id, sub.stripe_subscription_id))
  } catch (err) {
    console.error('[api/admin/clients/subscription-billing] error:', err)
    return back('error=billing_server')
  }
}

export const POST: APIRoute = (ctx) => handlePost(ctx)
