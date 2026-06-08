/**
 * Wiring tests for the web assessment loop (ADR 0039 nodes 1 + 2).
 *
 * Network-free assertions prove the plumbing: that the operator skill BODIES
 * loaded into the system prompts via `?raw` (single source of truth), the turn
 * protocol alternates correctly, the completion sentinel is detected/stripped,
 * and the transcript is shaped the way the findings skill grades against.
 *
 * One LIVE smoke test makes a real opening call; it is skipped unless
 * ANTHROPIC_API_KEY is present, so CI stays green and `infisical run -- npx
 * vitest` exercises the real loop on demand.
 */

import { describe, expect, it } from 'vitest'
import { FINDINGS_SYSTEM, INTERVIEWER_SYSTEM } from '../src/lib/assessment/prompts'
import {
  assessmentOpening,
  assessmentTurn,
  ASSESSMENT_OPENING_MESSAGE,
  buildTranscript,
  parseOperatorReply,
  toApiMessages,
  type Turn,
} from '../src/lib/claude/assessment'
import { ASSESSMENT_COMPLETE_SENTINEL } from '../src/lib/assessment/prompts'

describe('skill bodies load into the prompts (?raw single source of truth)', () => {
  it('interviewer prompt carries the interview skill and BOTH references', () => {
    // from SKILL.md, coverage-model.md, probe-repertoire.md respectively
    expect(INTERVIEWER_SYSTEM).toContain('operations consultant')
    expect(INTERVIEWER_SYSTEM).toContain('five observation domains')
    expect(INTERVIEWER_SYSTEM).toContain('Probe repertoire')
    expect(INTERVIEWER_SYSTEM).toContain('===ASSESSMENT-COMPLETE===')
  })

  it('findings prompt carries the findings skill and BOTH references', () => {
    expect(FINDINGS_SYSTEM).toContain('X-ray, not the read')
    expect(FINDINGS_SYSTEM).toContain('observation domains')
    expect(FINDINGS_SYSTEM).toContain('no-dollarize')
  })
})

describe('turn protocol', () => {
  it('always seeds the hidden kickoff user turn first', () => {
    const msgs = toApiMessages([])
    expect(msgs[0]?.role).toBe('user')
    expect(msgs).toHaveLength(1)
  })

  it('maps operator->assistant and owner->user, preserving alternation', () => {
    const turns: Turn[] = [
      { speaker: 'operator', text: 'Hi, tell me about the business.' },
      { speaker: 'owner', text: 'We do HVAC.' },
    ]
    const msgs = toApiMessages(turns)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(msgs[1]?.content).toContain('tell me about the business') // operator turn
    expect(msgs[2]?.content).toContain('HVAC') // owner turn
  })
})

describe('static opening (no LLM call — closes the IP-rotation opener cost vector)', () => {
  it('returns the fixed opening message and is never done', () => {
    const result = assessmentOpening()
    expect(result.message).toBe(ASSESSMENT_OPENING_MESSAGE)
    expect(result.message.length).toBeGreaterThan(20)
    expect(result.done).toBe(false)
  })

  it('never leaks the completion sentinel in the opening copy', () => {
    expect(ASSESSMENT_OPENING_MESSAGE).not.toContain(ASSESSMENT_COMPLETE_SENTINEL)
  })

  it('opening copy carries no em dash (shipped user-facing string)', () => {
    expect(ASSESSMENT_OPENING_MESSAGE).not.toContain('—')
  })
})

describe('completion sentinel', () => {
  it('detects the sentinel on its own line and strips it from the message', () => {
    const parsed = parseOperatorReply('Thanks, that is everything.\n===ASSESSMENT-COMPLETE===')
    expect(parsed.done).toBe(true)
    expect(parsed.message).toBe('Thanks, that is everything.')
  })

  it('does not complete on a normal turn', () => {
    const parsed = parseOperatorReply('And how do new leads come in?')
    expect(parsed.done).toBe(false)
    expect(parsed.message).toBe('And how do new leads come in?')
  })
})

describe('transcript shape (what the findings skill grades against)', () => {
  it('renders INTERVIEWER/OWNER lines', () => {
    const t = buildTranscript([
      { speaker: 'operator', text: 'Q1' },
      { speaker: 'owner', text: 'A1' },
    ])
    expect(t).toBe('**INTERVIEWER:** Q1\n\n**OWNER:** A1')
  })
})

const LIVE = process.env['ANTHROPIC_API_KEY']
describe.skipIf(!LIVE)('LIVE smoke (real model, requires ANTHROPIC_API_KEY)', () => {
  it('produces a non-empty opening that does not prematurely complete', async () => {
    const result = await assessmentTurn(LIVE as string, [])
    expect(result.message.length).toBeGreaterThan(20)
    expect(result.done).toBe(false)
  }, 30000)
})
