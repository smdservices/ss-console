/**
 * Regression guard: the customer-Machine Dockerfile must pin the overlay and
 * fail CLOSED on a broken harness install.
 *
 * Two stacked bugs once shipped a silently harness-less Machine (first-boot
 * audit, 2026-05-29):
 *   1. OVERLAY_REF was pinned at v0.1.1, which predates `shared/outbound_gate.py`
 *      — the trust plugin's `from shared.outbound_gate import evaluate` would
 *      ImportError at runtime.
 *   2. The `hermes plugins install` step ended in `|| echo "WARN ...; continuing"`,
 *      swallowing that failure so the image built green and booted an agent with
 *      no trust/inbound/outbound harness.
 *
 * This is the exact fail-open antipattern the venture forbids (stub/NoOp default
 * reaches the live path and reports success). These assertions lock the fix.
 *
 * @see ai-employee/templates/Dockerfile
 * @see docs/runbooks/ai-employee/first-boot.md
 * @see docs/adr/0028-outbound-integrity-gates-provenance-and-voice.md
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const DOCKERFILE = readFileSync(resolve('ai-employee/templates/Dockerfile'), 'utf8')

describe('AI Employee customer Machine Dockerfile', () => {
  it('pins OVERLAY_REF to a semver release tag, never a branch', () => {
    const m = DOCKERFILE.match(/ARG\s+OVERLAY_REF=["']?(v\d+\.\d+\.\d+)["']?/)
    expect(m, 'OVERLAY_REF must be pinned to a vX.Y.Z release tag').not.toBeNull()
  })

  it('pins the overlay at >= v0.2.0 (the floor that contains shared/outbound_gate.py)', () => {
    const m = DOCKERFILE.match(/ARG\s+OVERLAY_REF=["']?v(\d+)\.(\d+)\.(\d+)["']?/)
    expect(m).not.toBeNull()
    const [major, minor] = [Number(m![1]), Number(m![2])]
    // v0.1.1 lacked the outbound gate / inbound spine; v0.2.0 is the floor.
    expect(major > 0 || minor >= 2, 'OVERLAY_REF must be >= v0.2.0').toBe(true)
  })

  it('does NOT swallow a failed plugin install (no fail-open `|| echo ... continuing`)', () => {
    // The specific regression: a `|| echo "WARN ...; continuing"` on the plugin
    // install line that let a harness-less image build green.
    expect(
      /plugins install[\s\S]{0,160}?\|\|\s*echo[^\n]*continuing/i.test(DOCKERFILE),
      'hermes plugins install must not fall through to a warning-and-continue'
    ).toBe(false)
  })

  it('hard-asserts the overlay policy core is importable at build time', () => {
    // The deterministic build gate that catches a stale/mis-pinned `shared`
    // package (the v0.1.1 ModuleNotFoundError) before the Machine ever boots.
    expect(
      DOCKERFILE.includes('import shared.outbound_gate'),
      'Dockerfile must assert `import shared.outbound_gate` succeeds in the venv'
    ).toBe(true)
    expect(DOCKERFILE).toMatch(/from shared\.outbound_gate import evaluate/)
  })
})
