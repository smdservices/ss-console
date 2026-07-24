/**
 * A facet door on the operator landing (ADR 0069; landing brief 2026-07-08).
 *
 * Each door leads to a facet's own page. `href: null` means the dedicated page
 * isn't built yet — the door renders as present-but-not-yet-built (honest, never
 * "coming soon"). `status` is an optional at-a-glance hint (e.g. a connection
 * needing attention) and is only ever set from REAL data — never fabricated.
 */
export interface FacetDoor {
  label: string
  desc: string
  href: string | null
  status?: string | null
}
