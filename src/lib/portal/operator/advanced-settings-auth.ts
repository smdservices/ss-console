/**
 * Shared authorization for the Advanced-settings write endpoints.
 *
 * Both endpoints behind `/settings/advanced` — the customer.yaml submission
 * and the output-class spec writer — gate on the same four facts: a portal
 * session, an Operator subscription on the addressed instance, a config row
 * that belongs to THIS client's entity, and the caller holding `principal` on
 * (entity, 'operator'). One implementation, because two copies of an
 * authorization check is how one of them ends up a version behind.
 *
 * Returns the resolved context or `null`. The caller owns the failure
 * response: these are form POSTs that redirect, and each route knows its own
 * redirect target.
 */

import { getPortalClient } from '../session'
import { getOperatorSubscriptionByInstance, listProductRoles } from '../product-access'
import { getCustomerConfigBySlug } from '../customer-config'

const PRODUCT_SLUG = 'operator'

export interface AdvancedSettingsAuth {
  userId: string
  userEmail: string
  /** The owning `entities.id`. */
  entityId: string
  /** The addressed instance slug — the fleet identity, NOT the entity id. */
  customerSlug: string
}

export async function authorizeAdvancedSettings(
  db: D1Database,
  locals: App.Locals,
  instance: string
): Promise<AdvancedSettingsAuth | null> {
  const portalData = await getPortalClient(db, locals)
  if (!portalData?.client) return null
  const { user, client } = portalData

  // Ownership guard: the addressed instance's config must belong to this client.
  const config = await getCustomerConfigBySlug(db, instance)
  if (!config || config.entity_id !== client.id) return null

  const subscription = await getOperatorSubscriptionByInstance(db, client.id, instance)
  if (!subscription) return null

  const callerRoles = await listProductRoles(db, user.id, client.id, PRODUCT_SLUG)
  if (!callerRoles.includes('principal')) return null

  return {
    userId: user.id,
    userEmail: user.email,
    entityId: client.id,
    customerSlug: instance,
  }
}
