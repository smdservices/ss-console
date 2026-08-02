/**
 * Nav-reachability guard for the operator instance surfaces (#2176).
 *
 * The failure class: a page can exist, be fed by a healthy seam, pass its own
 * tests — and be reachable by no click. The 2026-08-02 dress rehearsal found
 * exactly that: the Activity & Audit page (the surface backing the service
 * agreement's "viewable by the Firm in the portal at any time") was orphaned —
 * the one-pager linked only Settings, so the principal role could not find
 * the audit record at all (vfy_01KZ1Z5SQKC0XFZZDFBRWVW4X7).
 *
 * This guard pins the two standing entries on the operator one-pager and, in
 * the other direction, that each linked target's page file actually exists —
 * a link to a deleted page fails here too, not in a client's browser.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const ONE_PAGER = resolve('src/pages/portal/products/operator/[instance]/index.astro')
const INSTANCE_DIR = resolve('src/pages/portal/products/operator/[instance]')

const source = readFileSync(ONE_PAGER, 'utf8')

/** The standing outbound entries the one-pager must always carry. */
const STANDING_LINKS: Array<{ path: string; label: string }> = [
  { path: 'activity', label: 'Activity & Audit' },
  { path: 'settings', label: 'Settings' },
]

describe('operator one-pager standing navigation (#2176)', () => {
  for (const { path, label } of STANDING_LINKS) {
    it(`links to ${path} ("${label}")`, () => {
      // The template-literal href shape the page uses for instance-scoped
      // links. A refactor to a different shape must update this guard in the
      // same PR — that is the conscious act the guard exists to force.
      expect(source).toContain(`href={\`\${operatorBase}/${path}\`}`)
      expect(source).toContain(label)
    })

    it(`the ${path} target page exists`, () => {
      const asDir = resolve(INSTANCE_DIR, path, 'index.astro')
      const asFile = resolve(INSTANCE_DIR, `${path}.astro`)
      expect(
        existsSync(asDir) || existsSync(asFile),
        `linked target ${path} has no page file — the link would 404`
      ).toBe(true)
    })
  }

  it('guard can fail: a link the page does not carry is not reported present', () => {
    // FALSE CONTROL (Law 12): the same assertion shape against a path the
    // one-pager genuinely does not link must fail — otherwise the greens
    // above measure nothing.
    expect(source).not.toContain('href={`${operatorBase}/definitely-not-a-page`}')
  })
})
