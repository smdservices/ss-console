import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'

// The Operator landing and every vertical pack use an editorial "§ NN" section
// rhythm rendered as mono badge spans. Inserting or removing a section means
// hand-renumbering every badge below it, which is the most likely mechanical
// defect on these pages (a duplicate or skipped § reads as a quality miss on the
// surface meant to project operational discipline). This guard asserts the
// rendered badges run sequentially from 01 with no gaps or duplicates. It does
// NOT enforce a fixed count — sections can be added or removed freely, they just
// have to stay numbered in order.

const operatorPage = resolve('src/pages/operator.astro')
const packsDir = resolve('src/pages/packs')
const packComponentsDir = resolve('src/components/packs')

// The pack pages render their badges through the shared chrome in
// src/components/packs: PackHero and PackClosing carry fixed badges (§ 01 and
// § 08), and the sections between use <PackEyebrow>§ NN</PackEyebrow>. Resolve
// a component-emitted badge by reading the component source, so a page whose
// section set drifts out of step with the fixed hero/closing numbering still
// fails this guard.
function componentBadge(name: string): number {
  const src = readFileSync(join(packComponentsDir, name), 'utf-8')
  const match = src.match(/>§\s*(\d+)<\/span/)
  if (!match) throw new Error(`${name}: no § badge span found`)
  return Number(match[1])
}

function badgeNumbers(file: string): number[] {
  const src = readFileSync(file, 'utf-8')
  // Matches, in document order: rendered span content (`>§ 03</span`), the
  // PackEyebrow slot form, and PackHero/PackClosing component usages.
  const tokens = src.matchAll(
    />§\s*(\d+)<\/span|<PackEyebrow>\s*§\s*(\d+)\s*<\/PackEyebrow>|<(PackHero|PackClosing)[\s>]/g
  )
  return [...tokens].map((m) => {
    if (m[1] !== undefined) return Number(m[1])
    if (m[2] !== undefined) return Number(m[2])
    return componentBadge(`${m[3]}.astro`)
  })
}

function pages(): string[] {
  const packs = readdirSync(packsDir)
    .filter((n) => n.endsWith('.astro'))
    .map((n) => join(packsDir, n))
  return [operatorPage, ...packs]
}

describe('Operator marketing § section badges', () => {
  for (const page of pages()) {
    const rel = page.slice(page.indexOf('src/'))
    it(`${rel} has sequential § badges from 01`, () => {
      const nums = badgeNumbers(page)
      expect(nums.length).toBeGreaterThan(0)
      const expected = Array.from({ length: nums.length }, (_, i) => i + 1)
      expect(nums).toEqual(expected)
    })
  }
})
