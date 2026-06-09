/**
 * Per-operator overview reader + derivations for the admin Operator console
 * drill-in (`/admin/operator/[customer]`) — design doc §5.1.
 *
 * The overview is the hub for one operator: identity, the persona roster (built
 * for N, shows one at v1 per ADR 0011), the authority posture + per-domain
 * switch summary, a health summary, and subscription state. Like the fleet
 * roster it reads only console-side projections — `customer_configs` (via the
 * frozen getCustomerConfig read path), the runtime-summary mirror, fleet_status,
 * and subscriptions. Deep runtime detail (audit log, drafts, matters) is the
 * §5.5 surface and uses the live per-customer read path; the overview never
 * crosses the isolation boundary.
 *
 * This module owns the slug→entity_id resolution and the pure derivations the
 * page renders. The config/summary/heartbeat/subscription readers are the
 * frozen seam; the page composes them.
 */

import type { D1Database } from '@cloudflare/workers-types'
import {
  resolveAllDomains,
  SMD_ONLY_AUTHORITY_DOMAINS,
  type AuthorityPosture,
  type AuthorityHolder,
  type SwitchableAuthorityDomain,
  type SmdOnlyAuthorityDomain,
} from '../operator/authority'

/**
 * Resolve a customer slug to its entity_id via `customer_configs`. The
 * `[customer]` route segment is the slug (human-stable, URL-safe); the frozen
 * config/subscription readers key on entity_id. Returns null when no operator
 * has that slug.
 */
export async function resolveEntityIdBySlug(db: D1Database, slug: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT entity_id FROM customer_configs WHERE customer_slug = ?')
    .bind(slug)
    .first<{ entity_id: string }>()
  return row?.entity_id ?? null
}

// ===========================================================================
// Per-domain authority summary (foundations §4.2)
// ===========================================================================

/** Display labels for every authority domain (switchable + SMD-only). */
export const AUTHORITY_DOMAIN_LABELS: Record<
  SwitchableAuthorityDomain | SmdOnlyAuthorityDomain,
  string
> = {
  configuration: 'Configuration authoring',
  trust: 'Trust & governance',
  connectors: 'Connectors & credentials',
  runtime: 'Runtime operations',
  memory: 'Memory & agent-skills',
  people_access: 'People & access',
  compliance: 'Compliance & audit',
  observability: 'Observability & health',
  provisioning: 'Provisioning & lifecycle',
  cost: 'Cost & economics',
}

/**
 * Total label lookup for any domain string (e.g. an audit row's stored domain).
 * Returns the friendly label when known, else the raw string — never throws and
 * never casts. Use this for display of stored/untrusted domain values.
 */
export function safeAuthorityDomainLabel(domain: string): string {
  return (AUTHORITY_DOMAIN_LABELS as Record<string, string>)[domain] ?? domain
}

export interface DomainAuthorityRow {
  domain: SwitchableAuthorityDomain
  label: string
  holder: AuthorityHolder
  /** true → the client org also operates this domain (switch on). */
  clientOperable: boolean
}

/**
 * The per-domain switch summary the overview renders: one row per switchable
 * domain with who operates it. SMD operates every domain regardless (Layer 0);
 * `holder === 'client'` means the client org *also* has operable controls.
 */
export function domainAuthoritySummary(posture: AuthorityPosture | null): DomainAuthorityRow[] {
  const resolved = resolveAllDomains(posture)
  return (Object.keys(resolved) as SwitchableAuthorityDomain[]).map((domain) => ({
    domain,
    label: AUTHORITY_DOMAIN_LABELS[domain],
    holder: resolved[domain],
    clientOperable: resolved[domain] === 'client',
  }))
}

/** The two SMD-only domains, labelled — shown as always SMD-operated. */
export function smdOnlyDomains(): { domain: SmdOnlyAuthorityDomain; label: string }[] {
  return SMD_ONLY_AUTHORITY_DOMAINS.map((domain) => ({
    domain,
    label: AUTHORITY_DOMAIN_LABELS[domain],
  }))
}

export interface AuthorityHolderBadge {
  label: string
  classes: string
}

const HOLDER_BADGE_STRUCTURE =
  'inline-flex items-center px-2 py-0.5 rounded-[var(--ss-radius-badge)] ' +
  'text-[10px] font-medium uppercase tracking-wide whitespace-nowrap'

/**
 * Badge for who operates a domain. "SMD" (managed — the client sees Read +
 * Request) vs "Client + SMD" (client switch on — additive, never instead of
 * SMD). The wording never implies SMD lost control.
 */
export function authorityHolderBadge(holder: AuthorityHolder): AuthorityHolderBadge {
  if (holder === 'client') {
    return {
      label: 'Client + SMD',
      classes: `${HOLDER_BADGE_STRUCTURE} bg-[color:var(--ss-color-complete)] text-white`,
    }
  }
  return {
    label: 'SMD',
    classes: `${HOLDER_BADGE_STRUCTURE} bg-[color:var(--ss-color-primary)] text-white`,
  }
}

// ===========================================================================
// Subscription state (single-item detail → prose, UI-PATTERNS Rule 1)
// ===========================================================================

export interface SubscriptionState {
  label: string
  /** Token-based text color so the prose carries the semantic, not a pill. */
  colorClass: string
}

/**
 * Map a subscription status to display prose for the detail header. Null when
 * no Operator subscription exists yet (a real pre-activation state, not an
 * error). Statuses match getProductSubscription: provisioning / active / paused.
 */
export function subscriptionState(status: string | null): SubscriptionState {
  switch (status) {
    case 'active':
      return { label: 'Active', colorClass: 'text-[color:var(--ss-color-complete)]' }
    case 'provisioning':
      return { label: 'Provisioning', colorClass: 'text-[color:var(--ss-color-attention)]' }
    case 'paused':
      return { label: 'Paused', colorClass: 'text-[color:var(--ss-color-attention)]' }
    case null:
      return { label: 'No subscription yet', colorClass: 'text-[color:var(--ss-color-text-muted)]' }
    default:
      return { label: status, colorClass: 'text-[color:var(--ss-color-text-secondary)]' }
  }
}

// ===========================================================================
// Persona roster cell helpers
// ===========================================================================

export interface PersonaStatusDisplay {
  label: string
  dotClass: string
}

/** Dot + label for a persona's status (active / archived / other). */
export function personaStatusDisplay(status: string): PersonaStatusDisplay {
  switch (status) {
    case 'active':
      return { label: 'Active', dotClass: 'bg-[color:var(--ss-color-complete)]' }
    case 'archived':
      return { label: 'Archived', dotClass: 'bg-[color:var(--ss-color-border)]' }
    default:
      return { label: status, dotClass: 'bg-[color:var(--ss-color-attention)]' }
  }
}

/** "3 skills" / "1 skill" / "no skills" for a persona card. */
export function skillCountLabel(count: number): string {
  if (count <= 0) return 'no skills'
  return count === 1 ? '1 skill' : `${count} skills`
}
