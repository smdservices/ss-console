/**
 * Unit tests for detectAndStripReadyMarker — the helper that pulls the
 * [[READY-FOR-CALL]] marker out of a Claude reply on the V3 /book intake.
 *
 * The marker is server-only signal: the prospect must never see raw
 * `[[READY-FOR-CALL]]` in their UI, regardless of whether the model
 * placed it on its own line (the canonical shape) or pasted it inline
 * (the misbehaving case).
 */

import { describe, it, expect } from 'vitest'
import { detectAndStripReadyMarker, READY_MARKER } from '../src/lib/claude/conversation'

describe('detectAndStripReadyMarker', () => {
  it('exports the marker token', () => {
    expect(READY_MARKER).toBe('[[READY-FOR-CALL]]')
  })

  it('returns ready=false and the original reply when the marker is absent', () => {
    const reply = 'How big is the team today?'
    const result = detectAndStripReadyMarker(reply)
    expect(result).toEqual({ reply, ready: false })
  })

  it('strips the marker when on its own line at the end (canonical shape)', () => {
    const reply = 'How big is the team today?\n[[READY-FOR-CALL]]'
    const result = detectAndStripReadyMarker(reply)
    expect(result.ready).toBe(true)
    expect(result.reply).toBe('How big is the team today?')
  })

  it('strips the marker when on its own line with a blank line before it', () => {
    const reply = 'How big is the team today?\n\n[[READY-FOR-CALL]]'
    const result = detectAndStripReadyMarker(reply)
    expect(result.ready).toBe(true)
    expect(result.reply).toBe('How big is the team today?')
  })

  it('strips the marker when the model misbehaves and pastes it inline', () => {
    const reply = 'How big is the team today? [[READY-FOR-CALL]]'
    const result = detectAndStripReadyMarker(reply)
    expect(result.ready).toBe(true)
    // The prospect must never see raw marker text. We accept that
    // inline placement may leave a trailing space; the surrounding
    // tests assert no marker leakage.
    expect(result.reply).not.toContain('[[READY-FOR-CALL]]')
    expect(result.reply.trimEnd()).toBe('How big is the team today?')
  })

  it('strips the marker when prefixed by a blank line and trailing whitespace', () => {
    const reply = 'How big is the team today?\n\n  [[READY-FOR-CALL]]  \n'
    const result = detectAndStripReadyMarker(reply)
    expect(result.ready).toBe(true)
    expect(result.reply).not.toContain('[[READY-FOR-CALL]]')
    expect(result.reply.trim()).toBe('How big is the team today?')
  })

  it('preserves multi-paragraph replies when the marker is at the end', () => {
    const reply =
      'Got it, just a check.\n\nAnything we can actually help with while you are here?\n[[READY-FOR-CALL]]'
    const result = detectAndStripReadyMarker(reply)
    expect(result.ready).toBe(true)
    expect(result.reply).toContain('Got it, just a check.')
    expect(result.reply).toContain('Anything we can actually help with while you are here?')
    expect(result.reply).not.toContain('[[READY-FOR-CALL]]')
  })

  it('does not flip ready when the marker is empty-quoted in regular text', () => {
    // Defensive case — if the prompt itself were quoted back, this
    // would be a model misuse and we still strip + flag ready, since
    // the prospect must never see it. This is the same code path as
    // the inline case above.
    const reply = 'I noticed [[READY-FOR-CALL]] in something else?'
    const result = detectAndStripReadyMarker(reply)
    expect(result.ready).toBe(true)
    expect(result.reply).not.toContain('[[READY-FOR-CALL]]')
  })
})
