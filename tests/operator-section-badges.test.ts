import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

// The Operator marketing surfaces use a consistent mono EYEBROW label per section
// (JetBrains Mono, uppercase, tracking-[0.18em]). The earlier numbered "§ NN"
// badge-chip system was retired in the 2026-06 marketing reveal in favor of these
// eyebrows, unifying the home, /why, /operator, /industries, /ai, and the 12 packs.
//
// This guard replaces the old "sequential § badges" check with its inverse:
//   1. no marketing surface may regress to the retired "§ NN" badge-chip span, and
//   2. each surface must still render at least one section eyebrow.

const root = resolve('.')

const pageFiles = [
  'src/pages/index.astro',
  'src/pages/operator.astro',
  'src/pages/about.astro',
  'src/pages/industries.astro',
  ...readdirSync(resolve('src/pages/packs'))
    .filter((n) => n.endsWith('.astro'))
    .map((n) => join('src/pages/packs', n)),
]

const eyebrowComponents = [
  'src/components/packs/PackEyebrow.astro',
  'src/components/packs/PackHero.astro',
  'src/components/packs/PackClosing.astro',
]

// The retired chip rendered as `>§ 03</span`. HTML comments (`<!-- § 02 -->`) and
// the mobile-nav item numbering (`§ 0{i + 1}`) are not this pattern and are fine.
const OLD_BADGE = />§\s*\d+<\/span/
const EYEBROW = /tracking-\[0\.18em\]/
const PACK_EYEBROW = /<PackEyebrow>/

describe('marketing section eyebrows (retired § NN badge chips)', () => {
  for (const rel of [...pageFiles, ...eyebrowComponents]) {
    it(`${rel} contains no retired "§ NN" badge chip`, () => {
      const src = readFileSync(join(root, rel), 'utf-8')
      expect(OLD_BADGE.test(src), `${rel} still renders a "§ NN" badge span`).toBe(false)
    })
  }

  for (const rel of pageFiles) {
    it(`${rel} renders at least one section eyebrow`, () => {
      const src = readFileSync(join(root, rel), 'utf-8')
      const hasEyebrow = EYEBROW.test(src) || PACK_EYEBROW.test(src)
      expect(hasEyebrow, `${rel} renders no section eyebrow`).toBe(true)
    })
  }
})
