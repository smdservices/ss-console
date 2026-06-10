import { describe, it, expect } from 'vitest'
import { sortInvoicesForBilling, oneTimeTotals } from '../src/lib/admin/billing-view'
import type { Invoice } from '../src/lib/db/invoices'

function inv(
  id: string,
  amount: number,
  status: string,
  created = '2026-01-01T00:00:00Z'
): Invoice {
  return {
    id,
    org_id: 'o',
    engagement_id: null,
    entity_id: 'e',
    type: 'deposit',
    amount,
    description: null,
    status,
    stripe_invoice_id: null,
    stripe_hosted_url: null,
    due_date: null,
    sent_at: null,
    paid_at: null,
    payment_method: null,
    created_at: created,
    updated_at: created,
  }
}

describe('sortInvoicesForBilling', () => {
  it('orders by money-owed first: overdue, sent, draft, paid, void', () => {
    const sorted = sortInvoicesForBilling([
      inv('paid', 1, 'paid'),
      inv('overdue', 1, 'overdue'),
      inv('void', 1, 'void'),
      inv('sent', 1, 'sent'),
      inv('draft', 1, 'draft'),
    ])
    expect(sorted.map((i) => i.id)).toEqual(['overdue', 'sent', 'draft', 'paid', 'void'])
  })

  it('breaks ties by most-recent created_at', () => {
    const sorted = sortInvoicesForBilling([
      inv('old', 1, 'sent', '2026-01-01T00:00:00Z'),
      inv('new', 1, 'sent', '2026-06-01T00:00:00Z'),
    ])
    expect(sorted.map((i) => i.id)).toEqual(['new', 'old'])
  })
})

describe('oneTimeTotals', () => {
  it('derives invoiced/paid/outstanding and overdue count + amount', () => {
    const t = oneTimeTotals([
      inv('a', 5000, 'paid'),
      inv('b', 3000, 'sent'),
      inv('c', 1000, 'overdue'),
      inv('d', 600, 'overdue'),
      inv('e', 9999, 'draft'),
    ])
    expect(t.invoiced).toBe(9600) // paid + sent + overdue (draft excluded)
    expect(t.paid).toBe(5000)
    expect(t.outstanding).toBe(4600) // sent + overdue
    expect(t.overdueCount).toBe(2)
    expect(t.overdueAmount).toBe(1600)
  })
})
