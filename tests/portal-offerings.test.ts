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
  // Operator subs carry an instance_slug (the instance identity); for the tests
  // the slug equals the product slug so it humanizes back to "Operator".
  return {
    id: `sub-${slug}`,
    product_slug: slug,
    instance_slug: slug === 'operator' ? 'operator' : null,
    status,
    service_id: null,
  } as unknown as SubscriptionRow
}

const NOTHING = {
  engagements: [],
  quotes: [],
  subscriptions: [],
  operatorConfigs: [],
  hasInvoices: false,
}

describe('deriveOfferings', () => {
  it('nothing owned: no engagement presence, no products, no invoices', () => {
    const o = deriveOfferings(NOTHING)
    expect(o.engagement.present).toBe(false)
    expect(o.operators).toEqual([])
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
    expect(o.operators).toHaveLength(1)
    expect(o.operators[0].slug).toBe('operator')
    expect(o.hostedAgent?.status).toBe('provisioning')
  })

  it('multi-operator: one entry per operator subscription, addressed by instance_slug', () => {
    const smd = {
      id: 'sub-smd',
      product_slug: 'operator',
      instance_slug: 'smd',
      status: 'active',
      service_id: null,
    } as unknown as SubscriptionRow
    const pilot = {
      id: 'sub-pilot',
      product_slug: 'operator',
      instance_slug: 'pilot-smokeball',
      status: 'active',
      service_id: null,
    } as unknown as SubscriptionRow
    const o = deriveOfferings({
      ...NOTHING,
      subscriptions: [smd, pilot],
      operatorConfigs: [{ customer_slug: 'smd', role: 'AI Case Coordinator' }],
    })
    expect(o.operators.map((op) => op.slug)).toEqual(['smd', 'pilot-smokeball'])
    // Client-facing name is ALWAYS the neutral "Operator" — never a persona name.
    expect(o.operators.map((op) => op.displayName)).toEqual(['Operator', 'Operator'])
    // role (the persona title) is the disambiguator; null when no config/title.
    expect(o.operators[0].role).toBe('AI Case Coordinator')
    expect(o.operators[1].role).toBeNull()
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
        operatorConfigs: [],
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

  it('MANY operators still produce exactly ONE Operator tab (no per-instance tabs)', () => {
    const op = (slug: string) =>
      ({
        id: `sub-${slug}`,
        product_slug: 'operator',
        instance_slug: slug,
        status: 'active',
        service_id: null,
      }) as unknown as SubscriptionRow
    const nav = buildPortalNav(
      deriveOfferings({
        ...NOTHING,
        subscriptions: [op('smd'), op('pilot-smokeball'), op('third')],
        operatorConfigs: [],
      })
    )
    const operatorTabs = nav.filter((d) => d.label === 'Operator')
    expect(operatorTabs).toHaveLength(1)
    expect(operatorTabs[0].href).toBe('/portal/products/operator')
    // The whole nav stays the small category set regardless of operator count.
    expect(nav.map((d) => d.label)).toEqual(['Home', 'Operator', 'Billing'])
  })
})

describe('isNavDestinationActive', () => {
  const nav = buildPortalNav(
    deriveOfferings({
      engagements: [engagement('in_progress')],
      quotes: [],
      subscriptions: [subscription('operator')],
      operatorConfigs: [],
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
