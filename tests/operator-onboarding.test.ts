/**
 * Onboarding (client-portal §6) — pure step derivation.
 *
 * §6 requires the get-started path to be honest: a step with no real signal is
 * "not started," never a fabricated completion. These tests pin that contract
 * against the resolved signals, independent of D1.
 *
 * (Calibration was removed per ADR 0052 — it is an off-portal activity, so the
 * path is two steps: invite, connect.)
 */

import { describe, it, expect } from 'vitest'
import { deriveOnboardingState } from '../src/lib/portal/operator/onboarding-read'

const ZERO = { memberCount: 0, connectedCount: 0, totalConnectors: 0 }
// The operator instance whose onboarding is being derived (multi-operator: step
// links are instance-scoped).
const SLUG = 'test-op'

describe('deriveOnboardingState', () => {
  it('a fresh account is all "not started" — no fabricated completion', () => {
    const { steps, doneCount, total } = deriveOnboardingState(ZERO, SLUG)
    expect(total).toBe(2)
    expect(doneCount).toBe(0)
    expect(steps.every((s) => s.status === 'not_started')).toBe(true)
    expect(steps.map((s) => s.key)).toEqual(['invite', 'connect'])
  })

  it('marks invite done once anyone is on the account', () => {
    const { steps } = deriveOnboardingState({ ...ZERO, memberCount: 2 }, SLUG)
    const invite = steps.find((s) => s.key === 'invite')!
    expect(invite.status).toBe('done')
    expect(invite.detail).toContain('2')
  })

  it('connect is done only when at least one connector is healthy', () => {
    const noneOk = deriveOnboardingState({ ...ZERO, totalConnectors: 3, connectedCount: 0 }, SLUG)
    expect(noneOk.steps.find((s) => s.key === 'connect')!.status).toBe('not_started')
    expect(noneOk.steps.find((s) => s.key === 'connect')!.detail).toContain('0 of 3')

    const someOk = deriveOnboardingState({ ...ZERO, totalConnectors: 3, connectedCount: 1 }, SLUG)
    expect(someOk.steps.find((s) => s.key === 'connect')!.status).toBe('done')
  })

  it('reports "no systems configured" when there are no connectors at all', () => {
    const { steps } = deriveOnboardingState(ZERO, SLUG)
    expect(steps.find((s) => s.key === 'connect')!.detail).toMatch(/no systems/i)
  })

  it('every step links into the operator instance', () => {
    for (const s of deriveOnboardingState(ZERO, SLUG).steps) {
      expect(s.href.startsWith(`/portal/products/operator/${SLUG}/`)).toBe(true)
    }
  })
})
