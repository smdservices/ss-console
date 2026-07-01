/**
 * Portal home data reader.
 *
 * Keeps the portal landing page out of raw SQL while preserving its home-only
 * rules: one current engagement, active-engagement invoices, recent proposals,
 * and completed milestone timeline entries.
 */

import { getActiveEngagementForEntities, type Engagement } from '../db/engagements'
import { listInvoices, type Invoice } from '../db/invoices'
import { listMilestones, type Milestone } from '../db/milestones'
import { listQuotes, type Quote } from '../db/quotes'

export type PortalHomeEngagement = Pick<
  Engagement,
  | 'id'
  | 'status'
  | 'scope_summary'
  | 'start_date'
  | 'estimated_end'
  | 'consultant_name'
  | 'consultant_phone'
  | 'next_touchpoint_at'
  | 'next_touchpoint_label'
>

export type PortalHomeInvoice = Pick<
  Invoice,
  'id' | 'amount' | 'status' | 'due_date' | 'sent_at' | 'paid_at'
>

export type PortalHomeQuote = Pick<Quote, 'id' | 'status' | 'sent_at' | 'accepted_at'>

export type PortalHomeMilestone = Pick<Milestone, 'id' | 'name' | 'completed_at'>

export interface PortalHomeDashboard {
  activeEngagement: PortalHomeEngagement | null
  pendingInvoice: PortalHomeInvoice | null
  invoices: PortalHomeInvoice[]
  quotes: PortalHomeQuote[]
  completedMilestones: PortalHomeMilestone[]
}

const PORTAL_HOME_ENGAGEMENT_STATUSES = new Set(['scheduled', 'active', 'handoff', 'safety_net'])

export async function loadPortalHomeDashboard(
  db: D1Database,
  orgId: string,
  entityId: string
): Promise<PortalHomeDashboard> {
  const [activeEngagement, quotes] = await Promise.all([
    loadActiveEngagement(db, orgId, entityId),
    loadPortalHomeQuotes(db, orgId, entityId),
  ])

  if (!activeEngagement) {
    return {
      activeEngagement: null,
      pendingInvoice: null,
      invoices: [],
      quotes,
      completedMilestones: [],
    }
  }

  const [invoices, completedMilestones] = await Promise.all([
    loadPortalHomeInvoices(db, orgId, entityId, activeEngagement.id),
    loadCompletedMilestones(db, orgId, activeEngagement.id),
  ])

  return {
    activeEngagement,
    pendingInvoice: selectPendingInvoice(invoices),
    invoices,
    quotes,
    completedMilestones,
  }
}

async function loadActiveEngagement(
  db: D1Database,
  orgId: string,
  entityId: string
): Promise<PortalHomeEngagement | null> {
  const rows = await getActiveEngagementForEntities(db, orgId, [entityId])
  const engagement = rows.get(entityId)
  if (!engagement || !PORTAL_HOME_ENGAGEMENT_STATUSES.has(engagement.status)) {
    return null
  }
  return {
    id: engagement.id,
    status: engagement.status,
    scope_summary: engagement.scope_summary,
    start_date: engagement.start_date,
    estimated_end: engagement.estimated_end,
    consultant_name: engagement.consultant_name,
    consultant_phone: engagement.consultant_phone,
    next_touchpoint_at: engagement.next_touchpoint_at,
    next_touchpoint_label: engagement.next_touchpoint_label,
  }
}

async function loadPortalHomeInvoices(
  db: D1Database,
  orgId: string,
  entityId: string,
  engagementId: string
): Promise<PortalHomeInvoice[]> {
  const invoices = await listInvoices(db, orgId, { entityId, engagementId })
  return invoices
    .filter((invoice) => invoice.status !== 'void')
    .map((invoice) => ({
      id: invoice.id,
      amount: invoice.amount,
      status: invoice.status,
      due_date: invoice.due_date,
      sent_at: invoice.sent_at,
      paid_at: invoice.paid_at,
    }))
}

async function loadPortalHomeQuotes(
  db: D1Database,
  orgId: string,
  entityId: string
): Promise<PortalHomeQuote[]> {
  const quotes = await listQuotes(db, orgId, entityId)
  return quotes.slice(0, 5).map((quote) => ({
    id: quote.id,
    status: quote.status,
    sent_at: quote.sent_at,
    accepted_at: quote.accepted_at,
  }))
}

async function loadCompletedMilestones(
  db: D1Database,
  orgId: string,
  engagementId: string
): Promise<PortalHomeMilestone[]> {
  const milestones = await listMilestones(db, orgId, engagementId)
  return milestones
    .filter((milestone) => milestone.status === 'completed' && milestone.completed_at !== null)
    .sort((a, b) => {
      if (!a.completed_at || !b.completed_at) return 0
      return a.completed_at < b.completed_at ? 1 : -1
    })
    .slice(0, 5)
    .map((milestone) => ({
      id: milestone.id,
      name: milestone.name,
      completed_at: milestone.completed_at,
    }))
}

function selectPendingInvoice(invoices: PortalHomeInvoice[]): PortalHomeInvoice | null {
  const pending = invoices.filter(
    (invoice) => invoice.status === 'sent' || invoice.status === 'overdue'
  )
  pending.sort((a, b) => {
    if (a.due_date && b.due_date) return a.due_date < b.due_date ? -1 : 1
    if (a.due_date) return -1
    if (b.due_date) return 1
    return 0
  })
  return pending[0] ?? null
}
