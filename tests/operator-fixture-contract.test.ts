/**
 * Skill-fixture contract gate (ss#2360).
 *
 * WHY THIS EXISTS. On 2026-08-13 the Operator wrote a supervision memo into a
 * live matter saying a person changed it in-app. A machine had changed it
 * through an integration — the envelope carried `source: 'API'`. The memo's
 * whole purpose (SKILL.md:25) is recording who / when / HOW, and the "how" was
 * inverted.
 *
 * The striking part is that the right answer was already written down.
 * `mmou-userid-absent-05.md` is that exact case, flagged `adversarial: true`,
 * with `source: API` in its event and `'via an integration'` in
 * `body_must_contain`. Five such fixtures exist for this skill.
 *
 * NOTHING RAN THEM. `operator/grading/rubric.md:18` says "Run the skill against
 * every fixture" — an instruction to a person. No test, no CI job, and no
 * script referenced `operator/fixtures/` anywhere in this repo. The check
 * existed, stated the correct answer, and could never fail: the ss#2280 class
 * one layer up — not a control that cannot catch what it claims, but a correct
 * control that is never invoked.
 *
 * WHAT THIS GATE DOES AND DOES NOT DO — read before trusting it.
 *
 * It asserts everything about these fixtures that is checkable WITHOUT a model:
 * that each one parses, that its expectations are internally consistent, that
 * its expected rendering agrees with the mapping the skill actually documents,
 * and that both branches of that mapping are covered.
 *
 * It CANNOT catch a model inverting the mapping at runtime. That is what
 * happened on 2026-08-13, and no deterministic test in this repo could have
 * caught it. Catching that needs one of: an eval that invokes the model, a
 * runtime reconciliation of written memos against the events that caused them
 * (ss#2153's territory), or making the phrase mechanical rather than composed.
 * The runtime AC on ss#2360 covers it. This gate makes the FIXTURES honest, so
 * that when something does run them, they are worth running — and so that the
 * documented mapping can no longer drift away from what the fixtures expect.
 *
 * Stating that boundary is the point. A gate whose reach is overstated is how
 * the last one got trusted.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, it, expect } from 'vitest'

const FIXTURE_DIR = 'operator/fixtures/law-firm/matter-memo-on-update'
const SKILL_PATH = 'operator/skills/matter-memo-on-update/SKILL.md'

interface Fixture {
  name: string
  frontmatter: string
  body: string
  event: Record<string, unknown>
  /** `memo_written` | `no_memo` — three of five fixtures deliberately expect no write. */
  expectedOutcome: string | null
  expectedContains: string[]
  expectedNotContains: string[]
  matterId: string | null
}

/** The `source` → phrase mapping, read out of the SKILL's own prose. */
function documentedSourceMapping(): Map<string, string> {
  const skill = readFileSync(resolve(SKILL_PATH), 'utf8')
  const line = skill.split('\n').find((l) => /Carry the `source`/.test(l))
  expect(
    line,
    `SKILL.md must document the source mapping ("Carry the \`source\`: ...")`
  ).toBeTruthy()

  const mapping = new Map<string, string>()
  for (const m of line!.matchAll(/`([A-Za-z]+)`\s*(?:→|->)\s*`([^`]+)`/g)) {
    mapping.set(m[1], m[2])
  }
  return mapping
}

function parseFixture(name: string): Fixture {
  const raw = readFileSync(resolve(FIXTURE_DIR, name), 'utf8')
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  expect(fm, `${name}: must open with a YAML frontmatter block`).toBeTruthy()
  const [, frontmatter, body] = fm!

  // Prose may sit between the heading and the fence (mmou-duplicate-delivery-04
  // explains why the event repeats), so take the first json fence AFTER the
  // heading rather than requiring it to be adjacent.
  const json = body.match(/## Event \(matter\.updated\)[\s\S]*?```json\s*([\s\S]*?)```/)
  expect(json, `${name}: must carry an "## Event (matter.updated)" json block`).toBeTruthy()

  let event: Record<string, unknown>
  try {
    event = JSON.parse(json![1])
  } catch (e) {
    throw new Error(`${name}: the event block is not valid JSON — ${(e as Error).message}`)
  }

  // Deliberately a line scan, not a YAML parse: these list items are the only
  // structure we depend on, and a full parser would drag a dependency in for it.
  const listAfter = (key: string): string[] => {
    const at = frontmatter.indexOf(`${key}:`)
    if (at === -1) return []
    const out: string[] = []
    for (const line of frontmatter.slice(at).split('\n').slice(1)) {
      const item = line.match(/^\s{4,}-\s*'?([^'\n]*?)'?\s*$/)
      if (!item) break
      out.push(item[1])
    }
    return out
  }

  const matter = frontmatter.match(/matter_id:\s*'([^']+)'/)
  const outcome = frontmatter.match(/expected_outcome:\s*(\S+)/)

  return {
    name,
    frontmatter,
    body,
    event,
    expectedOutcome: outcome ? outcome[1] : null,
    expectedContains: listAfter('body_must_contain'),
    expectedNotContains: listAfter('body_must_not_contain'),
    matterId: matter ? matter[1] : null,
  }
}

const fixtureNames = existsSync(resolve(FIXTURE_DIR))
  ? readdirSync(resolve(FIXTURE_DIR))
      .filter((f) => f.endsWith('.md'))
      .sort()
  : []

describe('matter-memo-on-update fixture contract', () => {
  it('the fixture directory exists and is not empty', () => {
    expect(existsSync(resolve(FIXTURE_DIR)), `${FIXTURE_DIR} missing`).toBe(true)
    expect(
      fixtureNames.length,
      'no fixtures found — this gate would assert nothing'
    ).toBeGreaterThan(0)
  })

  it('SKILL.md documents both source values', () => {
    const mapping = documentedSourceMapping()
    expect([...mapping.keys()].sort()).toEqual(['API', 'Smokeball'])
    // Pin the phrases too: if the wording changes, the fixtures below must move
    // with it, and this line is where the reader learns that.
    expect(mapping.get('Smokeball')).toBe('in-app')
    expect(mapping.get('API')).toBe('via an integration')
  })

  describe.each(fixtureNames)('%s', (name) => {
    const fx = parseFixture(name)

    it('parses, and its event names a matter the memo is written to', () => {
      expect(fx.frontmatter).toMatch(/fixture_id:/)
      expect(fx.frontmatter).toMatch(/skill:\s*matter-memo-on-update/)
      const payload = fx.event.payload as Record<string, unknown> | undefined
      expect(payload?.id, `${name}: event.payload.id required`).toBeTruthy()
      if (fx.matterId) {
        expect(
          payload!.id,
          `${name}: expected_create_memo.matter_id must be the matter the event is about — ` +
            `a fixture that expects the memo on a different matter is describing a bug as if it were correct`
        ).toBe(fx.matterId)
      }
    })

    it('declares an outcome, and only a memo-writing fixture expects memo text', () => {
      expect(
        fx.expectedOutcome,
        `${name}: expected_outcome required — without it nothing knows whether this fixture wants a write`
      ).toBeTruthy()
      expect(['memo_written', 'no_memo']).toContain(fx.expectedOutcome)

      if (fx.expectedOutcome === 'no_memo') {
        expect(
          fx.expectedContains,
          `${name}: expects no memo, so it must not also pin memo body text — ` +
            `a fixture that wants both is unsatisfiable and would grade whatever the reader prefers`
        ).toEqual([])
      }
    })

    it.runIf(fx.expectedOutcome === 'memo_written')(
      'expects the rendering the skill documents for its own event source',
      () => {
        const mapping = documentedSourceMapping()
        const source = fx.event.source as string | undefined
        expect(
          source,
          `${name}: event must carry a "source" — it is one of the three facts the memo records`
        ).toBeTruthy()

        const expectedPhrase = mapping.get(source!)
        expect(
          expectedPhrase,
          `${name}: event source "${source}" is not one of the values SKILL.md documents ` +
            `(${[...mapping.keys()].join(', ')})`
        ).toBeTruthy()

        expect(
          fx.expectedContains,
          `${name}: event source is "${source}", so body_must_contain must include ` +
            `"${expectedPhrase}" — this is the assertion whose absence let ss#2360 ship`
        ).toContain(expectedPhrase)

        // And must NOT expect the other branch. A fixture demanding both phrases
        // would pass a memo that says the change was made two ways at once.
        for (const [otherSource, otherPhrase] of mapping) {
          if (otherSource === source) continue
          expect(
            fx.expectedContains,
            `${name}: must not also expect "${otherPhrase}" — that is the other branch of the mapping`
          ).not.toContain(otherPhrase)
        }
      }
    )

    it('never expects a string it also forbids', () => {
      for (const forbidden of fx.expectedNotContains) {
        expect(
          fx.expectedContains,
          `${name}: "${forbidden}" appears in both body_must_contain and body_must_not_contain`
        ).not.toContain(forbidden)
      }
    })
  })

  it('covers BOTH source values among the memo-writing fixtures', () => {
    // Only memo_written fixtures can pin a rendering, so coverage has to be
    // measured over those. A set where both values appear but only one of them
    // ever writes a memo would leave the other branch's phrasing unpinned —
    // which is the state that let ss#2360 ship.
    const writing = fixtureNames
      .map(parseFixture)
      .filter((f) => f.expectedOutcome === 'memo_written')
    expect(
      writing.length,
      'no fixture expects a memo — nothing pins any rendering'
    ).toBeGreaterThan(0)

    const sources = new Set(writing.map((f) => f.event.source as string))
    for (const value of documentedSourceMapping().keys()) {
      expect(
        sources,
        `no memo-writing fixture exercises source="${value}" — the untested branch is the one that inverts`
      ).toContain(value)
    }
  })

  it('covers both a resolved actor and an unidentified one', () => {
    const phrases = fixtureNames.flatMap((n) => parseFixture(n).expectedContains)
    expect(
      phrases.some((p) => p.includes('an unidentified user')),
      'no fixture expects "an unidentified user" — the null-userId path is the live-observed one'
    ).toBe(true)
    expect(
      fixtureNames.some((n) => {
        const fx = parseFixture(n)
        return fx.event.userId != null && !fx.expectedContains.includes('an unidentified user')
      }),
      'no fixture exercises a resolvable userId'
    ).toBe(true)
  })
})
