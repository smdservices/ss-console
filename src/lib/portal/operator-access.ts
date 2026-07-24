/**
 * Shared access gate for the Operator product surfaces under
 * `/portal/products/operator/*`.
 *
 * Every product surface needs the same four checks, in order:
 *
 *   1. Clerk session present                  → otherwise sign-in
 *   2. Local entity bound to Clerk org        → otherwise sign-in with no_subscription marker
 *   3. Operator subscription on the entity → otherwise landing page (which renders the
 *                                                no_subscription / provisioning / paused state)
 *   4. Caller holds at least one allowed role → otherwise landing page (no_role state)
 *
 * Each surface differs only in which roles it accepts. Drafts, matters, and calendar are
 * for active users (staff or principal); audit is open to all three roles since
 * compliance is the dedicated viewer; settings is principal-only.
 *
 * Status check: this helper treats provisioning, active, and paused subscriptions as
 * "exists" — same posture as `getProductSubscription`. Surfaces render their empty
 * state regardless of lifecycle status. The landing page is the only surface that
 * branches on status (see src/pages/portal/products/operator/index.astro).
 */

import type { Entity } from '../db/entities'
import type { PortalUserRow } from '../auth/clerk-bridge'
import { getPortalClient } from './session'
import {
  getOperatorSubscriptionByInstance,
  listProductRoles,
  type SubscriptionRow,
} from './product-access'
import { getCustomerConfigBySlug, type CustomerConfigRow } from './customer-config'

export const OPERATOR_PRODUCT_SLUG = 'operator'

export const OPERATOR_LANDING_PATH = '/portal/products/operator'
export const PORTAL_SIGN_IN_PATH = '/auth/sign-in'
export const PORTAL_SIGN_IN_NO_SUBSCRIPTION_PATH = `${PORTAL_SIGN_IN_PATH}?status=no_subscription`

export type OperatorAccess =
  | { kind: 'redirect'; to: string }
  | {
      kind: 'allowed'
      user: PortalUserRow
      client: Entity
      subscription: SubscriptionRow
      roles: string[]
      /** The addressed instance's slug (= config.customer_slug). */
      customerSlug: string
      /** The addressed instance's config — callers use this instead of re-reading. */
      config: CustomerConfigRow
    }

export interface ResolveOperatorAccessOptions {
  /**
   * Roles that grant access to the surface. Any one match is enough. Pass the
   * canonical product_roles vocabulary values (`principal`, `staff`,
   * `compliance`) — typos will silently 401 every visitor.
   */
  allowedRoles: readonly string[]
  /**
   * Which operator INSTANCE is being addressed (its customer_slug, from the
   * `[instance]` route segment). Multi-operator: an entity may own several, so
   * the slug — not the entity alone — identifies the operator. Access is granted
   * only when this slug's config belongs to the signed-in client's entity (the
   * cross-entity guard) and a live subscription exists for it.
   */
  customerSlug: string
}

/**
 * Resolve access for an Operator product surface. Returns either a redirect
 * target (caller does `Astro.redirect(access.to)`) or the resolved
 * user/client/subscription/roles tuple ready to render.
 *
 * The helper does not call `Astro.redirect` itself because Astro's redirect is
 * a context-bound method on the page; returning the path keeps the helper
 * unit-testable with a plain DB + locals.
 */
export async function resolveOperatorAccess(
  db: D1Database,
  locals: App.Locals,
  options: ResolveOperatorAccessOptions
): Promise<OperatorAccess> {
  const portalData = await getPortalClient(db, locals)
  if (!portalData) {
    return { kind: 'redirect', to: PORTAL_SIGN_IN_PATH }
  }
  if (!portalData.client) {
    return { kind: 'redirect', to: PORTAL_SIGN_IN_NO_SUBSCRIPTION_PATH }
  }

  const { user, client } = portalData

  // Resolve the addressed instance by slug and enforce ownership: the config must
  // belong to THIS client's entity. Without this guard a user could open another
  // client's operator by guessing its slug. A missing/foreign config redirects to
  // the client's own operator list (never leaks that the slug exists elsewhere).
  const config = await getCustomerConfigBySlug(db, options.customerSlug)
  if (!config || config.entity_id !== client.id) {
    return { kind: 'redirect', to: OPERATOR_LANDING_PATH }
  }

  const subscription = await getOperatorSubscriptionByInstance(db, client.id, options.customerSlug)
  if (!subscription) {
    return { kind: 'redirect', to: OPERATOR_LANDING_PATH }
  }

  const roles = await listProductRoles(db, user.id, client.id, OPERATOR_PRODUCT_SLUG)
  const hasAllowedRole = options.allowedRoles.some((r) => roles.includes(r))
  if (!hasAllowedRole) {
    return { kind: 'redirect', to: OPERATOR_LANDING_PATH }
  }

  return {
    kind: 'allowed',
    user,
    client,
    subscription,
    roles,
    customerSlug: options.customerSlug,
    config,
  }
}
