/**
 * Guard the per-customer Operator governance forms POST to their /api handlers,
 * not the GET-only page paths.
 *
 * Regression: authority.astro and governance.astro built their form `action`
 * as `/admin/operator/<slug>/<x>` (the PAGE path) instead of
 * `/api/admin/operator/<slug>/<x>` (the real POST handler). No `.astro` page
 * exports a POST, so the two core governance mutations — authority flips and
 * entitlement/exposure changes — 404'd silently on submit. The unit tests call
 * the POST handlers directly, so nothing asserted the form target; this closes
 * that gap by reading the rendered source.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) => readFileSync(resolve(rel), 'utf-8')

describe('Operator governance forms target their /api handlers', () => {
  it('authority.astro posts to /api/admin/operator/<slug>/authority', () => {
    const src = read('src/pages/admin/operator/[customer]/authority.astro')
    // The form action must be the /api handler, never the page path.
    expect(src).toMatch(/action=\{`\/api\/admin\/operator\/\$\{[^}]+\}\/authority`\}/)
    expect(src).not.toMatch(/action=\{`\/admin\/operator\/\$\{[^}]+\}\/authority`\}/)
  })

  it('governance.astro posts to /api/admin/operator/<slug>/governance', () => {
    const src = read('src/pages/admin/operator/[customer]/governance.astro')
    expect(src).toMatch(/formAction = `\/api\/admin\/operator\/\$\{[^}]+\}\/governance`/)
    expect(src).not.toMatch(/formAction = `\/admin\/operator\/\$\{[^}]+\}\/governance`/)
  })
})
