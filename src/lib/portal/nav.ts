/**
 * Portal navigation model (portal IA rebuild, 2026-07-07).
 *
 * Pure function from PortalOfferings to the ordered destination list —
 * offerings as destinations, fully composed (Captain decisions 1, 2, 10):
 *
 *   Home        always
 *   Engagement  when any engagement or proposal exists
 *   Operator    ONE tab when the client owns any operator (the list lives inside)
 *   Agent       when a hosted-agent subscription exists
 *   Billing     when any invoice or subscription exists
 *
 * Section anchors are assigned sequentially at build time so there is no
 * conditional-anchor arithmetic anywhere.
 */

import type { PortalOfferings } from './offerings'

export interface PortalNavDestination {
  href: string
  label: string
  /** Escape hatch for narrow mobile cells; unused initially. */
  mobileLabel?: string
  anchor: string
  matchPrefix: string
  /** Home matches exactly; everything else matches by prefix. */
  exact?: boolean
}

export function buildPortalNav(offerings: PortalOfferings): PortalNavDestination[] {
  const destinations: Omit<PortalNavDestination, 'anchor'>[] = [
    { href: '/portal', label: 'Home', matchPrefix: '/portal', exact: true },
  ]
  if (offerings.engagement.present) {
    destinations.push({
      href: '/portal/engagement',
      label: 'Engagement',
      matchPrefix: '/portal/engagement',
    })
  }
  // ONE "Operator" destination for the product, regardless of how many operators
  // the client owns — the same category-per-tab shape as Engagement/Agent/Billing.
  // It opens the operator list (which auto-forwards to the sole operator when
  // there is only one); per-operator navigation lives inside that destination, not
  // across the top (a client with 50 operators must not get 50 tabs).
  if (offerings.operators.length > 0) {
    destinations.push({
      href: '/portal/products/operator',
      label: 'Operator',
      matchPrefix: '/portal/products/operator',
    })
  }
  if (offerings.hostedAgent) {
    destinations.push({
      href: '/portal/products/hosted-agent',
      label: 'Agent',
      matchPrefix: '/portal/products/hosted-agent',
    })
  }
  if (offerings.hasInvoices || offerings.subscriptions.length > 0) {
    destinations.push({
      href: '/portal/billing',
      label: 'Billing',
      matchPrefix: '/portal/billing',
    })
  }
  return destinations.map((d, i) => ({ ...d, anchor: String(i + 1).padStart(2, '0') }))
}

export function isNavDestinationActive(dest: PortalNavDestination, pathname: string): boolean {
  const path = pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname
  if (dest.exact) return path === dest.href
  return path === dest.href || path.startsWith(dest.matchPrefix + '/')
}
