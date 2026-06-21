#!/usr/bin/env node
/**
 * Venture Handbook drift radar (advisory).
 *
 * For each page under docs/handbook/, compares the page's own last-commit time to
 * the last-commit time of every same-repo file it cites in `sources[]`. If a cited
 * source changed after the page, the page is *possibly* stale and is reported.
 *
 * This is advisory, not a gate: a source edit does not always change what the page
 * says, so a human reads the report and decides. The hard structural gate (dead
 * links, missing sources, bad frontmatter) lives in tests/handbook-integrity.test.ts
 * and runs in CI. Run this on demand:  npm run handbook:drift
 *
 * Exit code is always 0 (informational). Pass --strict to exit 1 when any page is
 * flagged - useful if you ever want to wire it into CI as a soft warning step.
 *
 * @see docs/handbook/README.md - the maintenance contract
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { parse as parseYaml } from 'yaml'

const HANDBOOK = 'docs/handbook'
const strict = process.argv.includes('--strict')

function lastCommitEpoch(path) {
  try {
    const out = execSync(`git log -1 --format=%ct -- "${path}"`, { encoding: 'utf8' }).trim()
    return out ? Number(out) : null
  } catch {
    return null
  }
}

function repoPathOf(href) {
  if (!href) return null
  const blob = href.match(
    /^https:\/\/github\.com\/venturecrane\/ss-console\/(?:blob|tree)\/[^/]+\/(.+)$/
  )
  if (blob) return blob[1].replace(/[#?].*$/, '')
  if (!/^[a-z]+:\/\//.test(href) && !href.includes('(')) {
    const clean = href.replace(/[#?].*$/, '')
    if (/^(src|docs|migrations|workers|operator|scripts|public|tests|\.github)\//.test(clean))
      return clean
  }
  return null
}

function frontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  try {
    return parseYaml(m[1]) ?? {}
  } catch {
    return {}
  }
}

const files = readdirSync(HANDBOOK).filter((f) => f.endsWith('.md') && f !== 'README.md')
const flagged = []

for (const file of files) {
  const path = join(HANDBOOK, file)
  const fm = frontmatter(readFileSync(path, 'utf8'))
  const sources = Array.isArray(fm.sources) ? fm.sources : []
  const pageTime = lastCommitEpoch(path)
  if (!pageTime) continue // uncommitted/new page - nothing to compare yet

  const stale = []
  for (const s of sources) {
    const repoPath = repoPathOf(s?.href)
    if (!repoPath) continue
    const srcTime = lastCommitEpoch(repoPath)
    if (srcTime && srcTime > pageTime) {
      const days = Math.round((srcTime - pageTime) / 86400)
      stale.push({ repoPath, days })
    }
  }
  if (stale.length) flagged.push({ file, stale })
}

if (flagged.length === 0) {
  console.log('Handbook drift radar: all pages are newer than their cited sources. Clean.')
  process.exit(0)
}

console.log(
  `Handbook drift radar: ${flagged.length} page(s) possibly stale (a cited source changed after the page).\n`
)
for (const { file, stale } of flagged) {
  console.log(`  ${file}`)
  for (const { repoPath, days } of stale) {
    console.log(`     source changed ~${days}d after the page: ${repoPath}`)
  }
}
console.log(
  '\nAdvisory only. Review each page; update it if the source change altered what it says.'
)
process.exit(strict ? 1 : 0)
