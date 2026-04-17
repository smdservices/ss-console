import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Regression guard for the unified portal list scaffolding established by
 * PRs #413–#415. The three list pages — Proposals, Invoices, Documents —
 * must share the same h1 class, list container spacing, and row-card
 * treatment so they stay visually consistent as copy/content changes.
 *
 * If this test fails, the fix is either to update the other pages to match
 * or to update this test plus the scaffolding intentionally.
 */

const CANONICAL_H1_CLASS = 'text-xl font-semibold text-slate-900 mb-6'
// space-y-row (spacing-row token = 12px, generated from --spacing-row) —
// replaces the former literal space-y-3 after UI-PATTERNS Rule 6 landed.
const CANONICAL_LIST_CONTAINER = 'space-y-row'
// p-stack (spacing-stack = 16px) replaces literal p-4 per Rule 6.
const CANONICAL_ROW_CARD =
  'block bg-white rounded-lg border border-slate-200 p-stack hover:border-slate-300 hover:shadow-sm transition-all'

const PAGES = [
  { name: 'Proposals', path: 'src/pages/portal/quotes/index.astro' },
  { name: 'Invoices', path: 'src/pages/portal/invoices/index.astro' },
  { name: 'Documents', path: 'src/pages/portal/documents/index.astro' },
] as const

describe('portal list pages: unified scaffolding', () => {
  for (const page of PAGES) {
    const source = () => readFileSync(resolve(page.path), 'utf-8')

    describe(page.name, () => {
      it('uses the canonical h1 class', () => {
        expect(source()).toContain(CANONICAL_H1_CLASS)
      })

      it('uses space-y-3 for the list container', () => {
        expect(source()).toContain(CANONICAL_LIST_CONTAINER)
      })

      it('uses the canonical row-card anchor class', () => {
        expect(source()).toContain(CANONICAL_ROW_CARD)
      })

      it('does not use a "Your X" heading', () => {
        const code = source()
        // Only h1 tags are in scope — body copy may still address the user.
        expect(code).not.toMatch(/<h1[^>]*>\s*Your\s/i)
      })
    })
  }
})
