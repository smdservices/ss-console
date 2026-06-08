/**
 * Unit tests for the `/api/assessment/turn` request validator
 * (`parseTurnRequest`). The endpoint is public and takes ad traffic, so the
 * validator must reject every malformed body before any work happens — and it
 * must parse, never cast (CLAUDE.md coding standard). It also now narrows the
 * optional signed `session` token that gates continuing turns.
 */

import { describe, expect, it } from 'vitest'
import { parseTurnRequest } from '../../src/pages/api/assessment/turn'

const validTurn = { speaker: 'owner', text: 'We run an HVAC shop.' }

describe('parseTurnRequest — turns array', () => {
  it('accepts an empty turns array (the opening request)', () => {
    const parsed = parseTurnRequest({ turns: [] })
    expect(parsed).not.toBeNull()
    expect(parsed?.turns).toEqual([])
    expect(parsed?.session).toBeNull()
  })

  it('accepts a well-formed turns array', () => {
    const parsed = parseTurnRequest({
      turns: [
        { speaker: 'operator', text: 'Tell me about the business.' },
        { speaker: 'owner', text: 'HVAC.' },
      ],
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.turns).toHaveLength(2)
  })

  it('rejects a non-object body', () => {
    for (const bad of [null, undefined, 'string', 42, []]) {
      // arrays have no `turns` property → null
      expect(parseTurnRequest(bad as unknown)).toBeNull()
    }
  })

  it('rejects a missing or non-array turns field', () => {
    expect(parseTurnRequest({})).toBeNull()
    expect(parseTurnRequest({ turns: 'nope' })).toBeNull()
    expect(parseTurnRequest({ turns: 5 })).toBeNull()
  })

  it('rejects a turns array longer than the cap', () => {
    const tooMany = Array.from({ length: 61 }, () => validTurn)
    expect(parseTurnRequest({ turns: tooMany })).toBeNull()
  })

  it('rejects an invalid speaker', () => {
    expect(parseTurnRequest({ turns: [{ speaker: 'robot', text: 'hi' }] })).toBeNull()
    expect(parseTurnRequest({ turns: [{ text: 'hi' }] })).toBeNull()
  })

  it('rejects empty, missing, non-string, or over-long text', () => {
    expect(parseTurnRequest({ turns: [{ speaker: 'owner', text: '' }] })).toBeNull()
    expect(parseTurnRequest({ turns: [{ speaker: 'owner' }] })).toBeNull()
    expect(parseTurnRequest({ turns: [{ speaker: 'owner', text: 123 }] })).toBeNull()
    const long = 'x'.repeat(4001)
    expect(parseTurnRequest({ turns: [{ speaker: 'owner', text: long }] })).toBeNull()
  })

  it('accepts text exactly at the length boundary', () => {
    const atLimit = 'x'.repeat(4000)
    const parsed = parseTurnRequest({ turns: [{ speaker: 'owner', text: atLimit }] })
    expect(parsed).not.toBeNull()
  })

  it('rejects a non-object turn item', () => {
    expect(parseTurnRequest({ turns: ['nope'] })).toBeNull()
    expect(parseTurnRequest({ turns: [null] })).toBeNull()
  })
})

describe('parseTurnRequest — session token', () => {
  it('treats an absent session as null (opening request)', () => {
    const parsed = parseTurnRequest({ turns: [validTurn] })
    expect(parsed?.session).toBeNull()
  })

  it('treats an explicit null session as null', () => {
    const parsed = parseTurnRequest({ turns: [validTurn], session: null })
    expect(parsed?.session).toBeNull()
  })

  it('accepts a non-empty string session token', () => {
    const parsed = parseTurnRequest({ turns: [validTurn], session: 'payload.sig' })
    expect(parsed?.session).toBe('payload.sig')
  })

  it('rejects an empty-string session token', () => {
    expect(parseTurnRequest({ turns: [validTurn], session: '' })).toBeNull()
  })

  it('rejects a non-string session token', () => {
    expect(parseTurnRequest({ turns: [validTurn], session: 42 })).toBeNull()
    expect(parseTurnRequest({ turns: [validTurn], session: { tok: 'x' } })).toBeNull()
  })
})
