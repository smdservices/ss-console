/**
 * The gate's decision logic, tested where it can fail.
 *
 * The workflow itself is `actions/github-script`, which no test can execute —
 * so the part that DECIDES lives in a module and is exercised here. That split
 * is the whole point: ss#2280 found eleven checks that could not fail, and a
 * gate against that class must not be the twelfth. Every "accepts" case below
 * has a matching "rejects" case, because a checker that only ever says yes has
 * measured nothing.
 */

import { describe, expect, it } from 'vitest'

import {
  BUG_LABEL,
  EXEMPT_LABEL,
  checkEscapeAnalysis,
  rejectionComment,
} from '../scripts/escape-analysis.mjs'

const COMPLETE = [
  '## Escape analysis',
  '**Class:** identity mismatch — two systems keyed the same object differently',
  '**Should have been caught by:** tests/portal-operator-aliveness.test.ts',
  '**Why it missed:** the hand-rolled D1 fake ignores SQL, so a wrong WHERE clause was invisible',
  '**Closes the class:** moved the suite onto a real migrated SQLite harness',
].join('\n')

describe('escape analysis gate: what it lets through', () => {
  it('accepts a complete analysis in a comment', () => {
    const r = checkEscapeAnalysis({ body: 'the bug', comments: [COMPLETE], labels: [BUG_LABEL] })
    expect(r.ok).toBe(true)
    expect(r.skipped).toBe(false)
  })

  it('accepts a complete analysis written into the issue body', () => {
    expect(checkEscapeAnalysis({ body: COMPLETE, labels: [BUG_LABEL] }).ok).toBe(true)
  })

  it('accepts plain-text prompts without bold or heading decoration', () => {
    const plain = [
      'Class - fail-open default',
      'Should have been caught by - the boot smoke test',
      'Why it missed - the callee swallowed the error the wrapper was written to catch',
      'Closes the class - tri-state return so the omitted path is reachable',
    ].join('\n')
    expect(checkEscapeAnalysis({ comments: [plain], labels: [BUG_LABEL] }).ok).toBe(true)
  })

  it('ignores issues that are not bugs', () => {
    const r = checkEscapeAnalysis({ comments: ['shipped'], labels: ['type:feature'] })
    expect(r.ok).toBe(true)
    expect(r.skipped).toBe(true)
  })

  it('honours the exempt label as a visible decision', () => {
    const r = checkEscapeAnalysis({ comments: ['dupe of #1'], labels: [BUG_LABEL, EXEMPT_LABEL] })
    expect(r.ok).toBe(true)
    expect(r.reason).toContain(EXEMPT_LABEL)
  })

  it('skips a bug closed as not planned — there was no fix to analyse', () => {
    const r = checkEscapeAnalysis({
      comments: ['cannot reproduce'],
      labels: [BUG_LABEL],
      stateReason: 'not_planned',
    })
    expect(r.ok).toBe(true)
    expect(r.skipped).toBe(true)
  })
})

describe('escape analysis gate: what it stops (the falsifiers)', () => {
  it('rejects a bug closed with no analysis at all', () => {
    const r = checkEscapeAnalysis({
      body: 'portal shows the wrong seat',
      comments: ['fixed in #2298'],
      labels: [BUG_LABEL],
    })
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual([
      'Class',
      'Should have been caught by',
      'Why it missed',
      'Closes the class',
    ])
  })

  it('rejects an analysis missing the mechanism — the answer that closes the class', () => {
    const partial = COMPLETE.split('\n').slice(0, 4).join('\n')
    const r = checkEscapeAnalysis({ comments: [partial], labels: [BUG_LABEL] })
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(['Closes the class'])
  })

  it('rejects prompts answered with nothing', () => {
    // The shape of an author satisfying the regex rather than the question.
    const hollow = [
      '**Class:**',
      '**Should have been caught by:**',
      '**Why it missed:**',
      '**Closes the class:**',
    ].join('\n')
    const r = checkEscapeAnalysis({ comments: [hollow], labels: [BUG_LABEL] })
    expect(r.ok).toBe(false)
    expect(r.missing).toHaveLength(4)
  })

  it('rejects an analysis scattered across separate comments', () => {
    // Four fragments nobody wrote together are not an analysis, and stitching
    // them would let a passing verdict emerge from parts no one reviewed as one.
    const scattered = COMPLETE.split('\n').slice(1)
    const r = checkEscapeAnalysis({ comments: scattered, labels: [BUG_LABEL] })
    expect(r.ok).toBe(false)
  })

  it('reports the CLOSEST near-miss when several comments are partial', () => {
    // Otherwise the author is told to write four answers they already wrote.
    const oneAnswer = '**Class:** race condition'
    const threeAnswers = COMPLETE.split('\n').slice(0, 4).join('\n')
    const r = checkEscapeAnalysis({ comments: [oneAnswer, threeAnswers], labels: [BUG_LABEL] })
    expect(r.missing).toEqual(['Closes the class'])
  })

  it('is case-insensitive on the label, so Type:Bug still gates', () => {
    const r = checkEscapeAnalysis({ comments: ['done'], labels: ['Type:Bug'] })
    expect(r.ok).toBe(false)
  })
})

describe('the rejection comment tells the author what to write', () => {
  it('names the missing prompts and shows the shape', () => {
    const text = rejectionComment({ missing: ['Closes the class'] })
    expect(text).toContain('Closes the class')
    expect(text).toContain('## Escape analysis')
    expect(text).toContain(EXEMPT_LABEL)
  })

  it('states why the gate exists, not just that it fired', () => {
    // A gate that only says "rejected" gets resented and then routed around.
    expect(rejectionComment({ missing: ['Class'] })).toContain('could not fail')
  })
})
