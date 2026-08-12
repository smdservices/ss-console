/**
 * Escape analysis: the four questions a closed bug must answer.
 *
 * WHY (ss#2280, 2026-08-12). The venture ran a latent-defect audit after the
 * Captain asked why bugs keep escaping build + test + review. The answer was not
 * diligence. Eleven instruments were found that COULD NOT FAIL — a D1 fake that
 * ignores SQL, an HMAC parity test pinning a transcription of the script instead
 * of the script, a workflow step whose findings path `bash -e` killed before it
 * could print, a mock acknowledging nothing the caller sent. Each had been green
 * for as long as it existed.
 *
 * Those were found by one heavyweight audit. The everyday version never runs,
 * because nothing asks the question at the moment the knowledge is cheapest: the
 * instant someone closes a bug and still remembers why it hid.
 *
 * WHAT THIS ASKS. Four questions, a sentence each. Not a form — the point is the
 * fourth answer, which is what turns one fix into a closed class:
 *
 *   Class                    what KIND of defect this is
 *   Should have been caught by   which existing gate had the job
 *   Why it missed             usually: the gate's world differed from the runtime's
 *   Closes the class          the mechanism, not the instance
 *
 * DELIBERATELY SMALL. A gate that fires on everything gets routed around, and
 * then it protects nothing (the lesson written into scope-deferred-todo.yml).
 * This fires only on `type:bug`, only on a completed close, and any bug that
 * genuinely does not warrant the analysis takes the exempt label — a visible,
 * greppable decision rather than a silent skip.
 */

/** Issues without this label are none of this gate's business. */
export const BUG_LABEL = 'type:bug'

/** Escape hatch. Deliberate and visible, like `scope-deferred` on the TODO gate. */
export const EXEMPT_LABEL = 'escape-analysis-exempt'

/**
 * The four prompts. Matching is deliberately loose on decoration (bold markers,
 * heading level, trailing colon) and strict on wording, so the block stays
 * greppable across the repo while nobody has to remember exact markdown.
 */
export const REQUIRED_PROMPTS = [
  { key: 'class', label: 'Class', pattern: /^[\s>*_#-]*class\b\s*[:—-]/im },
  {
    key: 'gate',
    label: 'Should have been caught by',
    pattern: /^[\s>*_#-]*should have been caught by\b\s*[:—-]/im,
  },
  { key: 'why', label: 'Why it missed', pattern: /^[\s>*_#-]*why it missed\b\s*[:—-]/im },
  {
    key: 'mechanism',
    label: 'Closes the class',
    pattern: /^[\s>*_#-]*closes the class\b\s*[:—-]/im,
  },
]

/** A prompt answered with nothing is not an answer. */
const MIN_ANSWER_CHARS = 12

/**
 * Extract the text following a prompt, stopping at a blank line OR at the next
 * prompt. Stopping at the next prompt is load-bearing, not tidiness: four empty
 * prompts on consecutive lines would otherwise let each one's "answer" run on
 * into the prompts below it and count as content — a checker that accepts the
 * shape of an author satisfying the regex rather than the question. Caught by
 * the hollow-prompts test, which failed on the first implementation.
 */
function answerFor(text, pattern) {
  const match = pattern.exec(text)
  if (!match) return ''
  const after = text.slice(match.index + match[0].length)
  const blankLine = after.search(/\n\s*\n/)
  const nextPrompt = REQUIRED_PROMPTS.map((p) => {
    // Search from the line after this prompt so it cannot match itself.
    const rest = after.replace(/^[^\n]*/, '')
    const hit = p.pattern.exec(rest)
    return hit ? hit.index + (after.length - rest.length) : -1
  }).filter((i) => i > -1)
  const stops = [blankLine, ...nextPrompt].filter((i) => i > -1)
  const stop = stops.length ? Math.min(...stops) : -1
  return (stop === -1 ? after : after.slice(0, stop)).replace(/[*_>`#-]/g, '').trim()
}

/**
 * Every field is optional so a caller can pass only what it has — the tests
 * exercise label-only and body-only shapes, and a required-param signature would
 * reject them at typecheck while the runtime handled them fine.
 *
 * @param {object} [input]
 * @param {string} [input.body]          issue body
 * @param {string[]} [input.comments]    comment bodies, any order
 * @param {string[]} [input.labels]      issue label names
 * @param {string} [input.stateReason]   GitHub close reason ("completed" | "not_planned" | ...)
 * @returns {{ ok: boolean, skipped: boolean, reason: string, missing: string[] }}
 */
export function checkEscapeAnalysis({ body = '', comments = [], labels = [], stateReason } = {}) {
  const names = labels.map((l) => String(l).toLowerCase())

  if (!names.includes(BUG_LABEL)) {
    return { ok: true, skipped: true, reason: `not labeled ${BUG_LABEL}`, missing: [] }
  }
  if (names.includes(EXEMPT_LABEL)) {
    return { ok: true, skipped: true, reason: `exempted by ${EXEMPT_LABEL}`, missing: [] }
  }
  // A bug closed as not-planned (duplicate, cannot reproduce, won't fix) never
  // had a fix, so there is no escape to analyse.
  if (stateReason && stateReason !== 'completed') {
    return { ok: true, skipped: true, reason: `closed as ${stateReason}`, missing: [] }
  }

  // The analysis may live in the body or in ANY comment, but it must be whole in
  // ONE of them: four answers scattered across four comments is not an analysis,
  // and stitching them would let a passing verdict emerge from fragments nobody
  // wrote together.
  const candidates = [body, ...comments].filter((t) => typeof t === 'string' && t.trim())

  let best = REQUIRED_PROMPTS.map((p) => p.label)
  for (const text of candidates) {
    const missing = REQUIRED_PROMPTS.filter(
      (p) => answerFor(text, p.pattern).length < MIN_ANSWER_CHARS
    ).map((p) => p.label)
    if (missing.length === 0) {
      return { ok: true, skipped: false, reason: 'escape analysis present', missing: [] }
    }
    if (missing.length < best.length) best = missing
  }

  return {
    ok: false,
    skipped: false,
    reason: 'escape analysis missing or incomplete',
    missing: best,
  }
}

/** The comment posted when a close is rejected. Says what to write, not just what is wrong. */
export function rejectionComment({ missing }) {
  return [
    'Reopened: this bug closed without an escape analysis.',
    '',
    'Not bureaucracy. ss#2280 found eleven checks that could not fail, each green for as',
    'long as it existed. They were found by one heavyweight audit; this asks the same',
    'four questions at the moment the knowledge is cheapest, while you still remember why',
    'it hid. The fourth answer is the one that matters, because it turns one fix into a',
    'closed class.',
    '',
    `Missing or unanswered: ${missing.join(', ')}.`,
    '',
    'Add a comment in this shape, then close again:',
    '',
    '```markdown',
    '## Escape analysis',
    '**Class:** identity mismatch — two systems keyed the same object differently',
    '**Should have been caught by:** tests/portal-operator-aliveness.test.ts',
    '**Why it missed:** its D1 fake ignores SQL, so a wrong WHERE clause was invisible',
    '**Closes the class:** moved the suite onto a real migrated SQLite harness',
    '```',
    '',
    `If this bug genuinely does not warrant the analysis (duplicate, external, trivial typo), label it \`${EXEMPT_LABEL}\` and close again. That is a visible decision rather than a silent skip.`,
  ].join('\n')
}
