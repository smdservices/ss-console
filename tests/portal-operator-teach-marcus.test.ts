/**
 * Tests for the inline "Teach [persona]" rule-add resolver
 * (src/lib/portal/operator/teach-marcus.ts) added in #810.
 *
 * The inline rule-add affordance is the partner's natural-moment path
 * for teaching the Operator a new memory rule — added during draft
 * review rather than by context-switching into the Memory tab. These
 * tests pin the contract at three layers:
 *
 *   1. Vocabulary: MEMORY_RULE_KINDS is the closed four-kind set
 *      mirrored from `operator/adapter/memory/pipeline.py`. The
 *      formatter is total over the vocabulary.
 *   2. Validation: `validateTeachMarcusInput` rejects empty text,
 *      oversize text, missing draft id, and unknown kinds with
 *      specific human-readable reasons. It does not coerce malformed
 *      values into defaults.
 *   3. Audit emission: every accepted rule produces a structured
 *      `audit:memory_rule_added` log line with the issue-specified
 *      metadata shape (no rule body in the audit channel; only the
 *      length).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  MEMORY_RULE_KINDS,
  MEMORY_RULE_TEXT_MAX_LENGTH,
  buildMemoryRuleAddedAuditEvent,
  formatMemoryRuleKind,
  recordMemoryRuleAddedAudit,
  validateTeachMarcusInput,
  type ValidatedMemoryRuleInput,
} from '../src/lib/portal/operator/teach-marcus'

describe('MEMORY_RULE_KINDS vocabulary', () => {
  it('is the closed four-kind vocabulary mirrored from Hermes pipeline', () => {
    expect(MEMORY_RULE_KINDS).toEqual([
      'drafting_voice',
      'recipient_cohort',
      'matter_category',
      'general',
    ])
  })
})

describe('formatMemoryRuleKind', () => {
  it('returns a human-friendly label for every closed-vocabulary kind', () => {
    expect(formatMemoryRuleKind('drafting_voice')).toBe('Drafting voice')
    expect(formatMemoryRuleKind('recipient_cohort')).toBe('Recipient cohort')
    expect(formatMemoryRuleKind('matter_category')).toBe('Matter category')
    expect(formatMemoryRuleKind('general')).toBe('General')
  })

  it('covers every kind in the closed vocabulary', () => {
    for (const kind of MEMORY_RULE_KINDS) {
      const label = formatMemoryRuleKind(kind)
      expect(label.length).toBeGreaterThan(0)
      expect(label).not.toContain('_')
    }
  })
})

describe('validateTeachMarcusInput — happy path', () => {
  it('accepts a well-formed submission with no cohort', () => {
    const result = validateTeachMarcusInput({
      kind: 'drafting_voice',
      text: 'Never use "reach out". Say "contact" instead.',
      sourceDraftId: 'd-810-1',
      recipientCohort: null,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rule.kind).toBe('drafting_voice')
    expect(result.rule.text).toBe('Never use "reach out". Say "contact" instead.')
    expect(result.rule.sourceDraftId).toBe('d-810-1')
    expect(result.rule.recipientCohort).toBeNull()
  })

  it('trims whitespace from the text body before persisting', () => {
    const result = validateTeachMarcusInput({
      kind: 'general',
      text: '   Always cc the paralegal on PI replies.   ',
      sourceDraftId: 'd-810-2',
      recipientCohort: null,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rule.text).toBe('Always cc the paralegal on PI replies.')
  })

  it('accepts a recipient cohort scope and trims it', () => {
    const result = validateTeachMarcusInput({
      kind: 'recipient_cohort',
      text: 'Never apologize first.',
      sourceDraftId: 'd-810-3',
      recipientCohort: '  opposing counsel  ',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rule.recipientCohort).toBe('opposing counsel')
  })

  it('collapses a blank cohort to null rather than rejecting', () => {
    const result = validateTeachMarcusInput({
      kind: 'recipient_cohort',
      text: 'Never apologize first.',
      sourceDraftId: 'd-810-3',
      recipientCohort: '   ',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rule.recipientCohort).toBeNull()
  })
})

describe('validateTeachMarcusInput — rejection paths', () => {
  it('rejects a missing draft id (form-level error)', () => {
    const result = validateTeachMarcusInput({
      kind: 'general',
      text: 'A rule.',
      sourceDraftId: '',
      recipientCohort: null,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBeNull()
    expect(result.reason).toMatch(/draft id/i)
  })

  it('rejects an unknown kind with a kind-field error', () => {
    const result = validateTeachMarcusInput({
      kind: 'totally-made-up',
      text: 'A rule.',
      sourceDraftId: 'd-810-4',
      recipientCohort: null,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('kind')
  })

  it('rejects a null kind with a kind-field error', () => {
    const result = validateTeachMarcusInput({
      kind: null,
      text: 'A rule.',
      sourceDraftId: 'd-810-4',
      recipientCohort: null,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('kind')
  })

  it('rejects empty text with a text-field error', () => {
    const result = validateTeachMarcusInput({
      kind: 'general',
      text: '',
      sourceDraftId: 'd-810-5',
      recipientCohort: null,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('text')
    expect(result.reason).toMatch(/empty/i)
  })

  it('rejects whitespace-only text with a text-field error', () => {
    const result = validateTeachMarcusInput({
      kind: 'general',
      text: '       \n  ',
      sourceDraftId: 'd-810-5',
      recipientCohort: null,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('text')
  })

  it('rejects text above the MAX_LENGTH ceiling', () => {
    const oversize = 'x'.repeat(MEMORY_RULE_TEXT_MAX_LENGTH + 1)
    const result = validateTeachMarcusInput({
      kind: 'general',
      text: oversize,
      sourceDraftId: 'd-810-6',
      recipientCohort: null,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('text')
    expect(result.reason).toMatch(/maximum/i)
  })

  it('accepts text at exactly the MAX_LENGTH ceiling', () => {
    const atCeiling = 'x'.repeat(MEMORY_RULE_TEXT_MAX_LENGTH)
    const result = validateTeachMarcusInput({
      kind: 'general',
      text: atCeiling,
      sourceDraftId: 'd-810-7',
      recipientCohort: null,
    })
    expect(result.ok).toBe(true)
  })

  it('pins MEMORY_RULE_TEXT_MAX_LENGTH at 500', () => {
    expect(MEMORY_RULE_TEXT_MAX_LENGTH).toBe(500)
  })
})

describe('buildMemoryRuleAddedAuditEvent — issue-specified metadata shape', () => {
  function makeRule(overrides: Partial<ValidatedMemoryRuleInput> = {}): ValidatedMemoryRuleInput {
    return {
      kind: 'drafting_voice',
      text: 'Never use "reach out".',
      sourceDraftId: 'd-810-8',
      recipientCohort: null,
      ...overrides,
    }
  }

  it('produces the audit event fields with a deterministic timestamp', () => {
    const event = buildMemoryRuleAddedAuditEvent({
      approverId: 'u-pat',
      customerId: 'ent-smith-law',
      rule: makeRule(),
      now: new Date('2026-05-21T14:00:00.000Z'),
    })

    expect(event.approverId).toBe('u-pat')
    expect(event.customerId).toBe('ent-smith-law')
    expect(event.sourceDraftId).toBe('d-810-8')
    expect(event.kind).toBe('drafting_voice')
    expect(event.textLength).toBe('Never use "reach out".'.length)
    expect(event.recipientCohort).toBeNull()
    expect(event.timestamp).toBe('2026-05-21T14:00:00.000Z')
  })

  it('records the cohort when present', () => {
    const event = buildMemoryRuleAddedAuditEvent({
      approverId: 'u-pat',
      customerId: 'ent-smith-law',
      rule: makeRule({ kind: 'recipient_cohort', recipientCohort: 'opposing counsel' }),
      now: new Date('2026-05-21T15:00:00.000Z'),
    })
    expect(event.recipientCohort).toBe('opposing counsel')
  })

  it('records the rule LENGTH, not the rule body', () => {
    // The audit channel is not the right surface for the rule body
    // (short rules contain authored prose). The Memory tab reads from
    // the persisted row when the bridge lands; the audit row only
    // records that a rule of N characters was added.
    const event = buildMemoryRuleAddedAuditEvent({
      approverId: 'u-pat',
      customerId: 'ent-smith-law',
      rule: makeRule({ text: 'A confidential rule body.' }),
    })
    expect((event as unknown as Record<string, unknown>).text).toBeUndefined()
    expect(event.textLength).toBe('A confidential rule body.'.length)
  })
})

describe('recordMemoryRuleAddedAudit — log-line emission contract', () => {
  it('emits a structured JSON line with the audit:memory_rule_added prefix and MEMORY_RULE_ADDED action', async () => {
    const lines: string[] = []
    const original = console.info
    console.info = ((...args: unknown[]) => {
      lines.push(args.map((a) => String(a)).join(' '))
    }) as typeof console.info

    try {
      await recordMemoryRuleAddedAudit(
        buildMemoryRuleAddedAuditEvent({
          approverId: 'u-pat',
          customerId: 'ent-smith-law',
          rule: {
            kind: 'matter_category',
            text: 'On PI cases, always cc the paralegal.',
            sourceDraftId: 'd-810-9',
            recipientCohort: null,
          },
          now: new Date('2026-05-21T16:00:00.000Z'),
        })
      )
    } finally {
      console.info = original
    }

    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.type).toBe('audit:memory_rule_added')
    expect(parsed.action).toBe('MEMORY_RULE_ADDED')
    expect(parsed.approverId).toBe('u-pat')
    expect(parsed.customerId).toBe('ent-smith-law')
    expect(parsed.sourceDraftId).toBe('d-810-9')
    expect(parsed.kind).toBe('matter_category')
    expect(parsed.textLength).toBe('On PI cases, always cc the paralegal.'.length)
    expect(parsed.timestamp).toBe('2026-05-21T16:00:00.000Z')
  })
})

describe('persona-name no-fabrication contract', () => {
  it('never references a hardcoded "Marcus" anywhere in the resolver module', () => {
    // Persona names in user-facing copy must come from
    // getActivePersona() at the page level. The resolver module itself
    // must not contain a hardcoded fixture name. This test reads its
    // own source file and asserts the absence of "Marcus" outside of
    // documentation context.
    //
    // Documentation context is the file's @file docstring; we check
    // the SOURCE of the module rather than the imports surface to
    // catch any accidental string literal.
    //
    // We use static fs / path imports so the source-of-truth module
    // stays free of meta-introspection.
    const resolverPath = resolve('src/lib/portal/operator/teach-marcus.ts')
    const source = readFileSync(resolverPath, 'utf-8')
    // Strip block comments; the persona name may appear in a docstring
    // since the file name itself carries it for traceability.
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '')
    // After stripping comments, the persona-name string literal must
    // not appear in any code path. Constants, defaults, fixtures, or
    // copy strings all violate this rule.
    expect(stripped).not.toMatch(/['"`]Marcus['"`]/)
  })
})

describe('MemoryRuleKind type — every kind is reachable', () => {
  it('every closed-vocab kind can be passed into validate without rejection on the kind axis', () => {
    for (const kind of MEMORY_RULE_KINDS) {
      const result = validateTeachMarcusInput({
        kind,
        text: 'A rule.',
        sourceDraftId: 'd-810-x',
        recipientCohort: null,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.rule.kind).toBe(kind)
    }
  })
})
