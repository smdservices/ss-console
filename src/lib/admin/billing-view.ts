/**
 * Billing view composition (ADR 0046).
 *
 * The bi-modal money surface. One-time totals are fully derived from
 * invoices. The recurring side is honest about the schema gap: there is
 * no recurring-price column yet (Operator pricing is doctrinally
 * deferred), so this module exposes a real *count* of active operator
 * subscriptions and never fabricates an MRR dollar figure.
 */

import type { Invoice } from '../db/invoices'
import { computeBillingRollup } from './client-hub'

/** Worklist ordering: money owed first, settled last. */
const STATUS_ORDER: Record<string, number> = {
  overdue: 0,
  sent: 1,
  draft: 2,
  paid: 3,
  void: 4,
}

export function sortInvoicesForBilling(invoices: Invoice[]): Invoice[] {
  return [...invoices].sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      b.created_at.localeCompare(a.created_at)
  )
}

export interface OneTimeTotals {
  invoiced: number
  paid: number
  outstanding: number
  overdueCount: number
  overdueAmount: number
}

export function oneTimeTotals(invoices: Invoice[]): OneTimeTotals {
  const base = computeBillingRollup(invoices)
  let overdueCount = 0
  let overdueAmount = 0
  for (const inv of invoices) {
    if (inv.status === 'overdue') {
      overdueCount += 1
      overdueAmount += inv.amount
    }
  }
  return {
    invoiced: base.invoiced,
    paid: base.paid,
    outstanding: base.outstanding,
    overdueCount,
    overdueAmount,
  }
}
