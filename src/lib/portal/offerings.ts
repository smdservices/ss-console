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
import { listCustomerConfigsForEntity } from './customer-config'

const ENGAGEMENT_TERMINAL_STATUSES = new Set(['completed', 'cancelled'])

export interface EngagementOfferings {
  /** Any engagement row or portal-visible quote exists. */
  present: boolean
  activeEngagement: Engagement | null
  /** Most recent quote awaiting the client (status 'sent'). */
  openProposal: Quote | null
  pastEngagements: Engagement[]
}

/**
 * One operator the client owns (multi-operator model). An operator instance is a
 * subscription row + its config, addressed by `slug` (the config's customer_slug,
 * carried on the subscription as instance_slug).
 *
 * `displayName` is the neutral, client-facing product name — "Operator" — never
 * the internal persona name (Crane, Quinn), by rule (Captain 2026-07-08). `role`
 * (the persona title, e.g. "AI Case Coordinator") is the client-facing
 * disambiguator when a client owns more than one.
 */
export interface OperatorInstance {
  slug: string
  subscription: SubscriptionRow
  displayName: string
  role: string | null
  status: string
}

/** Lite view of an operator config, passed into the pure derivation. */
export interface OperatorConfigLite {
  customer_slug: string
  /** Active persona title/role — the client-facing disambiguator. */
  role: string | null
}

/** The neutral client-facing operator name. A client never sees a persona name. */
const NEUTRAL_OPERATOR_NAME = 'Operator'

export interface PortalOfferings {
  engagement: EngagementOfferings
  /** Every operator the client owns, in subscription created_at order. */
  operators: OperatorInstance[]
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
  operatorConfigs: OperatorConfigLite[]
  hasInvoices: boolean
}): PortalOfferings {
  const activeEngagement =
    input.engagements.find((e) => !ENGAGEMENT_TERMINAL_STATUSES.has(e.status)) ?? null
  const pastEngagements = input.engagements.filter((e) =>
    ENGAGEMENT_TERMINAL_STATUSES.has(e.status)
  )
  const openProposal = input.quotes.find((q) => q.status === 'sent') ?? null

  const bySlug = (slug: string) => input.subscriptions.find((s) => s.product_slug === slug) ?? null
  const roleFor = (slug: string) =>
    input.operatorConfigs.find((c) => c.customer_slug === slug)?.role ?? null

  // One entry per operator subscription. instance_slug is the instance identity;
  // a defensive filter drops any malformed operator sub with no instance_slug so
  // it never renders a broken (slug-less) card/URL. displayName is the neutral
  // product name; role disambiguates when there are several.
  const operators: OperatorInstance[] = input.subscriptions
    .filter((s) => s.product_slug === 'operator' && !!s.instance_slug)
    .map((s) => ({
      slug: s.instance_slug as string,
      subscription: s,
      displayName: NEUTRAL_OPERATOR_NAME,
      role: roleFor(s.instance_slug as string),
      status: s.status,
    }))

  return {
    engagement: {
      present: activeEngagement !== null || pastEngagements.length > 0 || input.quotes.length > 0,
      activeEngagement,
      openProposal,
      pastEngagements,
    },
    operators,
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
  const [engagements, quotes, subscriptions, configs, hasInvoices] = await Promise.all([
    listEngagements(db, orgId, entityId),
    listQuotesForEntity(db, orgId, entityId),
    listActiveSubscriptionsForEntity(db, entityId),
    listCustomerConfigsForEntity(db, entityId),
    hasPortalVisibleInvoices(db, entityId),
  ])
  const operatorConfigs: OperatorConfigLite[] = configs.map((c) => ({
    customer_slug: c.customer_slug,
    role: operatorRole(c.personas),
  }))
  return deriveOfferings({ engagements, quotes, subscriptions, operatorConfigs, hasInvoices })
}

/**
 * The client-facing ROLE of an operator — its active persona's title (e.g. "AI
 * Case Coordinator"). This is the disambiguator shown alongside the neutral
 * "Operator" name; it is a role, never a persona name. Null when no active
 * persona / no title.
 */
function operatorRole(personas: { status: string; title: string | null }[]): string | null {
  const active = personas.find((p) => p.status === 'active')
  return active?.title?.trim() || null
}
