/**
 * Server-side people_access composition gate (client-portal §5.7).
 *
 * The Team surface (users, roles, PTO, voice profiles) is governed by the
 * `people_access` switchable authority domain (ADR 0041). At launch every
 * client switch is off (posture `managed`), so the client org does NOT operate
 * its own roster — SMD does, and the client sees Read + Request.
 *
 * The portal renders that decision (via <DomainSurface domain="people_access">),
 * but rendering is not enforcement. Every write endpoint that mutates the roster
 * — grant/revoke a role, send an invitation, set PTO — MUST re-check the same
 * composition here. A client-rendered read-only view is never trusted as the
 * gate; a hand-crafted POST to the mutation endpoint is refused on the same
 * authority logic. This mirrors the connectors-secret precedent (PR4), where the
 * write endpoint re-checks `isClientOperable` rather than trusting the UI.
 *
 * Pure read of the projected authority posture + the frozen `isClientOperable`
 * predicate. No mutation, no audit (the caller audits its own action).
 */

import type { D1Database } from '@cloudflare/workers-types'
import { getCustomerConfig } from '../customer-config'
import { isClientOperable } from '../../operator/authority'

/**
 * Is the client org allowed to operate its own people_access domain (roster,
 * roles, PTO) for this entity? `false` at launch (managed posture) and whenever
 * the config row is absent — fail-closed. When `false`, the client portal shows
 * Read + Request and the mutation endpoints refuse.
 */
export async function isPeopleAccessOperable(db: D1Database, entityId: string): Promise<boolean> {
  const config = await getCustomerConfig(db, entityId)
  return isClientOperable(config?.authority ?? null, 'people_access')
}
