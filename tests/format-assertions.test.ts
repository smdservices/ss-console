/**
 * Client-authored shape rules (ADR 0083 §3, the producing half of overlay#207).
 *
 * Four properties here are load-bearing enough that a regression would be
 * silent and would reach a running Operator:
 *
 *  1. THE VOCABULARY IS PINNED. A rule this surface offers that the seat's
 *     `shared/format_check.py::KNOWN_ASSERTIONS` does not carry is IGNORED on
 *     the seat — safe degradation, but it leaves the client believing something
 *     is enforced that is not. Growing the set must be a deliberate, reviewed,
 *     two-repo act, so the set is asserted literally.
 *  2. FORMAT ONLY. Voice is probabilistic and graded; format is binary and
 *     decided. A checkable rule on the voice property would promise enforcement
 *     of how something sounds.
 *  3. NO INERT RULE. A stored rule nothing can check is worse than no rule.
 *     `single_closing_line` without a closing prefix is refused, not stored.
 *  4. RULES → SENTENCE. Every rule renders back in plain English, so the rule
 *     and the client's understanding of it cannot drift apart. A rule with no
 *     sentence is invisible.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  ASSERTION_RULES,
  MAX_FORBIDDEN_CHARS,
  MAX_FORBIDDEN_ENTRIES,
  MAX_LENGTH_CEILING,
  MAX_PREFIX_CHARS,
  RULE_LABEL,
  assertionFieldName,
  assertionsApplyTo,
  buildAssertions,
  describeAssertions,
  parseAssertions,
  type Assertions,
} from '../src/lib/operator/format-assertions'
import {
  buildSpecDocument,
  collectAuthoredBodies,
  parseSpecDocument,
  serializeSpecDocument,
} from '../src/lib/operator/output-class-specs'

const ADVANCED_PAGE_SOURCE = readFileSync(
  fileURLToPath(
    new URL(
      '../src/pages/portal/products/operator/[instance]/settings/advanced/index.astro',
      import.meta.url
    )
  ),
  'utf8'
)

const ENDPOINT_SOURCE = readFileSync(
  fileURLToPath(
    new URL('../src/pages/api/portal/operator/settings/output-class-specs.ts', import.meta.url)
  ),
  'utf8'
)

/** A form carrying one class's rules. */
function ruleForm(outputClass: string, values: Record<string, string>): FormData {
  const form = new FormData()
  for (const [rule, value] of Object.entries(values)) {
    form.set(assertionFieldName(outputClass, rule as (typeof ASSERTION_RULES)[number]), value)
  }
  return form
}

describe('the rule vocabulary is a closed set the seat also understands', () => {
  it('pins the exact rules, so growing the set is deliberate', () => {
    // Mirrors shared/format_check.py::KNOWN_ASSERTIONS. If this fails because a
    // rule was ADDED, the seat must understand it first — an unknown rule is
    // ignored there, which silently under-enforces.
    expect([...ASSERTION_RULES]).toEqual([
      'opening_line_prefix',
      'closing_line_prefix',
      'single_closing_line',
      'forbid_bullets',
      'forbid_substrings',
      'max_chars',
    ])
  })

  it('gives every rule a label and a sentence', () => {
    for (const rule of ASSERTION_RULES) {
      expect(RULE_LABEL[rule], rule).toBeTruthy()
    }
    const everything: Assertions = {
      opening_line_prefix: 'Summary:',
      closing_line_prefix: 'Next:',
      single_closing_line: true,
      forbid_bullets: true,
      forbid_substrings: ['ASAP'],
      max_chars: 900,
    }
    // One sentence per authored rule — nothing enforced without being stated.
    expect(describeAssertions(everything)).toHaveLength(ASSERTION_RULES.length)
  })

  it('says nothing when nothing is authored', () => {
    expect(describeAssertions(null)).toEqual([])
    expect(describeAssertions({})).toEqual([])
  })
})

describe('rules attach to format and never to voice', () => {
  it('answers for each property', () => {
    expect(assertionsApplyTo('format')).toBe(true)
    expect(assertionsApplyTo('voice')).toBe(false)
  })

  it('stores rules on the format body only', async () => {
    const rules = new Map<string, Assertions>([['staff', { forbid_bullets: true }]])
    const built = await buildSpecDocument(
      [
        { outputClass: 'staff', property: 'voice', body: 'Warm and brief.' },
        { outputClass: 'staff', property: 'format', body: 'Lead with the ask.' },
      ],
      rules
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.doc.classes.staff?.voice?.assertions).toBeUndefined()
    expect(built.doc.classes.staff?.format?.assertions).toEqual({ forbid_bullets: true })
  })

  it('refuses a vault document that put rules on voice', () => {
    const parsed = parseSpecDocument(
      JSON.stringify({
        schema_version: 1,
        classes: {
          staff: { voice: { body: 'x', sha256: 'a', assertions: { forbid_bullets: true } } },
        },
      })
    )
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors.join(' ')).toMatch(/only the format property carries rules/)
  })
})

describe('an inert rule is refused rather than stored', () => {
  it('refuses "only one closing line" with no closing line to count', () => {
    const built = buildAssertions(ruleForm('staff', { single_closing_line: 'true' }), 'staff')
    expect(built.ok).toBe(false)
    if (built.ok) return
    expect(built.errors.join(' ')).toMatch(/needs a closing line to count/)
  })

  it('accepts it once a closing line exists', () => {
    const built = buildAssertions(
      ruleForm('staff', { single_closing_line: 'true', closing_line_prefix: 'Next:' }),
      'staff'
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.assertions).toEqual({ single_closing_line: true, closing_line_prefix: 'Next:' })
  })

  it('drops a rule left blank rather than storing an empty one', () => {
    const built = buildAssertions(
      ruleForm('staff', { opening_line_prefix: '   ', forbid_substrings: '\n  \n', max_chars: '' }),
      'staff'
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.assertions).toEqual({})
  })
})

describe('a rule outside the vocabulary cannot be expressed', () => {
  it('ignores a hand-crafted field naming an unknown rule', () => {
    // The iteration is over ASSERTION_RULES, never over the form's own keys —
    // the same security property collectAuthoredBodies holds. This is stronger
    // than refusing an unknown rule: it cannot be submitted at all.
    const form = new FormData()
    form.set('assertions[staff].run_arbitrary_regex', '.*')
    form.set('assertions[staff].forbid_bullets', 'true')
    const built = buildAssertions(form, 'staff')
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.assertions).toEqual({ forbid_bullets: true })
  })

  it('refuses a vault document carrying an unknown rule', () => {
    // Strictness here is the point: a rule this surface cannot render is a rule
    // the client cannot see, and round-tripping it would leave the form
    // describing something other than what the Operator enforces.
    const errors: string[] = []
    const parsed = parseAssertions(
      { conjure_a_tone: true },
      'classes.staff.format.assertions',
      errors
    )
    expect(parsed).toBeNull()
    expect(errors.join(' ')).toMatch(/not a rule this surface can show/)
  })

  it('refuses a malformed value for a known rule', () => {
    const errors: string[] = []
    parseAssertions({ max_chars: 0 }, 'p', errors)
    parseAssertions({ forbid_bullets: 'yes' }, 'p', errors)
    parseAssertions({ forbid_substrings: ['ok', ''] }, 'p', errors)
    expect(errors).toHaveLength(3)
  })
})

describe('the server holds every bound', () => {
  it('refuses an over-long prefix', () => {
    const built = buildAssertions(
      ruleForm('staff', { opening_line_prefix: 'x'.repeat(MAX_PREFIX_CHARS + 1) }),
      'staff'
    )
    expect(built.ok).toBe(false)
  })

  it('refuses too many forbidden entries, and an over-long one', () => {
    const many = Array.from({ length: MAX_FORBIDDEN_ENTRIES + 1 }, (_, i) => `w${i}`).join('\n')
    expect(buildAssertions(ruleForm('staff', { forbid_substrings: many }), 'staff').ok).toBe(false)
    const long = 'x'.repeat(MAX_FORBIDDEN_CHARS + 1)
    expect(buildAssertions(ruleForm('staff', { forbid_substrings: long }), 'staff').ok).toBe(false)
  })

  it('refuses a ceiling that is not a positive whole number', () => {
    for (const value of ['0', '-5', '12.5', 'lots', String(MAX_LENGTH_CEILING + 1)]) {
      expect(buildAssertions(ruleForm('staff', { max_chars: value }), 'staff').ok, value).toBe(
        false
      )
    }
  })

  it('trims a prefix so no invisible character can make a rule unsatisfiable', () => {
    const built = buildAssertions(ruleForm('staff', { closing_line_prefix: '  Next: ' }), 'staff')
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.assertions.closing_line_prefix).toBe('Next:')
  })
})

describe('rules survive the round trip to the vault and back', () => {
  it('serializes and re-parses every rule unchanged', async () => {
    const authored: Assertions = {
      opening_line_prefix: 'Summary:',
      closing_line_prefix: 'Next:',
      single_closing_line: true,
      forbid_bullets: true,
      forbid_substrings: ['ASAP', 'circle back'],
      max_chars: 1200,
    }
    const built = await buildSpecDocument(
      collectAuthoredBodies(formWithBody(), ['staff']),
      new Map([['staff', authored]])
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const reparsed = parseSpecDocument(serializeSpecDocument(built.doc))
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.doc.classes.staff?.format?.assertions).toEqual(authored)
  })
})

function formWithBody(): FormData {
  const form = new FormData()
  form.set('specs[staff].format', 'Lead with what changed.')
  return form
}

describe('the refusal reaches the person who can fix it', () => {
  it('gives the invalid-rule status a banner on the page it redirects to', () => {
    // A status with no banner renders as no message at all: the person is
    // returned to the form, nothing saved, nothing said.
    expect(ENDPOINT_SOURCE).toMatch(/'spec_invalid_rule'/)
    expect(ADVANCED_PAGE_SOURCE).toMatch(/^\s*spec_invalid_rule: \{/m)
  })

  it('withholds the rule controls where the seat would not check them', () => {
    // Offering rules under a class the gate does not bind would let a client
    // author something they believe is enforced while nothing checks it. The
    // binding is computed from the declaration in one component and consumed as
    // the only branch in the other.
    const specs = readFileSync(
      fileURLToPath(
        new URL('../src/components/portal/operator/OutputClassSpecs.astro', import.meta.url)
      ),
      'utf8'
    )
    const rules = readFileSync(
      fileURLToPath(
        new URL('../src/components/portal/operator/OutputClassRules.astro', import.meta.url)
      ),
      'utf8'
    )
    expect(specs).toMatch(/rulesBind: entry\.format_spec === 'expected'/)
    expect(specs).toMatch(/binds=\{row\.rulesBind\}/)
    expect(rules).toMatch(/binds \? \(/)
  })
})
