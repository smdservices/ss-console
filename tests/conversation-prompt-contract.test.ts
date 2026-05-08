/**
 * Source-level contract tests for the V2 multi-turn intake system prompt
 * (`CONVERSATION_SYSTEM_PROMPT` in `src/lib/claude/conversation.ts`).
 *
 * The prompt runs on every prospect submission. Drift here changes the
 * voice of the firm. These assertions lock the doctrine that emerged
 * from Captain's brief: question-as-utility, no validation theater, no
 * universal observations, multi-turn awareness.
 */

import { describe, it, expect } from 'vitest'
import { CONVERSATION_SYSTEM_PROMPT } from '../src/lib/claude/conversation'

describe('CONVERSATION_SYSTEM_PROMPT (V2 doctrine)', () => {
  const lower = CONVERSATION_SYSTEM_PROMPT.toLowerCase()

  it('commits the agent to ending each turn on a question', () => {
    expect(lower).toContain('end on the question')
  })

  it('forbids reflection-then-question template (validation theater)', () => {
    expect(lower).toContain('skip reflection')
  })

  it('explicitly bans the "we hear you" framing', () => {
    expect(lower).toContain('"we hear you"')
  })

  it('forbids universal observations about businesses (the consultant tell)', () => {
    expect(lower).toContain('universal observations')
    // The example phrasings the prompt cites as forbidden.
    expect(lower).toContain('leave a mark')
  })

  it('lists the canonical AI-vocabulary bans', () => {
    for (const word of [
      'delve',
      'embark',
      'robust',
      'holistic',
      'seamless',
      'leverage',
      'synergy',
      'streamline',
      'comprehensive',
      'navigate',
      'unlock',
    ]) {
      expect(lower).toContain(word)
    }
  })

  it('bans the validation phrases captured in feedback memory', () => {
    for (const phrase of [
      '"we hear you"',
      '"i hear you"',
      '"absolutely"',
      '"thanks for sharing"',
      '"thanks for reaching out"',
    ]) {
      expect(lower).toContain(phrase)
    }
  })

  it('bans em dashes', () => {
    expect(lower).toContain('em dashes')
    // The prompt body itself must not contain em dashes (would defeat
    // the rule by example).
    expect(CONVERSATION_SYSTEM_PROMPT).not.toMatch(/[—]/)
  })

  it('codifies the two-outcome win condition (book or share signal)', () => {
    expect(lower).toContain('both outcomes are wins')
    expect(lower).toContain('not selling')
    expect(lower).toContain('pick a time to talk')
  })

  it('forbids promising follow-up outreach', () => {
    expect(lower).toContain('never promise next steps')
  })

  it('forbids claims of knowing the prospect business', () => {
    expect(lower).toContain('never claim to understand their business')
  })

  it('grounds the agent in specific operational signal categories', () => {
    expect(lower).toContain('volume')
    expect(lower).toContain('current state')
    expect(lower).toContain('past attempts')
    expect(lower).toContain('objective')
  })

  it('does not carry the V1 multi-turn-anticipating "warm structured listener" framing', () => {
    expect(lower).not.toContain('warm, structured listener')
    expect(lower).not.toContain('reflect more than you ask')
    // Old V1 sample turns relied on opening with reflection ("Twelve
    // years is a long run in residential HVAC. What does..."). The V2
    // doctrine deliberately omits that reflective opener pattern.
    expect(lower).not.toContain('twelve years is a long run')
  })

  it('lists at least six concrete sample turns showing the right shape', () => {
    // Section heading appears exactly once, followed by sample dialogues.
    expect(CONVERSATION_SYSTEM_PROMPT).toContain('Sample turns')
    // Each sample is shaped Prospect:/You: — count the You: lines.
    const youLines = CONVERSATION_SYSTEM_PROMPT.match(/^You:/gm) ?? []
    expect(youLines.length).toBeGreaterThanOrEqual(6)
  })

  // Captain authors the sidestep doctrine paragraph (see PR #754 description,
  // Section A4). Until that lands, this assertion is skipped to prevent the
  // lint cycle from blocking on it.
  it.skip('codifies sidestep / non-answer handling (do not press, ask differently)', () => {
    // Look for the doctrine shape Captain will author. Either of these
    // phrases would satisfy: "do not press", "do not repeat", "ask
    // differently", "wind toward the booking".
    expect(lower).toMatch(/do not press|do not repeat|ask differently|wind toward/)
  })

  it('every sample "You:" line ends with a question', () => {
    // Extract sample turns: strip leading "You:", trim, then strip
    // surrounding quotes so the question-mark check sees the real
    // sentence terminator.
    const sampleYouLines = CONVERSATION_SYSTEM_PROMPT.split('\n')
      .filter((line) => line.startsWith('You:'))
      .map((line) => line.replace(/^You:\s*/, '').trim())
      .map((line) => line.replace(/^"|"$/g, ''))

    expect(sampleYouLines.length).toBeGreaterThan(0)
    for (const sample of sampleYouLines) {
      expect(
        sample.endsWith('?'),
        `Sample "You:" line should end with a question mark: ${JSON.stringify(sample)}`
      ).toBe(true)
    }
  })

  it('no sample "You:" line contains an em dash (we ban them)', () => {
    const sampleYouLines = CONVERSATION_SYSTEM_PROMPT.split('\n').filter((line) =>
      line.startsWith('You:')
    )
    for (const sample of sampleYouLines) {
      expect(sample, `Sample contains em dash: ${sample}`).not.toMatch(/[—]/)
    }
  })
})
