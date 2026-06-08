/**
 * Dual-mode surface resolver (ADR 0041 §4.3) — the frozen logic every
 * client-portal domain surface wraps.
 *
 * Each switchable domain renders in one of two modes:
 *   - operable      → live controls; the client edits directly.
 *   - read_request  → identical data, read-only, with a "Request a change"
 *                     path that files into the admin inbox.
 *
 * The mode is the composition of the two independent layers (foundations §2):
 *   Layer 1 (authority): is the domain client-operable for this client?
 *   Layer 2 (client RBAC): does the acting user's client-internal role permit
 *                          this domain?
 * Operable iff BOTH. Otherwise read_request. This module never assumes a gate
 * the entitlements (Layer 3) did not author — it governs only who-may-operate,
 * not what-the-operator-does.
 *
 * Visibility is a separate axis: every domain is readable from day one except
 * cost (SMD-only by nature). `resolveDomainSurface` folds visibility + mode
 * into one state the surface consumes.
 *
 * Pure — imports only the frozen authority contract. The Astro `<DomainSurface>`
 * wrapper renders the operable slot or the read-only slot + request affordance
 * from the `mode` this returns; the server-side write endpoints re-check the
 * same composition (never trust a client-only mode).
 */

import {
  canClientRead,
  isClientOperable,
  isSwitchableDomain,
  type AuthorityDomain,
  type AuthorityPosture,
  type SwitchableAuthorityDomain,
} from '../../operator/authority'

export type DomainSurfaceMode = 'operable' | 'read_request'

export interface DomainSurfaceState {
  /** Whether the client may see this domain at all (false only for cost). */
  visible: boolean
  /** Operable vs read+request. Meaningful only when `visible` is true. */
  mode: DomainSurfaceMode
}

/**
 * Resolve operable vs read_request for a switchable domain. `clientRolePermits`
 * is the Layer-2 decision (does this user's client-internal role allow this
 * domain) — the caller computes it from the RBAC matrix. Operable requires
 * both the authority switch (`client`) AND the role permission.
 */
export function resolveDomainSurfaceMode(
  authority: AuthorityPosture | null,
  domain: SwitchableAuthorityDomain,
  clientRolePermits: boolean
): DomainSurfaceMode {
  return isClientOperable(authority, domain) && clientRolePermits ? 'operable' : 'read_request'
}

/**
 * Full surface state for any domain: visibility (read access) plus mode.
 * SMD-only / non-switchable domains are never operable to the client — they
 * resolve to read_request when visible (e.g. provisioning: the client watches
 * but cannot operate), and invisible for cost.
 */
export function resolveDomainSurface(
  authority: AuthorityPosture | null,
  domain: AuthorityDomain,
  clientRolePermits: boolean
): DomainSurfaceState {
  const visible = canClientRead(domain)
  if (!visible) return { visible: false, mode: 'read_request' }
  if (!isSwitchableDomain(domain)) return { visible: true, mode: 'read_request' }
  return { visible: true, mode: resolveDomainSurfaceMode(authority, domain, clientRolePermits) }
}
