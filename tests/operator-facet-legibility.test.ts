import { describe, it, expect } from 'vitest'
import { OPERATOR_FACETS } from '../src/lib/portal/operator/facet-registry'
import { SWITCHABLE_AUTHORITY_DOMAINS, resolveDomainAuthority } from '../src/lib/operator/authority'

/**
 * ADR 0069 Lock 2 — complete legibility. Every facet of the operator's
 * configuration/behavior carries a DELIBERATE surface decision; a new facet
 * fails the snapshot until someone decides its client surface. Mirrors the
 * activity-language exhaustiveness test.
 */
describe('operator facet legibility (ADR 0069 Lock 2)', () => {
  it('every facet carries a deliberate, well-formed surface decision', () => {
    for (const f of OPERATOR_FACETS) {
      expect(['has_viewer', 'planned', 'suppressed'], `${f.id} surface kind`).toContain(
        f.surface.kind
      )
      if (f.surface.kind === 'planned') {
        expect(
          Number.isInteger(f.surface.slice) && f.surface.slice > 0,
          `${f.id} planned slice must be a positive integer`
        ).toBe(true)
      }
      if (f.surface.kind === 'has_viewer') {
        expect(
          f.surface.viewerModule.length,
          `${f.id} has_viewer needs a viewerModule`
        ).toBeGreaterThan(0)
      }
      if (f.surface.kind === 'suppressed') {
        expect(f.surface.reason.length, `${f.id} suppressed needs a reason`).toBeGreaterThan(0)
      }
      expect(f.mounts.length, `${f.id} must declare at least one mount`).toBeGreaterThan(0)
    }
  })

  it('facet ids are unique', () => {
    const ids = OPERATOR_FACETS.map((f) => f.id)
    expect(new Set(ids).size, 'duplicate facet id').toBe(ids.length)
  })

  it('wholly-inert facets are never rendered as effective config (suppressed, never has_viewer)', () => {
    for (const f of OPERATOR_FACETS) {
      if (f.inert) {
        expect(f.surface.kind, `${f.id} is inert and must not have a viewer`).not.toBe('has_viewer')
      }
    }
  })

  it('the facet set is a deliberate snapshot (adding/removing a facet requires editing this test)', () => {
    expect(OPERATOR_FACETS.map((f) => f.id).sort()).toEqual(
      [
        'activity',
        'addons',
        'agent-skills',
        'authority',
        'bundles',
        'business-hours',
        'compliance',
        'connections',
        'cost',
        'digest',
        'entitlements',
        'escalation',
        'gmail-push',
        'identity',
        'mcp-connector',
        'memory',
        'observability',
        'people',
        'practice-areas',
        'provisioning',
        'relationship',
        'safety-sticky-stop',
        'schedule',
        'scope',
        'skills',
        'status',
        'voice',
        'webhook-triggers',
        'workflow',
      ].sort()
    )
  })
})

/**
 * ADR 0069 Lock 3(c) — launch-safe by construction. An unconfigured authority
 * posture resolves to `managed` (every client self-serve switch off). The
 * managed→self-managed spectrum ships fully managed.
 */
describe('operator authority launch-safety (ADR 0069 Lock 3c / ADR 0041)', () => {
  it('an unconfigured posture is managed for every switchable domain', () => {
    for (const domain of SWITCHABLE_AUTHORITY_DOMAINS) {
      expect(resolveDomainAuthority(null, domain), `${domain} default`).toBe('managed')
    }
  })
})
