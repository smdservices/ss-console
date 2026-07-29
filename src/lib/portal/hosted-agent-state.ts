/**
 * Hosted Agent portal state derivation (extracted from the product
 * landing during the portal IA rebuild, 2026-07-07) so the landing page
 * and the Home dashboard card derive the SAME truth from the same rows.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { getIntakeByEntity, type HostedAgentIntakeRow } from '../db/hosted-agent-intake'
import { getProductSubscription, listProductRoles, type SubscriptionRow } from './product-access'
import { HOSTED_AGENT_PRODUCT_SLUG } from './hosted-agent-access'

export type HostedAgentSurfaceState = 'no_subscription' | 'setup' | 'paused' | 'live' | 'no_role'

export interface HostedAgentState {
  surfaceState: HostedAgentSurfaceState
  subscription: SubscriptionRow | null
  intake: HostedAgentIntakeRow | null
  needsIntake: boolean
  needsKey: boolean
  keyReceived: boolean
}

/** Pure derivation from already-fetched rows. */
function deriveHostedAgentState(input: {
  subscription: SubscriptionRow | null
  roles: string[]
  intake: HostedAgentIntakeRow | null
}): HostedAgentState {
  const { subscription, roles, intake } = input
  let surfaceState: HostedAgentSurfaceState
  if (!subscription) {
    surfaceState = 'no_subscription'
  } else if (roles.length === 0) {
    surfaceState = 'no_role'
  } else if (subscription.status === 'paused') {
    surfaceState = 'paused'
  } else if (subscription.status === 'active' && intake?.status === 'live') {
    surfaceState = 'live'
  } else {
    surfaceState = 'setup'
  }

  const needsIntake = surfaceState === 'setup' && intake?.status === 'awaiting_intake'
  const needsKey =
    surfaceState === 'setup' &&
    intake !== null &&
    intake.anthropic_key_status === 'pending' &&
    intake.customer_slug !== null
  const keyReceived = intake?.anthropic_key_status === 'received'

  return { surfaceState, subscription, intake, needsIntake, needsKey, keyReceived }
}

export async function resolveHostedAgentState(
  db: D1Database,
  entityId: string,
  userId: string
): Promise<HostedAgentState> {
  const subscription = await getProductSubscription(db, entityId, HOSTED_AGENT_PRODUCT_SLUG)
  if (!subscription) {
    return deriveHostedAgentState({ subscription: null, roles: [], intake: null })
  }
  const [roles, intake] = await Promise.all([
    listProductRoles(db, userId, entityId, HOSTED_AGENT_PRODUCT_SLUG),
    getIntakeByEntity(db, entityId),
  ])
  return deriveHostedAgentState({ subscription, roles, intake })
}
