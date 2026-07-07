import { describe, it, expect } from 'vitest'
import { deriveOfferings } from '../src/lib/portal/offerings'
import { buildPortalNav, isNavDestinationActive } from '../src/lib/portal/nav'
import type { Engagement } from '../src/lib/db/engagements'
import type { Quote } from '../src/lib/db/quotes'
import type { SubscriptionRow } from '../src/lib/portal/product-access'

function engagement(status: string, id = `eng-${status}`): Engagement {
  return { id, status } as unknown as Engagement
}
function quote(status: string, id = `q-${status}`): Quote {
  return { id, status } as unknown as Quote
}
function subscription(slug: string, status = 'active'): SubscriptionRow {
  return { id: `sub-${slug}`, product_slug: slug, status } as unknown as SubscriptionRow
}

const NOTHING = { engagements: [], quotes: [], subscriptions: [], hasInvoices: false }

describe('deriveOfferings', () => {
  it('nothing owned: no engagement presence, no products, no invoices', () => {
    const o = deriveOfferings(NOTHING)
    expect(o.engagement.present).toBe(false)
    expect(o.operator).toBeNull()
    expect(o.hostedAgent).toBeNull()
    expect(o.hasInvoices).toBe(false)
  })

  it('proposal-only: present with an open proposal and no active engagement', () => {
    const o = deriveOfferings({ ...NOTHING, quotes: [quote('sent')] })
    expect(o.engagement.present).toBe(true)
    expect(o.engagement.openProposal?.id).toBe('q-sent')
    expect(o.engagement.activeEngagement).toBeNull()
  })

  it('active engagement without proposals', () => {
    const o = deriveOfferings({ ...NOTHING, engagements: [engagement('in_progress')] })
    expect(o.engagement.activeEngagement?.id).toBe('eng-in_progress')
    expect(o.engagement.openProposal).toBeNull()
    expect(o.engagement.pastEngagements).toHaveLength(0)
  })

  it('active engagement AND open follow-on proposal are orthogonal (both set)', () => {
    const o = deriveOfferings({
      ...NOTHING,
      engagements: [engagement('in_progress')],
      quotes: [quote('sent')],
    })
    expect(o.engagement.activeEngagement).not.toBeNull()
    expect(o.engagement.openProposal).not.toBeNull()
  })

  it('past-only: completed engagements keep the destination present', () => {
    const o = deriveOfferings({
      ...NOTHING,
      engagements: [engagement('completed'), engagement('cancelled', 'eng-2')],
    })
    expect(o.engagement.present).toBe(true)
    expect(o.engagement.activeEngagement).toBeNull()
    expect(o.engagement.pastEngagements).toHaveLength(2)
  })

  it('signed/declined quotes do not create an open proposal but keep presence', () => {
    const o = deriveOfferings({ ...NOTHING, quotes: [quote('accepted'), quote('declined', 'q2')] })
    expect(o.engagement.present).toBe(true)
    expect(o.engagement.openProposal).toBeNull()
  })

  it('products-only: subscriptions resolve by slug, engagement absent', () => {
    const o = deriveOfferings({
      ...NOTHING,
      subscriptions: [subscription('hosted-agent', 'provisioning'), subscription('operator')],
    })
    expect(o.engagement.present).toBe(false)
    expect(o.operator?.product_slug).toBe('operator')
    expect(o.hostedAgent?.status).toBe('provisioning')
  })
})

describe('buildPortalNav', () => {
  it('nothing owned: Home only', () => {
    const nav = buildPortalNav(deriveOfferings(NOTHING))
    expect(nav.map((d) => d.label)).toEqual(['Home'])
  })

  it('everything owned: all five destinations in fixed order with sequential anchors', () => {
    const nav = buildPortalNav(
      deriveOfferings({
        engagements: [engagement('in_progress')],
        quotes: [],
        subscriptions: [subscription('operator'), subscription('hosted-agent')],
        hasInvoices: true,
      })
    )
    expect(nav.map((d) => d.label)).toEqual(['Home', 'Engagement', 'Operator', 'Agent', 'Billing'])
    expect(nav.map((d) => d.anchor)).toEqual(['01', '02', '03', '04', '05'])
  })

  it('agent-only subscriber: Home, Agent, Billing (subscription implies billing)', () => {
    const nav = buildPortalNav(
      deriveOfferings({ ...NOTHING, subscriptions: [subscription('hosted-agent')] })
    )
    expect(nav.map((d) => d.label)).toEqual(['Home', 'Agent', 'Billing'])
    expect(nav.map((d) => d.anchor)).toEqual(['01', '02', '03'])
  })

  it('invoices alone light up Billing', () => {
    const nav = buildPortalNav(deriveOfferings({ ...NOTHING, hasInvoices: true }))
    expect(nav.map((d) => d.label)).toEqual(['Home', 'Billing'])
  })
})

describe('isNavDestinationActive', () => {
  const nav = buildPortalNav(
    deriveOfferings({
      engagements: [engagement('in_progress')],
      quotes: [],
      subscriptions: [subscription('operator')],
      hasInvoices: true,
    })
  )
  const byLabel = (label: string) => nav.find((d) => d.label === label)!

  it('Home is active only on the exact root', () => {
    expect(isNavDestinationActive(byLabel('Home'), '/portal')).toBe(true)
    expect(isNavDestinationActive(byLabel('Home'), '/portal/')).toBe(true)
    expect(isNavDestinationActive(byLabel('Home'), '/portal/engagement')).toBe(false)
  })

  it('destinations match self and descendants', () => {
    expect(isNavDestinationActive(byLabel('Engagement'), '/portal/engagement')).toBe(true)
    expect(isNavDestinationActive(byLabel('Engagement'), '/portal/engagement/proposals/abc')).toBe(
      true
    )
    expect(isNavDestinationActive(byLabel('Operator'), '/portal/engagement')).toBe(false)
  })
})
