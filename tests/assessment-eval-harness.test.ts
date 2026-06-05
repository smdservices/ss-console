/**
 * Network-free unit test for the assessment-eval harness.
 *
 * Covers the loop mechanics (termination, premature-DONE flag, error capture),
 * the PUBLIC/PRIVATE persona split (the grader's answer key must never reach the
 * owner prompt), and the run-log renderer — all with a scripted fake LlmClient,
 * so CI passes with no ANTHROPIC_API_KEY. The live path is exercised only by the
 * CLI, run manually.
 */

import { describe, expect, it } from 'vitest'
import {
  DONE_SENTINEL,
  buildOwnerSystem,
  containsDoneSentinel,
  parseFrontmatter,
  renderTranscriptMarkdown,
  runConversation,
  splitPublicPrivate,
  stripDoneSentinel,
  type LlmClient,
  type PersonaFixture,
  type Transcript,
} from '../operator/assessment-eval/index.js'

const CANARY = 'PRIVATE-CANARY-7f3'

/** Returns the queued responses in call order; falls back to 'ok'. */
function scriptedLlm(responses: string[]): LlmClient {
  let i = 0
  return { chat: () => Promise.resolve(responses[i++] ?? 'ok') }
}

/** Always returns the same text (never the DONE sentinel). */
function constantLlm(text: string): LlmClient {
  return { chat: () => Promise.resolve(text) }
}

const baseRun = {
  interviewerSystem: 'interviewer-system',
  ownerSystem: 'owner-system',
  personaId: 'p',
  interviewerId: 'assessment-interview' as const,
  model: 'test-model',
  startedAt: '2026-06-05T00:00:00.000Z',
}

describe('containsDoneSentinel', () => {
  it('matches the sentinel only on its own line', () => {
    expect(containsDoneSentinel(`closing playback\n${DONE_SENTINEL}`)).toBe(true)
  })

  it('ignores incidental or inline mentions', () => {
    expect(containsDoneSentinel('we are nearly done here')).toBe(false)
    expect(containsDoneSentinel(`see the ${DONE_SENTINEL} marker inline`)).toBe(false)
  })
})

describe('stripDoneSentinel', () => {
  it('removes the sentinel line and keeps the wrap-up', () => {
    expect(stripDoneSentinel(`Thanks, Ray.\n${DONE_SENTINEL}`)).toBe('Thanks, Ray.')
  })
})

describe('runConversation termination', () => {
  it('stops on the DONE sentinel and records done_signal (not premature past the floor)', async () => {
    const llm = scriptedLlm([
      'Q1',
      'A1',
      'Q2',
      'A2',
      'Q3',
      'A3',
      'Q4',
      'A4',
      'Q5',
      'A5',
      'Q6',
      'A6',
      `closing playback\n${DONE_SENTINEL}`,
    ])
    const t = await runConversation({ ...baseRun, llm })
    expect(t.termination).toBe('done_signal')
    expect(t.premature_done).toBe(false)
    expect(t.turns.at(-1)?.role).toBe('interviewer')
    expect(t.turns.at(-1)?.text).toBe('closing playback')
  })

  it('flags premature DONE before the minimum-turns floor', async () => {
    const t = await runConversation({
      ...baseRun,
      llm: scriptedLlm([`done early\n${DONE_SENTINEL}`]),
    })
    expect(t.termination).toBe('done_signal')
    expect(t.premature_done).toBe(true)
    expect(t.turns).toHaveLength(1)
  })

  it('stops at the max-turns cap when DONE never fires', async () => {
    const t = await runConversation({
      ...baseRun,
      llm: constantLlm('no sentinel in this reply'),
      maxTurns: 3,
    })
    expect(t.termination).toBe('max_turns')
    expect(t.turns).toHaveLength(6) // 3 exchanges x (interviewer + owner)
  })

  it('captures an LLM error as an error termination without throwing', async () => {
    const llm: LlmClient = { chat: () => Promise.reject(new Error('boom')) }
    const t = await runConversation({ ...baseRun, llm })
    expect(t.termination).toBe('error')
    expect(t.error).toContain('boom')
  })
})

describe('persona PUBLIC/PRIVATE split', () => {
  const body = [
    '<!-- PUBLIC -->',
    'You are Ray, owner of an HVAC shop.',
    '<!-- END PUBLIC -->',
    '<!-- PRIVATE -->',
    `grader answer key ${CANARY}`,
    '<!-- END PRIVATE -->',
  ].join('\n')

  it('separates the two blocks', () => {
    const { publicPrompt, groundTruth } = splitPublicPrivate(body)
    expect(publicPrompt).toContain('You are Ray')
    expect(groundTruth).toContain(CANARY)
  })

  it('never leaks the PRIVATE canary into the PUBLIC block', () => {
    expect(splitPublicPrivate(body).publicPrompt).not.toContain(CANARY)
  })

  it('throws when a block is missing', () => {
    expect(() => splitPublicPrivate('no markers at all')).toThrow()
  })
})

describe('parseFrontmatter', () => {
  it('reads top-level scalars and returns the body', () => {
    const { frontmatter, body } = parseFrontmatter(
      '---\npersona: rambler\nadversarial: true\n---\nhello'
    )
    expect(frontmatter['persona']).toBe('rambler')
    expect(body.trim()).toBe('hello')
  })
})

describe('buildOwnerSystem', () => {
  it('includes the public prompt and never the private ground truth', () => {
    const persona: PersonaFixture = {
      id: 'x',
      frontmatter: {},
      publicPrompt: 'You are Ray.',
      groundTruth: `secret ${CANARY}`,
    }
    const sys = buildOwnerSystem(persona)
    expect(sys).toContain('You are Ray.')
    expect(sys).not.toContain(CANARY)
  })
})

describe('renderTranscriptMarkdown', () => {
  it('renders the header, the loop-closed caveat, and the turns', () => {
    const transcript: Transcript = {
      persona_id: 'rambler',
      interviewer_id: 'null',
      model: 'm',
      started_at: 's',
      turns: [
        { role: 'interviewer', text: 'hi' },
        { role: 'owner', text: 'yo' },
      ],
      termination: 'done_signal',
      premature_done: false,
    }
    const md = renderTranscriptMarkdown(transcript)
    expect(md).toContain('# Assessment run — rambler — null')
    expect(md).toContain('**INTERVIEWER:** hi')
    expect(md).toContain('**OWNER:** yo')
    expect(md).toContain('loop CLOSED')
  })
})
