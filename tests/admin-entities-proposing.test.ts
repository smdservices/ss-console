import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level tests for the Proposing-tab inline quote status + age on the
 * admin entities list. Surface-level in the same style as tests/quotes.test.ts
 * so we can guard the wiring without spinning up D1 / Astro SSR in CI.
 */
describe('admin/entities/index: Proposing tab quote status', () => {
  // Quote status badge and relativeTime were extracted to EntityListRow.astro to
  // keep index.astro within the 500-line ceiling. Combined source covers both.
  const source = () =>
    readFileSync(resolve('src/pages/admin/entities/index.astro'), 'utf-8') +
    '\n' +
    readFileSync(resolve('src/components/admin/EntityListRow.astro'), 'utf-8') +
    '\n' +
    readFileSync(resolve('src/lib/admin/entity-row-view.ts'), 'utf-8')

  it('imports the batch active-quote loader', () => {
    const code = source()
    // The same import statement may also pull sibling batch helpers
    // (getQuotesForEntities for the meetings stage) — match the symbol
    // and module path rather than the literal one-symbol form.
    expect(code).toMatch(
      /import\s*\{[^}]*\bgetActiveQuotesForEntities\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/lib\/db\/quotes['"]/
    )
  })

  it('imports the shared admin status badge class', () => {
    // Extracted to EntityListRow.astro; match symbol + module, not exact relative path
    expect(source()).toMatch(
      /import\s*\{[^}]*\bstatusBadgeClass\b[^}]*\}\s*from\s*['"][^'"]*lib\/ui\/status-badge['"]/
    )
  })

  it('imports the admin relativeTime helper (not a local variant)', () => {
    // Extracted to entity-row-view.ts; match symbol + canonical module name
    expect(source()).toMatch(
      /import\s*\{[^}]*\brelativeTime\b[^}]*\}\s*from\s*['"][^'"]*relative-time['"]/
    )
  })

  it('only fetches active quotes when on the Proposing tab', () => {
    // Guarded so other tabs keep their current DAL footprint.
    expect(source()).toMatch(/filterStage === 'proposing'[\s\S]+?getActiveQuotesForEntities/)
  })

  it('sorts Proposing rows by oldest sent_at first', () => {
    const code = source()
    // Sent rows come before non-sent; within sent, oldest first via localeCompare.
    expect(code).toContain('sa.localeCompare(sb)')
    expect(code).toMatch(/if \(sa\) return -1/)
    expect(code).toMatch(/if \(sb\) return 1/)
  })

  it('renders the status badge inline on Proposing rows', () => {
    expect(source()).toContain('statusBadgeClass(r.activeQuote.status)')
  })

  it('renders nothing when no active quote is present (no placeholder copy)', () => {
    // CLAUDE.md: render nothing rather than a fabricated "No quote yet" string.
    const code = source()
    expect(code).not.toContain('No quote yet')
    expect(code).toContain('r.activeQuote && (')
  })
})
