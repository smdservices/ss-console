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

function badgeNumbers(file: string): number[] {
  const src = readFileSync(file, 'utf-8')
  // Matches the rendered span content, e.g. `>§ 03</span`
  return [...src.matchAll(/>§\s*(\d+)<\/span/g)].map((m) => Number(m[1]))
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
