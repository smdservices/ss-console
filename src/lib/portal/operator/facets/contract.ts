/**
 * Shared operator facet-viewer contract (ADR 0069 Lock 4 — one viewer, two mounts).
 *
 * Every config facet gets ONE resolver + ONE viewer here, mounted in both the
 * client portal and the admin-operator surface. Pages never reimplement a facet
 * viewer or reparse its projection column — they mount the shared one and pass
 * the mount context (which portal, and whether controls are operable for this
 * viewer). This ends the parallel admin/portal duplication ADR 0069 targets.
 *
 * Scaffold only in Slice 0. Facet viewers land per build slice under
 * `src/lib/portal/operator/facets/<facet-id>/`, each exporting a resolver
 * (projection/seam → view model) and an Astro viewer that consumes it. The facet
 * registry (`../facet-registry.ts`) points a facet's `viewerModule` at its
 * module here as each slice lands.
 */

import type { FacetMount } from '../facet-registry'

/** The overlay a mount applies to a shared facet viewer. */
export interface FacetMountContext {
  /** Which portal is rendering. */
  mount: FacetMount
  /**
   * Whether this viewer's controls are operable, vs read-only / read+request.
   * Composed upstream from the ADR 0041 authority posture ∧ client RBAC
   * (`resolveDomainSurface`) for the client, and admin RBAC for admin.
   */
  operable: boolean
}
