#!/usr/bin/env node
/**
 * Extract the numbered primer lines from a doctrine file supplied on stdin.
 *
 * Used by reflex-primer.sh to serve the laws from origin/main's doctrine
 * (`git show origin/main:docs/doctrine/...`) instead of the checkout's
 * possibly-stale copy -- the 2026-08-01 incident: Law 11 merged at 18:37 and
 * absent from sessions started that evening, because both the primary and
 * the worktrees predate any given merge, while the shared origin/main ref
 * does not.
 *
 * Output: the numbered law lines, one per line, in registry order -- exactly
 * the shape the heredoc fallback prints. Prints NOTHING on any parse doubt
 * (fewer than MIN_LAWS lines extracted), so the primer's fallback heredoc
 * takes over; serving a truncated law set would be worse than serving a
 * stale one.
 */
import { readFileSync } from 'node:fs'

const MIN_LAWS = 8 // the registry's own sanity floor (doctrine-integrity.test.ts)

try {
  const doctrine = readFileSync(0, 'utf8')
  const lines = []
  // primer_line values are YAML scalars in single quotes ('' escapes),
  // double quotes, or bare. Match all three.
  const re = /^\s*primer_line:\s*(?:'((?:[^']|'')*)'|"((?:[^"\\]|\\.)*)"|(.+))\s*$/gm
  for (const m of doctrine.matchAll(re)) {
    const raw = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2] !== undefined ? m[2].replace(/\\"/g, '"') : m[3].trim()
    if (raw) lines.push(raw)
  }
  if (lines.length >= MIN_LAWS) {
    process.stdout.write(lines.map((l, i) => `${i + 1}. ${l}`).join('\n') + '\n')
  }
} catch {
  /* print nothing; the heredoc fallback serves */
}
process.exit(0)
