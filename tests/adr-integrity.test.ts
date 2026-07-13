/**
 * Structural-integrity gate for the ADR corpus (docs/adr/).
 *
 * The ADR numbering has collided three times (0044 -> 0061, 0068 -> 0069, and
 * 0069 -> 0073 on 2026-07-13). Each collision was a mechanical hazard: two files
 * sharing a number, or a file orphaned from the index. This test makes both
 * conditions impossible to merge:
 *
 *   1. no two files in docs/adr/ share the same NNNN numeric prefix, and
 *   2. every docs/adr/NNNN-*.md file has an entry (its filename) in
 *      docs/adr/index.md, so a renumber/add can never silently orphan a record.
 *
 * Kept dependency-light on purpose (fs + vitest only).
 *
 * @see docs/adr/index.md - the numbering note records the collision history
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { resolve, join } from 'path'

const ADR_DIR = resolve('docs/adr')
const INDEX = join(ADR_DIR, 'index.md')

const adrFiles = readdirSync(ADR_DIR).filter((f) => /^\d{4}-.*\.md$/.test(f))

describe('ADR corpus integrity', () => {
  it('has ADR files to check', () => {
    expect(adrFiles.length).toBeGreaterThan(0)
  })

  it('no two ADR files share the same NNNN numeric prefix', () => {
    const byNumber = new Map<string, string[]>()
    for (const file of adrFiles) {
      const num = file.slice(0, 4)
      const list = byNumber.get(num) ?? []
      list.push(file)
      byNumber.set(num, list)
    }
    const collisions = [...byNumber.entries()].filter(([, files]) => files.length > 1)
    expect(
      collisions,
      `Duplicate ADR number prefixes: ${collisions
        .map(([num, files]) => `${num} -> ${files.join(', ')}`)
        .join('; ')}. Renumber one to the next free slot and record it in index.md.`
    ).toEqual([])
  })

  it('every ADR file is listed in index.md', () => {
    const index = readFileSync(INDEX, 'utf8')
    const missing = adrFiles.filter((file) => !index.includes(file))
    expect(
      missing,
      `ADR files missing an entry in docs/adr/index.md: ${missing.join(', ')}. ` +
        `Add a "- [<file>](./<file>) - <one-line summary>" line so the record is not orphaned.`
    ).toEqual([])
  })
})
