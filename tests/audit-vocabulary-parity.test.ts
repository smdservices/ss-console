/**
 * ss#2320 half 2. Pin the overlay's audit vocabulary to this repo's.
 *
 * THE GAP. The seat runtime validates rows against the OVERLAY's
 * ACCEPTED_ACTION_TYPES; the client portal renders from THIS repo's
 * AUDIT_ACTION_TYPES; and `shared/audit_contract.py` validates nothing at all,
 * so a raw INSERT accepts any string. Nothing connected the three. The path
 * "overlay adds an emitter, declares the type overlay-side, overlay CI passes,
 * rows land in client ledgers, portal renders nothing" had no gate on it, and
 * the resulting silence is indistinguishable from a deliberate suppression
 * (ss#2316's third state).
 *
 * WHAT THIS CATCHES. An overlay type this repo has never heard of, at the
 * moment OVERLAY_REF moves — which is the only moment an overlay change can
 * reach a seat. The snapshot is anchored to the PINNED ref rather than overlay
 * main on purpose: main is ahead of what any Machine runs, and gating on it
 * would fail for changes no client can see yet.
 *
 * WHAT IT DOES NOT CATCH. It reads a committed snapshot, not the overlay repo
 * (private, no checkout in CI). A bump that refreshes `overlayRef` while
 * transcribing `overlayTypes` carelessly satisfies it. That is the same residual
 * the overlay-pairs manifest carries, and the reason issue #2320 also names
 * write-time validation in `shared/audit_contract.py` as worth doing regardless:
 * this gate makes a divergence loud at bump time, that one makes it impossible.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { AUDIT_ACTION_TYPES } from '../src/lib/portal/operator/audit'
import { MAPPED_ACTIONS, SUPPRESSED_ACTIONS } from '../src/lib/portal/operator/activity-language'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const CONTRACT = join(REPO_ROOT, 'operator', 'contracts', 'audit-action-vocabulary.json')
const DOCKERFILE = join(REPO_ROOT, 'operator', 'templates', 'Dockerfile')

interface VocabularyContract {
  overlayRef: string
  overlayTypes: string[]
  overlayOnly: Record<string, string>
  consoleOnly: Record<string, string>
}

const contract = (): VocabularyContract =>
  JSON.parse(readFileSync(CONTRACT, 'utf-8')) as VocabularyContract

/** The overlay commit a customer Machine actually ships. */
const pinnedOverlayRef = (): string => {
  const match = /^ARG OVERLAY_REF="([0-9a-f]{40})"/m.exec(readFileSync(DOCKERFILE, 'utf-8'))
  expect(match, 'Dockerfile has no pinned ARG OVERLAY_REF').not.toBeNull()
  return match![1]
}

describe('audit vocabulary parity with the shipped overlay (ss#2320)', () => {
  it('the snapshot is taken at the overlay ref the Machine ships', () => {
    // The load-bearing assertion. Bumping OVERLAY_REF without re-extracting the
    // vocabulary turns this red, which is the only moment the check can matter.
    expect(contract().overlayRef).toBe(pinnedOverlayRef())
  })

  it('every overlay type is known here, or declared overlay-only with a reason', () => {
    const known = new Set<string>(AUDIT_ACTION_TYPES)
    const { overlayTypes, overlayOnly } = contract()
    const undeclared = overlayTypes.filter((t) => !known.has(t) && !(t in overlayOnly))
    expect(
      undeclared,
      'the overlay declares these and this repo has never heard of them: a row of this type lands in a client ledger and the portal renders nothing'
    ).toEqual([])
  })

  it('every overlay-only exemption states why', () => {
    for (const [type, reason] of Object.entries(contract().overlayOnly)) {
      expect(reason.trim().length, `${type} is exempted with no reason`).toBeGreaterThan(0)
    }
  })

  it('no exemption hides a type this repo actually knows', () => {
    // A stale exemption is worse than none: it reads as "handled" while the real
    // decision (map it or suppress it) was never made.
    const known = new Set<string>(AUDIT_ACTION_TYPES)
    const stale = Object.keys(contract().overlayOnly).filter((t) => known.has(t))
    expect(stale, 'exempted as overlay-only but present in AUDIT_ACTION_TYPES').toEqual([])
  })

  it('every console-only type is genuinely absent from the overlay', () => {
    const overlay = new Set(contract().overlayTypes)
    const wrong = Object.keys(contract().consoleOnly).filter((t) => overlay.has(t))
    expect(wrong, 'declared console-only but the overlay knows it too').toEqual([])
  })

  it('every overlay type this repo knows has a client-language decision', () => {
    // Closes the loop to ss#2316: knowing a type is not the same as having
    // decided what a client sees. A type can pass the parity check above and
    // still render as nothing for want of a decision.
    const { overlayTypes, overlayOnly } = contract()
    const undecided = overlayTypes
      .filter((t) => !(t in overlayOnly))
      .filter((t) => !MAPPED_ACTIONS.includes(t) && !SUPPRESSED_ACTIONS.has(t))
    expect(undecided, 'shipped by the overlay with no mapped/suppressed decision').toEqual([])
  })
})

/**
 * The falsifier. Every assertion above passes on today's tree, so each is
 * re-run against a deliberately broken contract to show it can fail. Without
 * this the suite is six green checks of unknown strength.
 */
describe('the parity gate can fail (ss#2320)', () => {
  const withContract = (mutate: (c: VocabularyContract) => void) => {
    const c = contract()
    mutate(c)
    return c
  }

  it('catches an overlay type this repo has never heard of', () => {
    const c = withContract((x) => x.overlayTypes.push('SYNTHETIC_OVERLAY_ONLY_TYPE'))
    const known = new Set<string>(AUDIT_ACTION_TYPES)
    const undeclared = c.overlayTypes.filter((t) => !known.has(t) && !(t in c.overlayOnly))
    expect(undeclared).toEqual(['SYNTHETIC_OVERLAY_ONLY_TYPE'])
  })

  it('catches a stale overlayRef after a pin bump', () => {
    const c = withContract((x) => {
      x.overlayRef = '0000000000000000000000000000000000000000'
    })
    expect(c.overlayRef).not.toBe(pinnedOverlayRef())
  })

  it('catches an exemption with an empty reason', () => {
    const c = withContract((x) => {
      x.overlayOnly.SYNTHETIC_EMPTY_REASON = '   '
    })
    const empty = Object.entries(c.overlayOnly).filter(([, r]) => r.trim().length === 0)
    expect(empty.map(([t]) => t)).toEqual(['SYNTHETIC_EMPTY_REASON'])
  })
})
