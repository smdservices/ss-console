#!/usr/bin/env node
/**
 * Extract the injected primer lines from a doctrine file supplied on stdin.
 *
 * Used by reflex-primer.sh to serve the laws from origin/main's doctrine
 * (`git show origin/main:docs/doctrine/...`) instead of the checkout's
 * possibly-stale copy -- the 2026-08-01 incident: Law 11 merged at 18:37 and
 * absent from sessions started that evening, because both the primary and
 * the worktrees predate any given merge, while the shared origin/main ref
 * does not.
 *
 * Tier-aware (2026-08-01 consolidation): laws at `primer` or `radar` tier
 * are the judgment laws and are emitted in full, keeping their registry
 * ordinals. Gate-tier laws have real mechanisms doing their enforcing; they
 * are compressed into one pointer line so the injected block stays short
 * enough to be read rather than skimmed -- the primer's own design law.
 *
 * Prints NOTHING on any parse doubt (fewer than MIN_LAWS judgment lines), so
 * the primer's heredoc fallback takes over; a truncated law set would be
 * worse than a stale one.
 */
import { readFileSync } from 'node:fs'

const MIN_LAWS = 5

function unquote(v) {
  const s = v.trim()
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"')
  return s
}

try {
  const doctrine = readFileSync(0, 'utf8')
  const injected = []
  const gated = []
  let ordinal = 0
  for (const m of doctrine.matchAll(/```yaml\n([\s\S]*?)```/g)) {
    const fence = m[1]
    const id = fence.match(/^\s*id:\s*(.+)$/m)?.[1]?.trim()
    const line = fence.match(/^\s*primer_line:\s*(.+)$/m)?.[1]
    if (!id || !line) continue // the mechanisms block, not a law
    ordinal++
    const tier = fence.match(/^\s*tier:\s*(\w+)/m)?.[1] ?? 'prose'
    if (tier === 'primer' || tier === 'radar') {
      injected.push(`${ordinal}. ${unquote(line)}`)
    } else {
      gated.push(`${ordinal} ${id}`)
    }
  }
  if (injected.length >= MIN_LAWS) {
    let out = injected.join('\n') + '\n'
    if (gated.length > 0) {
      out += `Gate-enforced laws (mechanisms, not memory -- registry has the prose): ${gated.join(', ')}.\n`
    }
    process.stdout.write(out)
  }
} catch {
  /* print nothing; the heredoc fallback serves */
}
process.exit(0)
