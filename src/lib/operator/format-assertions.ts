/**
 * The closed vocabulary of machine-checkable shape rules a client can author
 * (ADR 0083 §3), and the producing half of a contract whose consuming half has
 * been live since overlay#207.
 *
 * THE GAP THIS CLOSES. The seat's checker (`shared/format_check.py`) reads
 * `assertions` out of the root-owned manifest, the applier carries them
 * verbatim from the customer's vault object, and the gate refuses a
 * non-conforming send. Every one of those existed. Nothing wrote assertions
 * into the vault object: the console emitted `{body, sha256}` and no more. So
 * the enforceable half of "how it should be shaped" was authorable by hand-
 * editing JSON and by no other means — which is to say, by us and not by a
 * client. This module is what a Named Administrator uses instead.
 *
 * RULES → SENTENCE, NEVER SENTENCE → RULES. The client picks from the closed
 * set below and `describeAssertions` renders the picks back as plain English.
 * The reverse direction — deriving rules from their typed prose — is refused by
 * design: a model doing that conversion turns a misreading into a hard block on
 * a rule the client never wrote and cannot see, which is strictly worse than
 * advisory prose. Rules → sentence is inspectable; sentence → rules is not.
 * The seat's own checker docstring draws this line first.
 *
 * FORMAT ONLY, NEVER VOICE. ADR 0083 §3: format is binary, voice is
 * probabilistic. Assertions decide; prose is graded. Offering a checkable rule
 * for voice would promise enforcement of how something SOUNDS — a promise the
 * substrate cannot keep. `assertionsApplyTo` is the single place that says so.
 *
 * AN INERT RULE IS A DEFECT, NOT A NO-OP. `single_closing_line` means nothing
 * without a closing prefix to count, so authoring it alone is refused rather
 * than stored. The applier holds the same line about malformed assertions:
 * silently discarding a shape rule "would leave the customer believing a rule
 * is enforced while nothing checks it — worse than refusing the write."
 *
 * GROWING THIS SET IS A TWO-REPO ACT. A rule offered here that the seat's
 * `KNOWN_ASSERTIONS` does not carry is ignored on the seat — degrading safely,
 * but leaving the client believing something is enforced that is not. The seat
 * must understand a rule before this file offers it.
 * `tests/format-assertions.test.ts` pins the set so adding one is deliberate
 * and reviewed rather than incidental.
 */

import type { SpecProperty } from './output-class-specs'

/**
 * Every rule name, mirroring the seat's `shared/format_check.py`
 * `KNOWN_ASSERTIONS`. Order is the order the form renders them.
 */
export const ASSERTION_RULES = [
  'opening_line_prefix',
  'closing_line_prefix',
  'single_closing_line',
  'forbid_bullets',
  'forbid_substrings',
  'max_chars',
] as const

export type AssertionRule = (typeof ASSERTION_RULES)[number]

/** The stored shape: what rides in the vault object beside a format body. */
export type Assertions = Partial<{
  opening_line_prefix: string
  closing_line_prefix: string
  single_closing_line: true
  forbid_bullets: true
  forbid_substrings: string[]
  max_chars: number
}>

/**
 * Which spec property may carry assertions. See the FORMAT ONLY note above —
 * this is deliberately a function rather than a bare constant, so a caller that
 * wants to author a rule for voice has to read the reason it cannot.
 */
export function assertionsApplyTo(property: SpecProperty): boolean {
  return property === 'format'
}

// ---------------------------------------------------------------------------
// Bounds
//
// Each one exists to keep a rule readable when rendered back. A forbidden-word
// list nobody can read in a sentence is a rule the client cannot verify, and an
// unverifiable rule is the thing this whole surface exists to replace.
// ---------------------------------------------------------------------------

/** A line prefix. Long enough for a real required opener, short of a paragraph. */
export const MAX_PREFIX_CHARS = 120
/** Forbidden substrings: how many, and how long each may be. */
export const MAX_FORBIDDEN_ENTRIES = 25
export const MAX_FORBIDDEN_CHARS = 100
/** Upper bound on an authored length ceiling. */
export const MAX_LENGTH_CEILING = 200_000

/** Form field name for one rule on one class. Mirrors `specFieldName`. */
export function assertionFieldName(outputClass: string, rule: AssertionRule): string {
  return `assertions[${outputClass}].${rule}`
}

// ---------------------------------------------------------------------------
// Build (form → stored shape)
// ---------------------------------------------------------------------------

export type AssertionBuildResult =
  { ok: true; assertions: Assertions } | { ok: false; errors: readonly string[] }

/**
 * Read one class's rules out of a submitted form.
 *
 * The iteration is over `ASSERTION_RULES`, never over the form's own keys —
 * the same security property `collectAuthoredBodies` holds. A hand-crafted POST
 * naming a rule outside the vocabulary contributes nothing, because nothing here
 * ever looks for it. That is stronger than refusing an unknown rule: an unknown
 * rule cannot be expressed on this surface at all.
 */
export function buildAssertions(form: FormData, outputClass: string): AssertionBuildResult {
  const errors: string[] = []
  const out: Assertions = {}

  readPrefix(form, outputClass, 'opening_line_prefix', out, errors)
  readPrefix(form, outputClass, 'closing_line_prefix', out, errors)
  readFlag(form, outputClass, 'single_closing_line', out)
  readFlag(form, outputClass, 'forbid_bullets', out)
  readForbidden(form, outputClass, out, errors)
  readCeiling(form, outputClass, out, errors)

  // An inert rule is refused, not stored. See the header.
  if (out.single_closing_line === true && out.closing_line_prefix === undefined) {
    errors.push(
      '"only one closing line" needs a closing line to count. Set the required closing line, ' +
        'or clear this rule.'
    )
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, assertions: out }
}

/**
 * A required line prefix.
 *
 * TRIMMED, DELIBERATELY. The seat compares against lines it has already
 * stripped, so a trailing space authored here would be invisible on screen and
 * could only ever make the rule harder to satisfy. Trimming makes every stored
 * prefix one the client can see in full.
 */
function readPrefix(
  form: FormData,
  outputClass: string,
  rule: 'opening_line_prefix' | 'closing_line_prefix',
  out: Assertions,
  errors: string[]
): void {
  const raw = form.get(assertionFieldName(outputClass, rule))
  if (typeof raw !== 'string') return
  const value = raw.trim()
  if (value.length === 0) return
  if (value.length > MAX_PREFIX_CHARS) {
    errors.push(`${RULE_LABEL[rule]}: keep it under ${MAX_PREFIX_CHARS} characters.`)
    return
  }
  out[rule] = value
}

/** A checkbox. Present means true; the stored value is only ever `true`. */
function readFlag(
  form: FormData,
  outputClass: string,
  rule: 'single_closing_line' | 'forbid_bullets',
  out: Assertions
): void {
  if (form.get(assertionFieldName(outputClass, rule)) !== null) out[rule] = true
}

/** One forbidden substring per line. Blank lines are not rules. */
function readForbidden(
  form: FormData,
  outputClass: string,
  out: Assertions,
  errors: string[]
): void {
  const raw = form.get(assertionFieldName(outputClass, 'forbid_substrings'))
  if (typeof raw !== 'string') return
  const entries = raw
    .split(/\r\n?|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (entries.length === 0) return
  if (entries.length > MAX_FORBIDDEN_ENTRIES) {
    errors.push(`${RULE_LABEL.forbid_substrings}: at most ${MAX_FORBIDDEN_ENTRIES} entries.`)
    return
  }
  const overlong = entries.find((entry) => entry.length > MAX_FORBIDDEN_CHARS)
  if (overlong !== undefined) {
    errors.push(
      `${RULE_LABEL.forbid_substrings}: each entry must be under ${MAX_FORBIDDEN_CHARS} characters.`
    )
    return
  }
  out.forbid_substrings = entries
}

/** A positive whole-number character ceiling. */
function readCeiling(form: FormData, outputClass: string, out: Assertions, errors: string[]): void {
  const raw = form.get(assertionFieldName(outputClass, 'max_chars'))
  if (typeof raw !== 'string') return
  const value = raw.trim()
  if (value.length === 0) return
  if (!/^\d+$/.test(value)) {
    errors.push(`${RULE_LABEL.max_chars}: must be a whole number.`)
    return
  }
  const parsed = Number(value)
  if (parsed <= 0 || parsed > MAX_LENGTH_CEILING) {
    errors.push(`${RULE_LABEL.max_chars}: must be between 1 and ${MAX_LENGTH_CEILING}.`)
    return
  }
  out.max_chars = parsed
}

// ---------------------------------------------------------------------------
// Parse (vault object → stored shape)
// ---------------------------------------------------------------------------

/**
 * Parse assertions read back from the vault.
 *
 * STRICT, AND THE STRICTNESS IS THE POINT. An unrecognised rule name or a
 * malformed value fails the parse, which surfaces the whole document as
 * unreadable and refuses the write rather than round-tripping a rule this
 * surface cannot show. Carrying an unshowable rule forward would leave a client
 * looking at a form that does not describe what their Operator enforces.
 */
export function parseAssertions(raw: unknown, path: string, errors: string[]): Assertions | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`${path}: must be an object when present`)
    return null
  }
  const out: Assertions = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(ASSERTION_RULES as readonly string[]).includes(key)) {
      errors.push(`${path}.${key}: not a rule this surface can show`)
      continue
    }
    parseOneRule(key as AssertionRule, value, `${path}.${key}`, out, errors)
  }
  return Object.keys(out).length > 0 ? out : null
}

function parseOneRule(
  rule: AssertionRule,
  value: unknown,
  path: string,
  out: Assertions,
  errors: string[]
): void {
  if (rule === 'opening_line_prefix' || rule === 'closing_line_prefix') {
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(`${path}: must be a non-empty string`)
      return
    }
    out[rule] = value
    return
  }
  if (rule === 'single_closing_line' || rule === 'forbid_bullets') {
    if (value !== true) {
      errors.push(`${path}: must be true when present`)
      return
    }
    out[rule] = true
    return
  }
  if (rule === 'forbid_substrings') {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.length === 0)) {
      errors.push(`${path}: must be an array of non-empty strings`)
      return
    }
    out.forbid_substrings = value as string[]
    return
  }
  if (!Number.isInteger(value) || typeof value !== 'number' || value <= 0) {
    errors.push(`${path}: must be a positive whole number`)
    return
  }
  out.max_chars = value
}

// ---------------------------------------------------------------------------
// Describe (stored shape → plain English)
// ---------------------------------------------------------------------------

/** Human label per rule, shared by the form and every error message. */
export const RULE_LABEL: Record<AssertionRule, string> = {
  opening_line_prefix: 'Required opening line',
  closing_line_prefix: 'Required closing line',
  single_closing_line: 'Only one closing line',
  forbid_bullets: 'No bullets or numbered lists',
  forbid_substrings: 'Words to avoid',
  max_chars: 'Length limit',
}

/**
 * What is enforced, as sentences a client can check against their intent.
 *
 * This is the readable half of the contract. The client picked rules; this
 * shows them back in the words they would have used, so the rule and the
 * understanding of the rule cannot drift apart. Empty means nothing is
 * mechanically enforced for this class — which the caller must say plainly
 * rather than leave as an absence.
 */
export function describeAssertions(assertions: Assertions | null | undefined): string[] {
  if (!assertions) return []
  const out: string[] = []
  if (assertions.opening_line_prefix !== undefined) {
    out.push(`The first line must begin "${assertions.opening_line_prefix}".`)
  }
  if (assertions.closing_line_prefix !== undefined) {
    out.push(`The last line must begin "${assertions.closing_line_prefix}".`)
  }
  if (assertions.single_closing_line === true && assertions.closing_line_prefix !== undefined) {
    out.push(`Exactly one line may begin "${assertions.closing_line_prefix}".`)
  }
  if (assertions.forbid_bullets === true) {
    out.push('No line may be a bullet or a numbered item.')
  }
  if (assertions.forbid_substrings !== undefined) {
    out.push(`These may not appear: ${assertions.forbid_substrings.join(', ')}.`)
  }
  if (assertions.max_chars !== undefined) {
    out.push(`The whole output must be under ${assertions.max_chars} characters.`)
  }
  return out
}
