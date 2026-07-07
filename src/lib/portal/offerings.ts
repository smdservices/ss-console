/**
 * THE portal offerings resolver (portal IA rebuild, 2026-07-07).
 *
 * One module answers "what does this entity own?" for every portal
 * surface: the nav (buildPortalNav), the Home dashboard cards, and the
 * engagement destination's states all consume the same object, so the
 * tab set can never drift page-to-page again (the defect that triggered
 * the rebuild: per-page boolean props).
 *
 * Engagement facts are ORTHOGONAL, not a single state: an active client
 * can hold an open follow-on proposal at the same time (Decision #27
 * posture), and the engagement page renders the proposal spotlight above
 * the active workspace when both are set.
 */

import type { D1Database } from '@cloudflare/workers-types'
import { listEngagements, type Engagement } from '../db/engagements'
import { listQuotesForEntity, type Quote } from '../db/quotes'
import { listActiveSubscriptionsForEntity, type SubscriptionRow } from './product-access'

const ENGAGEMENT_TERMINAL_STATUSES = new Set(['completed', 'cancelled'])

export interface EngagementOfferings {
  /** Any engagement row or portal-visible quote exists. */
  present: boolean
  activeEngagement: Engagement | null
  /** Most recent quote awaiting the client (status 'sent'). */
  openProposal: Quote | null
  pastEngagements: Engagement[]
}

export interface PortalOfferings {
  engagement: EngagementOfferings
  operator: SubscriptionRow | null
  hostedAgent: SubscriptionRow | null
  /** Any portal-visible invoice exists (drives the Billing destination). */
  hasInvoices: boolean
  subscriptions: SubscriptionRow[]
}

/** Pure derivation from already-fetched rows; unit-tested in isolation. */
export function deriveOfferings(input: {
  engagements: Engagement[]
  quotes: Quote[]
  subscriptions: SubscriptionRow[]
  hasInvoices: boolean
}): PortalOfferings {
  const activeEngagement =
    input.engagements.find((e) => !ENGAGEMENT_TERMINAL_STATUSES.has(e.status)) ?? null
  const pastEngagements = input.engagements.filter((e) =>
    ENGAGEMENT_TERMINAL_STATUSES.has(e.status)
  )
  const openProposal = input.quotes.find((q) => q.status === 'sent') ?? null

  const bySlug = (slug: string) => input.subscriptions.find((s) => s.product_slug === slug) ?? null

  return {
    engagement: {
      present: activeEngagement !== null || pastEngagements.length > 0 || input.quotes.length > 0,
      activeEngagement,
      openProposal,
      pastEngagements,
    },
    operator: bySlug('operator'),
    hostedAgent: bySlug('hosted-agent'),
    hasInvoices: input.hasInvoices,
    subscriptions: input.subscriptions,
  }
}

async function hasPortalVisibleInvoices(db: D1Database, entityId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS present FROM invoices
        WHERE entity_id = ? AND status IN ('sent', 'paid', 'overdue') LIMIT 1`
    )
    .bind(entityId)
    .first<{ present: number }>()
  return row !== null
}

export async function resolvePortalOfferings(
  db: D1Database,
  orgId: string,
  entityId: string
): Promise<PortalOfferings> {
  const [engagements, quotes, subscriptions, hasInvoices] = await Promise.all([
    listEngagements(db, orgId, entityId),
    listQuotesForEntity(db, orgId, entityId),
    listActiveSubscriptionsForEntity(db, entityId),
    hasPortalVisibleInvoices(db, entityId),
  ])
  return deriveOfferings({ engagements, quotes, subscriptions, hasInvoices })
}
