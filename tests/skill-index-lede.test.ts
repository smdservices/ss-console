/**
 * Skill selection lede gate (#2222, #2247).
 *
 * The runtime fact this encodes, read from the seat's own code
 * (`/opt/hermes/agent/skill_utils.py:710-718`, vfy_01KZQHECDZ0YBTPZ5GGA1CA848):
 *
 *     def extract_skill_description(frontmatter):
 *         desc = str(frontmatter.get("description", "")).strip().strip("'\"")
 *         if len(desc) > 60:
 *             return desc[:57] + "..."
 *         return desc
 *
 * That truncated string is the ONLY thing the model sees when it decides which
 * skill to load: `agent/prompt_builder.py` emits it as `- {name}: {desc}` inside
 * the `<available_skills>` index. Everything past character 57 of a description
 * is invisible until the skill has already been selected, so it cannot help the
 * model select it.
 *
 * This was not a theory. On 2026-08-11 `voice-establishment` and
 * `shape-establishment` carried byte-identical index fragments ("On an Operator
 * admin's instruction, establishes or update..."), and `operator-introduce`'s
 * second-depth trigger ("walk me through what you'll do each day and week") sat
 * at roughly character 300 of an 806-character description. The card rehearsal
 * read that as "skill selection is unreliable". It was a 57-character budget.
 *
 * Two rules, both mechanical:
 *
 *   1. The description's first sentence is <= 57 characters, so it survives the
 *      cut whole instead of being severed mid-word. This forces every skill to
 *      open with a deliberate lede that names what it is for.
 *   2. Those ledes are unique across skills. Two skills the model cannot tell
 *      apart in the index are one skill it will pick at random.
 *
 * Anything the skill needs to say beyond the lede still belongs in the
 * description; it just cannot be load-bearing for selection.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parse } from 'yaml'

const SKILLS_DIR = resolve('operator/skills')

/** Hermes' own budget: `desc[:57] + '...'` once the description exceeds 60 chars. */
const INDEX_BUDGET = 57

type Skill = { slug: string; description: string }

function loadSkills(): Skill[] {
  const slugs = readdirSync(SKILLS_DIR).filter((name) => {
    const dir = join(SKILLS_DIR, name)
    return statSync(dir).isDirectory() && existsSync(join(dir, 'SKILL.md'))
  })

  return slugs.map((slug) => {
    const raw = readFileSync(join(SKILLS_DIR, slug, 'SKILL.md'), 'utf8')
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) throw new Error(`${slug}/SKILL.md has no frontmatter block`)
    const fm = parse(match[1]) as { description?: unknown }
    const description = typeof fm?.description === 'string' ? fm.description.trim() : ''
    return { slug, description }
  })
}

/**
 * What Hermes actually puts in the index, reproduced exactly.
 */
function indexFragment(description: string): string {
  return description.length > 60 ? `${description.slice(0, INDEX_BUDGET)}...` : description
}

/**
 * The description's first sentence: everything up to the first `.`, `?`, or `!`
 * that is followed by whitespace or the end of the string. A decimal point or an
 * abbreviation mid-sentence does not terminate it.
 */
function firstSentence(description: string): string {
  const m = description.match(/^[\s\S]*?[.?!](?=\s|$)/)
  return (m ? m[0] : description).trim()
}

describe('skill index lede — what the model sees when it selects', () => {
  const skills = loadSkills()

  it('finds skills on disk (sanity)', () => {
    expect(skills.length).toBeGreaterThan(0)
  })

  it('every skill has a description', () => {
    const missing = skills.filter((s) => !s.description).map((s) => s.slug)
    expect(missing, `skills with no frontmatter description:\n  ${missing.join('\n  ')}`).toEqual(
      []
    )
  })

  it(`every description opens with a sentence of <= ${INDEX_BUDGET} characters`, () => {
    const offenders = skills
      .filter((s) => s.description)
      .map((s) => ({ slug: s.slug, lede: firstSentence(s.description) }))
      .filter((s) => s.lede.length > INDEX_BUDGET)
      .map(
        (s) =>
          `${s.slug} (${s.lede.length} chars)\n      lede:  ${s.lede}\n      model sees: ${indexFragment(
            skills.find((k) => k.slug === s.slug)!.description
          )}`
      )

    expect(
      offenders,
      `These skills open with a sentence longer than the ${INDEX_BUDGET}-character selection budget, ` +
        `so the model sees it severed mid-word and cannot tell what the skill is for. ` +
        `Rewrite the FIRST sentence to fit; keep the rest of the description below it.\n\n    ` +
        offenders.join('\n    ')
    ).toEqual([])
  })

  it('no two skills share an index fragment', () => {
    const byFragment = new Map<string, string[]>()
    for (const s of skills) {
      if (!s.description) continue
      const frag = indexFragment(s.description)
      byFragment.set(frag, [...(byFragment.get(frag) ?? []), s.slug])
    }

    const collisions = [...byFragment.entries()]
      .filter(([, slugs]) => slugs.length > 1)
      .map(([frag, slugs]) => `${slugs.join(' + ')}\n      both show: ${frag}`)

    expect(
      collisions,
      `These skills are indistinguishable in the model's skill index, so it will pick between ` +
        `them at random. Give each a distinct opening sentence.\n\n    ` +
        collisions.join('\n    ')
    ).toEqual([])
  })
})
