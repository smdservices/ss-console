import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

// The vertical pack pages each have a "What The Pack Starts You With" section
// driven by a `packTemplates` array. Those entries describe the STARTING
// TEMPLATES the pack ships with — work the Operator is configured to start
// from, NOT a finished, running product. The distinction is a truthfulness P0:
// the pack config is largely aspirational (only Clio is runtime-live, and there
// are no customers yet), so the kit must read as "templates we configure," never
// as a delivered capability. This guard enforces that grammar mechanically.
//
// Scope: ONLY the `packTemplates` array literal. The role-lens narratives and
// the day-one section legitimately use the established selling voice
// ("captures / drafts / chases"); this guard does not touch those.

const packsDir = resolve('src/pages/packs')

// Verbs that assert a finished, running capability. Banned inside packTemplates,
// where they would turn "a starting template for X" into "it does X today."
// ("does" is intentionally excluded: it matches benign "does not ..." phrasing.)
const CAPABILITY_VERBS = /\b(handles|manages|automates)\b/i

function packFiles(): string[] {
  return readdirSync(packsDir)
    .filter((n) => n.endsWith('.astro'))
    .map((n) => join(packsDir, n))
}

function packTemplatesLiteral(src: string): string | null {
  const m = src.match(/const packTemplates = \[([\s\S]*?)\n\]/)
  return m ? m[1] : null
}

describe('Operator pack kit grammar (truthfulness)', () => {
  for (const file of packFiles()) {
    const rel = file.slice(file.indexOf('src/'))
    const src = readFileSync(file, 'utf-8')

    it(`${rel} frames the kit as starting templates, not a capability`, () => {
      // The truthful framing must be present on every pack page.
      expect(src).toContain('starting templates we configure with you')
    })

    it(`${rel} packTemplates use no finished-capability verbs`, () => {
      const literal = packTemplatesLiteral(src)
      expect(literal, 'packTemplates array not found').not.toBeNull()
      expect(
        CAPABILITY_VERBS.test(literal as string),
        `packTemplates binds a finished-capability verb (handles/manages/automates/does) to a template in ${rel}`
      ).toBe(false)
    })
  }
})
