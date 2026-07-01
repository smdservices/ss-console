/**
 * Portal invoice detail reader.
 *
 * Keeps the deep-link invoice page out of raw SQL while preserving the portal
 * access rule: invoice first resolves through entity + org scope, then related
 * detail rows are loaded from that scoped invoice.
 */

import {
  getInvoiceForEntity,
  listLineItemsForInvoice,
  type Invoice,
  type InvoiceLineItem,
} from '../db/invoices'

export interface PortalInvoiceEngagement {
  id: string
  consultant_name: string | null
  consultant_phone: string | null
}

export interface PortalInvoiceDetail {
  invoice: Invoice
  lineItems: InvoiceLineItem[]
  engagement: PortalInvoiceEngagement | null
}

export async function loadPortalInvoiceDetail(
  db: D1Database,
  orgId: string,
  entityId: string,
  invoiceId: string
): Promise<PortalInvoiceDetail | null> {
  const invoice = await getInvoiceForEntity(db, orgId, entityId, invoiceId)
  if (!invoice) return null

  const [lineItems, engagement] = await Promise.all([
    listLineItemsForInvoice(db, invoice.id),
    loadInvoiceEngagement(db, orgId, invoice.engagement_id),
  ])

  return { invoice, lineItems, engagement }
}

async function loadInvoiceEngagement(
  db: D1Database,
  orgId: string,
  engagementId: string | null
): Promise<PortalInvoiceEngagement | null> {
  if (!engagementId) return null

  const row = await db
    .prepare(
      `SELECT id, consultant_name, consultant_phone
       FROM engagements
       WHERE id = ? AND org_id = ?`
    )
    .bind(engagementId, orgId)
    .first<PortalInvoiceEngagement>()

  return row ?? null
}
