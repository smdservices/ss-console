/**
 * Regression guard: every `unified-*` CustomEvent dispatched in one of the
 * two collaborating files must be listened for in the other.
 *
 * /book splits its UI into UnifiedIntake.astro (component) and
 * src/scripts/book.ts (page-level controller). They communicate over
 * CustomEvents on the `#unified-intake` element. If a dispatch and its
 * matching listener disagree on the event name, the listener silently
 * never fires — that breaks the post-Send AI reply / "Pick a time to
 * talk" CTA without any error or test signal.
 *
 * This regression actually shipped: PR #722 extracted book.ts out of
 * book.astro and renamed `unified-show-ai-reply` to `unified-ai-reply`
 * in the dispatcher only, leaving the listener stranded.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const BOOK_TS = resolve('src/scripts/book.ts')
const UNIFIED_INTAKE_ASTRO = resolve('src/components/booking/UnifiedIntake.astro')

const DISPATCH_RE = /dispatchEvent\(\s*new\s+CustomEvent\(\s*['"](unified-[a-z-]+)['"]/g
const LISTEN_RE = /addEventListener\(\s*['"](unified-[a-z-]+)['"]/g

function extractEventNames(source: string, regex: RegExp): Set<string> {
  const names = new Set<string>()
  for (const match of source.matchAll(regex)) {
    names.add(match[1])
  }
  return names
}

describe('UnifiedIntake event contract', () => {
  const bookTs = readFileSync(BOOK_TS, 'utf8')
  const unifiedIntake = readFileSync(UNIFIED_INTAKE_ASTRO, 'utf8')

  const bookDispatches = extractEventNames(bookTs, DISPATCH_RE)
  const bookListens = extractEventNames(bookTs, LISTEN_RE)
  const intakeDispatches = extractEventNames(unifiedIntake, DISPATCH_RE)
  const intakeListens = extractEventNames(unifiedIntake, LISTEN_RE)

  it('every event book.ts dispatches is listened for in UnifiedIntake.astro', () => {
    for (const name of bookDispatches) {
      expect(
        intakeListens,
        `book.ts dispatches "${name}" but UnifiedIntake.astro never listens`
      ).toContain(name)
    }
  })

  it('every event UnifiedIntake.astro dispatches is listened for in book.ts', () => {
    for (const name of intakeDispatches) {
      expect(
        bookListens,
        `UnifiedIntake.astro dispatches "${name}" but book.ts never listens`
      ).toContain(name)
    }
  })

  it('extracts a non-empty set on both sides (sanity)', () => {
    expect(bookDispatches.size).toBeGreaterThan(0)
    expect(intakeListens.size).toBeGreaterThan(0)
    expect(intakeDispatches.size).toBeGreaterThan(0)
    expect(bookListens.size).toBeGreaterThan(0)
  })
})
