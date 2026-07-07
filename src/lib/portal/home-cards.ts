/**
 * Home dashboard cards (portal IA rebuild, Captain decision 3): one card
 * per owned offering, each composed from existing readers only. Every
 * status label derives from real state; a card with nothing true renders
 * nothing extra (no fabricated aliveness, no invented queues).
 */

import type { D1Database } from '@cloudflare/workers-types'
import type { PortalOfferings } from './offerings'
import { resolveEngagementLabel } from './status'
import { subscriptionStatusLabel, type SubscriptionStatus } from './operator/account-read'
import { resolveAlivenessSignal } from './operator/aliveness'
import { readDraftQueueDepth } from './operator/home'
import { getCustomerConfig } from './customer-config'
import { resolveHostedAgentState } from './hosted-agent-state'
import { listInvoicesForEntity } from '../db/invoices'
import { formatShortDate } from './formatters'

export interface OfferingCard {
  key: 'engagement' | 'operator' | 'hosted-agent' | 'billing'
  label: string
  href: string
  statusLabel: string
  meta: string[]
  needsYou: { label: string; href: string } | null
}

function engagementCard(offerings: PortalOfferings): OfferingCard | null {
  const { activeEngagement, openProposal, pastEngagements, present } = offerings.engagement
  if (!present) return null

  const statusLabel = activeEngagement
    ? resolveEngagementLabel(activeEngagement.status)
    : openProposal
      ? 'Proposal awaiting your review'
      : 'Past work on record'

  const meta: string[] = []
  if (activeEngagement?.start_date) {
    meta.push(`Started ${formatShortDate(activeEngagement.start_date)}`)
  }
  if (!activeEngagement && pastEngagements.length > 0) {
    meta.push(
      `${pastEngagements.length} completed engagement${pastEngagements.length !== 1 ? 's' : ''}`
    )
  }

  return {
    key: 'engagement',
    label: 'Engagement',
    href: '/portal/engagement',
    statusLabel,
    meta,
    needsYou: openProposal
      ? {
          label: 'Proposal awaiting your signature',
          href: `/portal/engagement/proposals/${openProposal.id}`,
        }
      : null,
  }
}

async function operatorCard(
  db: D1Database,
  offerings: PortalOfferings
): Promise<OfferingCard | null> {
  const sub = offerings.operator
  if (!sub) return null

  const meta: string[] = []
  let needsYou: OfferingCard['needsYou'] = null
  const subStatus: SubscriptionStatus =
    sub.status === 'provisioning' || sub.status === 'active' || sub.status === 'paused'
      ? sub.status
      : 'unknown'
  const statusLabel = subscriptionStatusLabel(subStatus)

  try {
    const signal = await resolveAlivenessSignal(db, sub)
    if (signal?.lastActionAt) {
      meta.push(`Last action ${formatShortDate(signal.lastActionAt)}`)
    }
    const config = await getCustomerConfig(db, sub.entity_id)
    if (config?.customer_slug) {
      const depth = await readDraftQueueDepth(db, config.customer_slug)
      if (depth > 0) {
        needsYou = {
          label: `${depth} draft${depth !== 1 ? 's' : ''} waiting for review`,
          href: '/portal/products/operator',
        }
      }
    }
  } catch {
    // Card falls back to the subscription status alone — honest absence.
  }

  return {
    key: 'operator',
    label: 'Operator',
    href: '/portal/products/operator',
    statusLabel,
    meta,
    needsYou,
  }
}

async function hostedAgentCard(
  db: D1Database,
  offerings: PortalOfferings,
  userId: string
): Promise<OfferingCard | null> {
  const sub = offerings.hostedAgent
  if (!sub) return null

  const state = await resolveHostedAgentState(db, sub.entity_id, userId)
  const statusLabel =
    state.surfaceState === 'live'
      ? `${state.intake?.agent_name ?? 'Your agent'} is live`
      : state.surfaceState === 'paused'
        ? 'Paused'
        : 'Setup in progress'

  let needsYou: OfferingCard['needsYou'] = null
  if (state.needsIntake) {
    needsYou = {
      label: 'Complete the setup questionnaire',
      href: '/portal/products/hosted-agent/intake',
    }
  } else if (state.needsKey) {
    needsYou = {
      label: 'Add your Anthropic API key',
      href: '/portal/products/hosted-agent/api-key',
    }
  }

  return {
    key: 'hosted-agent',
    label: 'Agent',
    href: '/portal/products/hosted-agent',
    statusLabel,
    meta: [],
    needsYou,
  }
}

async function billingCard(
  db: D1Database,
  orgId: string,
  entityId: string,
  offerings: PortalOfferings
): Promise<OfferingCard | null> {
  if (!offerings.hasInvoices && offerings.subscriptions.length === 0) return null

  let needsYou: OfferingCard['needsYou'] = null
  let statusLabel = 'Up to date'
  const meta: string[] = []

  try {
    const invoices = await listInvoicesForEntity(db, orgId, entityId)
    const pending = invoices.find((i) => i.status === 'sent' || i.status === 'overdue') ?? null
    if (pending) {
      statusLabel = pending.status === 'overdue' ? 'Invoice overdue' : 'Invoice due'
      if (pending.due_date) meta.push(`Due ${formatShortDate(pending.due_date)}`)
      needsYou = { label: 'Pay invoice', href: `/portal/billing/invoices/${pending.id}` }
    }
  } catch {
    // Honest fallback: the card still links to the ledger.
  }

  return {
    key: 'billing',
    label: 'Billing',
    href: '/portal/billing',
    statusLabel,
    meta,
    needsYou,
  }
}

export async function loadHomeCards(
  db: D1Database,
  input: { orgId: string; entityId: string; userId: string; offerings: PortalOfferings }
): Promise<OfferingCard[]> {
  const [operator, hostedAgent, billing] = await Promise.all([
    operatorCard(db, input.offerings),
    hostedAgentCard(db, input.offerings, input.userId),
    billingCard(db, input.orgId, input.entityId, input.offerings),
  ])
  const cards = [engagementCard(input.offerings), operator, hostedAgent, billing]
  return cards.filter((c): c is OfferingCard => c !== null)
}
