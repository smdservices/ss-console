/**
 * Tests for the ElevenLabs custom-LLM bridge (ADR 0039 node [1], voice).
 * Network-free: covers the OpenAI -> Anthropic translation — our interviewer
 * prompt is the authoritative system, turns are filtered to user/assistant,
 * and Anthropic's user-first requirement is enforced.
 */

import { describe, expect, it } from 'vitest'
import { toAnthropicRequest } from '../src/lib/claude/assessment-llm'
import { INTERVIEWER_SYSTEM } from '../src/lib/assessment/prompts'

describe('toAnthropicRequest', () => {
  it('uses the interviewer skill as the authoritative system prompt', () => {
    const { system } = toAnthropicRequest([{ role: 'user', content: 'hi' }])
    expect(system).toBe(INTERVIEWER_SYSTEM)
    expect(system).toContain('operations consultant')
  })

  it('appends any system text ElevenLabs injects after ours', () => {
    const { system } = toAnthropicRequest([
      { role: 'system', content: 'DYNAMIC_VAR=abc' },
      { role: 'user', content: 'hi' },
    ])
    expect(system.startsWith(INTERVIEWER_SYSTEM)).toBe(true)
    expect(system).toContain('DYNAMIC_VAR=abc')
  })

  it('keeps only user/assistant turns, in order', () => {
    const { messages } = toAnthropicRequest([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
    ])
    expect(messages).toEqual([
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
    ])
  })

  it('forces a user-first message when the turns start with assistant', () => {
    const { messages } = toAnthropicRequest([{ role: 'assistant', content: 'greeting' }])
    expect(messages[0]?.role).toBe('user')
    expect(messages[1]).toEqual({ role: 'assistant', content: 'greeting' })
  })

  it('produces a user kickoff when no turns are present', () => {
    const { messages } = toAnthropicRequest([{ role: 'system', content: 's' }])
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe('user')
  })
})
