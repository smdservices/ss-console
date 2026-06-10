import { describe, it, expect } from 'vitest'
import { buildActionQueue } from '../src/lib/admin/home-actions'
import type { Invoice } from '../src/lib/db/invoices'
import type { ServiceListRow } from '../src/lib/admin/services-list'

function inv(entity_id: string, amount: number): Invoice {
  return { id: `i-${entity_id}`, entity_id, amount, status: 'overdue' } as Invoice
}
function svc(partial: Partial<ServiceListRow>): ServiceListRow {
  return {
    kind: 'consulting',
    clientId: 'c',
    clientName: 'Client',
    title: 'S',
    statusLabel: 'Active',
    tone: 'attention',
    value: null,
    risk: 'Handoff overdue 2d',
    riskTone: 'alert',
    riskRank: 1,
    href: '/admin/clients/c',
    ...partial,
  }
}

describe('buildActionQueue', () => {
  it('ranks alerts before warnings, and caps the list', () => {
    const items = buildActionQueue({
      overdueInvoices: [inv('e1', 1200)],
      atRiskServices: [
        svc({ riskTone: 'warn', risk: 'Safety-net ends in 3d', clientName: 'Bravo' }),
        svc({ riskTone: 'alert', risk: 'Handoff overdue 2d', clientName: 'Alpha' }),
      ],
      overdueFollowUpCount: 4,
      clientName: (id) => (id === 'e1' ? 'Acme' : id),
      limit: 7,
    })
    // first two are alert-tone (overdue invoice + overdue handoff)
    expect(items[0].tone).toBe('alert')
    expect(items[1].tone).toBe('alert')
    // warning and follow-ups come after
    expect(items.some((i) => i.type === 'Follow-up' && i.text === '4 follow-ups overdue')).toBe(
      true
    )
    expect(items.every((i) => ['alert', 'warn', 'muted'].includes(i.tone))).toBe(true)
  })

  it('formats the overdue invoice with client name and money, links to Billing', () => {
    const [item] = buildActionQueue({
      overdueInvoices: [inv('e1', 1200)],
      atRiskServices: [],
      overdueFollowUpCount: 0,
      clientName: () => 'Acme',
    })
    expect(item.text).toBe('Acme — $1,200 overdue')
    expect(item.href).toBe('/admin/billing')
  })

  it('omits the follow-up line when none are overdue', () => {
    const items = buildActionQueue({
      overdueInvoices: [],
      atRiskServices: [],
      overdueFollowUpCount: 0,
      clientName: () => 'x',
    })
    expect(items).toHaveLength(0)
  })

  it('respects the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => inv(`e${i}`, 100))
    const items = buildActionQueue({
      overdueInvoices: many,
      atRiskServices: [],
      overdueFollowUpCount: 0,
      clientName: () => 'x',
      limit: 3,
    })
    expect(items).toHaveLength(3)
  })
})
