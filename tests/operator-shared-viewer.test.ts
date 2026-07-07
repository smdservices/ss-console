import { describe, it, expect } from 'vitest'
import { OPERATOR_FACETS } from '../src/lib/portal/operator/facet-registry'

/**
 * ADR 0069 Lock 4 — one resolver + one viewer per facet, mounted in both
 * portals. A facet shown today must point at the shared viewer root; pages never
 * reimplement a facet viewer or reparse its projection column.
 */
const SHARED_VIEWER_ROOT = 'src/lib/portal/operator/facets/'

describe('operator shared viewer (ADR 0069 Lock 4)', () => {
  it('any facet shown today points at the shared viewer root (no per-portal reimplementation)', () => {
    for (const f of OPERATOR_FACETS) {
      if (f.surface.kind === 'has_viewer') {
        expect(
          f.surface.viewerModule.startsWith(SHARED_VIEWER_ROOT),
          `${f.id} viewerModule must live under ${SHARED_VIEWER_ROOT}`
        ).toBe(true)
      }
    }
  })

  // Activated by the consolidation slices (3/4): a grep guard failing on a NEW
  // second parser of personas_json / connectors_json / authority_json outside
  // the shared viewer root. The existing admin/portal duplication is the
  // documented consolidation target and is intentionally not asserted yet.
  it.todo(
    'no NEW duplicate parser of personas_json/connectors_json/authority_json outside the shared root (Slice 3/4)'
  )
})
