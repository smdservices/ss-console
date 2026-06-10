/**
 * Regression guard — a retired Operator brand must never reappear.
 *
 * The external-send identity framing that was once treated as a product-defining
 * hallmark was retired venture-wide: external send is one configurable entitlement
 * among many, named descriptively, with no special status. See ADR 0035
 * (no imposed entitlement defaults) and decision-stack #45.
 *
 * Past removals did not stick because nothing failed CI when the token regrew.
 * This test scans the whole tree and fails if the banned token reappears in any
 * doc, ADR, spec, comment, config, or code. The token is assembled from fragments
 * below so THIS guard file stays free of the very string it bans.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, resolve, extname } from 'node:path'

const FRAGMENTS = ['reviewer', 'as', 'sender']
const BANNED = new RegExp(FRAGMENTS.join('[-_ ]'), 'i')

const ROOT = resolve('.')
const SCAN_EXTS = new Set([
  '.md',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.astro',
  '.py',
  '.yaml',
  '.yml',
  '.sql',
  '.json',
])
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.astro',
  '.claude',
  '.vercel',
  'coverage',
  '.wrangler',
])

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (SCAN_EXTS.has(extname(entry)) || entry === 'CLAUDE.md') out.push(full)
  }
}

describe('retired Operator brand must not reappear (ADR 0035)', () => {
  const files: string[] = []
  walk(ROOT, files)

  it('scans a non-trivial number of files', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('no tracked file contains the retired identity token', () => {
    const offenders: string[] = []
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      if (!BANNED.test(text)) continue
      text.split('\n').forEach((ln, i) => {
        if (BANNED.test(ln)) offenders.push(`${f}:${i + 1}: ${ln.trim().slice(0, 120)}`)
      })
    }
    expect(
      offenders,
      `Retired brand reappeared in ${offenders.length} place(s):\n${offenders.join('\n')}`
    ).toEqual([])
  })
})
