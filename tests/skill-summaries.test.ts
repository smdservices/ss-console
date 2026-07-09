import { describe, it, expect } from 'vitest'
import { readdirSync, existsSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { SKILL_SUMMARIES } from '../src/lib/portal/operator/facets/skills/skill-summaries'

/**
 * Maintenance contract for the client-facing skill summaries (ADR 0069 Slice 3
 * follow-on). The summaries are authored client copy shown on Operator › Skills;
 * these guards keep them honest and complete:
 *
 *   1. Every skill under operator/skills/ has a summary — a new skill cannot
 *      reach the client surface without a reviewed client-facing line.
 *   2. No stale entries — every SKILL_SUMMARIES key maps to a real skill.
 *   3. No em dashes (house style, mirrors forbidden-strings' user-facing rule).
 *   4. Concise — a summary is a one-liner, not a pasted paragraph.
 */

const SKILLS_DIR = resolve('operator/skills')

/** Skill slugs = every subdirectory of operator/skills/ that carries a SKILL.md. */
function skillSlugsOnDisk(): string[] {
  return readdirSync(SKILLS_DIR).filter((name) => {
    const dir = join(SKILLS_DIR, name)
    return statSync(dir).isDirectory() && existsSync(join(dir, 'SKILL.md'))
  })
}

describe('skill summaries — maintenance contract', () => {
  const slugs = skillSlugsOnDisk()

  it('finds skills on disk (sanity)', () => {
    expect(slugs.length).toBeGreaterThan(0)
  })

  it('every skill under operator/skills/ has a client summary', () => {
    const missing = slugs.filter((slug) => !SKILL_SUMMARIES[slug])
    expect(
      missing,
      `these skills have no client summary in skill-summaries.ts — add a reviewed one-liner:\n  ${missing.join('\n  ')}`
    ).toEqual([])
  })

  it('has no stale entries (every summary key maps to a real skill)', () => {
    const onDisk = new Set(slugs)
    const stale = Object.keys(SKILL_SUMMARIES).filter((slug) => !onDisk.has(slug))
    expect(stale, `summaries for skills that no longer exist:\n  ${stale.join('\n  ')}`).toEqual([])
  })

  it('no summary contains an em dash (house style — user-facing surface)', () => {
    const offenders = Object.entries(SKILL_SUMMARIES)
      .filter(([, text]) => text.includes('—'))
      .map(([slug]) => slug)
    expect(offenders, `em dash in: ${offenders.join(', ')}`).toEqual([])
  })

  it('every summary is a concise one-liner (<= 200 chars)', () => {
    const tooLong = Object.entries(SKILL_SUMMARIES)
      .filter(([, text]) => text.length > 200)
      .map(([slug, text]) => `${slug} (${text.length})`)
    expect(tooLong, `over-length summaries:\n  ${tooLong.join('\n  ')}`).toEqual([])
  })
})
