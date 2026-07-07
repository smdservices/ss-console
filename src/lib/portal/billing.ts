/**
 * Portal billing helpers (portal IA rebuild, 2026-07-07).
 *
 * The Stripe customer id for a product subscription lives in
 * subscriptions.settings_json (written by the checkout webhook). This is
 * the single parse point for it — the generalized Manage-Billing
 * endpoint and the Billing surface both consume it. Extracted verbatim
 * from the hosted-agent billing endpoint's inline parsing.
 */

import type { D1Database } from '@cloudflare/workers-types'
import type { SubscriptionRow } from './product-access'

export function parseStripeCustomerId(settingsJson: string | null): string | null {
  try {
    const settings: unknown = settingsJson ? JSON.parse(settingsJson) : null
    if (settings && typeof settings === 'object' && 'stripe_customer_id' in settings) {
      const v = (settings as Record<string, unknown>)['stripe_customer_id']
      return typeof v === 'string' && v.startsWith('cus_') ? v : null
    }
  } catch {
    // fall through
  }
  return null
}

export async function getStripeCustomerIdForSubscription(
  db: D1Database,
  entityId: string,
  productSlug: string
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT settings_json FROM subscriptions
        WHERE entity_id = ? AND product_slug = ?
          AND status IN ('provisioning', 'active', 'paused')
        ORDER BY created_at DESC LIMIT 1`
    )
    .bind(entityId, productSlug)
    .first<{ settings_json: string | null }>()
  return parseStripeCustomerId(row?.settings_json ?? null)
}

/** Display names for subscription rows on the Billing surface. */
export const PRODUCT_DISPLAY_NAMES: Record<string, string> = {
  operator: 'Operator',
  'hosted-agent': 'Hosted Agent',
}

export function productDisplayName(sub: SubscriptionRow): string {
  return PRODUCT_DISPLAY_NAMES[sub.product_slug] ?? sub.product_slug
}
