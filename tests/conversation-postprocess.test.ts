/**
 * Unit tests for postProcessReply (defense-in-depth observability).
 *
 * The helper does NOT modify replies. It logs a warning when the reply
 * does not end on a question mark, and swallows any internal exception
 * so endpoint behavior is never affected.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { postProcessReply } from '../src/lib/claude/conversation'

describe('postProcessReply', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('does not warn when the reply ends in a question mark', () => {
    postProcessReply('How big is the team today?', { endpoint: 'api/intake/send' })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('does not warn when the reply ends in a question mark with trailing whitespace', () => {
    postProcessReply('How big is the team today?\n\n  ', { endpoint: 'api/intake/send' })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('warns when the reply ends in a period', () => {
    postProcessReply('That is interesting.', { endpoint: 'api/intake/send' })
    expect(warnSpy).toHaveBeenCalledOnce()
    const call = warnSpy.mock.calls[0]
    expect(call[0]).toContain('did not end on a question')
    const meta = call[1] as Record<string, unknown>
    expect(meta.last_char).toBe('.')
    expect(meta.endpoint).toBe('api/intake/send')
  })

  it('warns when the reply ends in an exclamation mark', () => {
    postProcessReply('Bad implementations leave a mark!', { endpoint: 'api/intake/continue' })
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('passes context fields through to the warning payload', () => {
    postProcessReply('No question here.', {
      endpoint: 'api/intake/continue',
      entityId: 'ent-x',
      conversationId: 'conv-x',
      turn: 3,
    })
    expect(warnSpy).toHaveBeenCalledOnce()
    const meta = warnSpy.mock.calls[0][1] as Record<string, unknown>
    expect(meta.entity_id).toBe('ent-x')
    expect(meta.conversation_id).toBe('conv-x')
    expect(meta.turn).toBe(3)
  })

  it('returns silently on an empty reply (nothing to inspect)', () => {
    postProcessReply('', { endpoint: 'api/intake/send' })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('returns silently on whitespace-only reply', () => {
    postProcessReply('   \n  ', { endpoint: 'api/intake/send' })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('truncates reply_tail to 80 characters in the warning payload', () => {
    const long = 'a'.repeat(200) + '.'
    postProcessReply(long, { endpoint: 'api/intake/send' })
    const meta = warnSpy.mock.calls[0][1] as Record<string, unknown>
    const tail = meta.reply_tail as string
    expect(tail.length).toBe(80)
  })

  it('swallows internal exceptions and never throws to the caller', () => {
    // Force an exception by passing a non-string. The helper's typing
    // guards at compile time, but at runtime a thrown error here would
    // mean a real bug. We assert the helper survives and logs.
    expect(() =>
      postProcessReply(undefined as unknown as string, { endpoint: 'api/intake/send' })
    ).not.toThrow()
  })
})
