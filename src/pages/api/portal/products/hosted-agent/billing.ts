import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resolveHostedAgentAccess } from '../../../../../lib/portal/hosted-agent-access'
import { createBillingPortalSession } from '../../../../../lib/stripe/checkout'
import { getPortalBaseUrl } from '../../../../../lib/config/app-url'

/**
 * POST /api/portal/products/hosted-agent/billing (ADR 0067)
 *
 * "Manage billing" door on the live view: creates a Stripe Billing Portal
 * session for the subscriber's Stripe customer and 303s to it. This is how
 * the product terms' "cancel at any time from your portal" promise is kept:
 * cancellation, card updates, and invoices all happen on Stripe's surface.
 * Principal-gated; the Stripe customer id comes from the subscription's
 * settings_json (written by the checkout webhook), never from user input.
 */

const LANDING = '/portal/products/hosted-agent'

function back(cs: string): Response {
  return new Response(null, { status: 303, headers: { Location: `${LANDING}?cs=${cs}` } })
}

export const POST: APIRoute = async ({ locals }) => {
  const access = await resolveHostedAgentAccess(env.DB, locals, { allowedRoles: ['principal'] })
  if (access.kind === 'redirect') {
    return new Response(null, { status: 303, headers: { Location: access.to } })
  }

  const row = await env.DB.prepare(
    `SELECT settings_json FROM subscriptions
        WHERE entity_id = ? AND product_slug = 'hosted-agent'
          AND status IN ('provisioning', 'active', 'paused')
        ORDER BY created_at DESC LIMIT 1`
  )
    .bind(access.client.id)
    .first<{ settings_json: string | null }>()

  let stripeCustomerId: string | null = null
  try {
    const settings: unknown = row?.settings_json ? JSON.parse(row.settings_json) : null
    if (settings && typeof settings === 'object' && 'stripe_customer_id' in settings) {
      const v = (settings as Record<string, unknown>)['stripe_customer_id']
      stripeCustomerId = typeof v === 'string' && v.startsWith('cus_') ? v : null
    }
  } catch {
    stripeCustomerId = null
  }
  if (!stripeCustomerId) return back('billing_unavailable')

  try {
    const portalBase = getPortalBaseUrl(env) ?? ''
    const url = await createBillingPortalSession(
      env.STRIPE_API_KEY,
      stripeCustomerId,
      `${portalBase}${LANDING}`
    )
    return new Response(null, { status: 303, headers: { Location: url } })
  } catch (err) {
    console.error('[hosted-agent/billing] portal session failed:', err)
    return back('billing_error')
  }
}
