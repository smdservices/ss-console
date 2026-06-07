/**
 * Claude client for the live web assessment loop (ADR 0039 nodes 1 + 2).
 *
 * Raw fetch against the Anthropic Messages API — same pattern as
 * `extract.ts`, no SDK, small Workers bundle. Node [1] runs the interview turn
 * by turn; node [2] drafts the findings from the completed transcript. Both use
 * the operator skill bodies as their system prompt (see `assessment/prompts.ts`).
 */

import {
  ASSESSMENT_COMPLETE_SENTINEL,
  FINDINGS_SYSTEM,
  INTERVIEWER_SYSTEM,
} from '../assessment/prompts'
import { ANTHROPIC_API_URL, ANTHROPIC_VERSION, QUALITY_MODEL } from '../llm/models'

/** A single visible exchange in the assessment. */
export interface Turn {
  readonly speaker: 'owner' | 'operator'
  readonly text: string
}

type ApiMessage = { role: 'user' | 'assistant'; content: string }

const MODEL = QUALITY_MODEL
const TURN_MAX_TOKENS = 1024
const FINDINGS_MAX_TOKENS = 4096

/** Seeds the first operator turn — the operator speaks first; this hidden user turn gives it something to answer. */
const KICKOFF =
  '[The business owner has just started the assessment. Begin with your warm opening.]'

/** Error from the Anthropic API or an unexpected response shape. */
export class AssessmentApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number
  ) {
    super(message)
    this.name = 'AssessmentApiError'
  }
}

async function callClaude(
  apiKey: string,
  system: string,
  messages: ApiMessage[],
  maxTokens: number
): Promise<string> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
  })

  if (!response.ok) {
    throw new AssessmentApiError(
      `Claude API returned ${response.status}: ${response.statusText}`,
      response.status
    )
  }

  const result: unknown = await response.json()
  const blocks = (result as { content?: Array<{ type: string; text?: string }> })?.content
  if (!Array.isArray(blocks)) throw new AssessmentApiError('Claude API returned no content')
  const text = blocks.find((b) => b.type === 'text')?.text
  if (!text) throw new AssessmentApiError('Claude API returned no text block')
  return text
}

/** Map the visible turns to the API message array. Always starts with the hidden kickoff user turn. */
export function toApiMessages(turns: ReadonlyArray<Turn>): ApiMessage[] {
  const messages: ApiMessage[] = [{ role: 'user', content: KICKOFF }]
  for (const t of turns) {
    messages.push({ role: t.speaker === 'operator' ? 'assistant' : 'user', content: t.text })
  }
  return messages
}

export interface AssessmentTurnResult {
  readonly message: string
  readonly done: boolean
}

/** Strip the completion sentinel and flag `done` — the pure half of `assessmentTurn`, unit-tested. */
export function parseOperatorReply(raw: string): AssessmentTurnResult {
  const done = raw.split('\n').some((line) => line.trim() === ASSESSMENT_COMPLETE_SENTINEL)
  const message = raw
    .split('\n')
    .filter((line) => line.trim() !== ASSESSMENT_COMPLETE_SENTINEL)
    .join('\n')
    .trim()
  return { message, done }
}

/**
 * Produce the operator's next message given the conversation so far.
 * `turns` is the visible history (empty for the opening). When the interviewer
 * judges the assessment complete it emits the sentinel; we strip it and flag `done`.
 */
export async function assessmentTurn(
  apiKey: string,
  turns: ReadonlyArray<Turn>
): Promise<AssessmentTurnResult> {
  const raw = await callClaude(apiKey, INTERVIEWER_SYSTEM, toApiMessages(turns), TURN_MAX_TOKENS)
  return parseOperatorReply(raw)
}

/** Render the visible turns as a transcript in the shape the findings skill grades against. */
export function buildTranscript(turns: ReadonlyArray<Turn>): string {
  return turns
    .map((t) => `**${t.speaker === 'operator' ? 'INTERVIEWER' : 'OWNER'}:** ${t.text}`)
    .join('\n\n')
}

/** Draft the evidence-bound findings (node [2]) from a completed assessment's turns. */
export async function draftFindings(apiKey: string, turns: ReadonlyArray<Turn>): Promise<string> {
  const transcript = buildTranscript(turns)
  const findings = await callClaude(
    apiKey,
    FINDINGS_SYSTEM,
    [{ role: 'user', content: transcript }],
    FINDINGS_MAX_TOKENS
  )
  return findings.trim()
}
