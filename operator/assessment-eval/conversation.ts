/**
 * The two-agent conversation loop.
 *
 * Runs an interviewer LLM against a simulated-owner LLM to completion and
 * returns the recorded transcript. Each model has its OWN system prompt and
 * its OWN history: the other model's utterances appear as `user`, its own as
 * `assistant` — the only correct way to run a two-agent dialogue over the
 * single-turn Messages API.
 *
 * Termination has two independent stops, both required:
 *   1. The interviewer emits the DONE sentinel on its own line (its skill
 *      decides when coverage is sufficient — runtime-agnostic, see SKILL.md).
 *   2. A hard MAX_TURNS cap as a non-negotiable backstop.
 *
 * The DONE sentinel is harness scaffolding, NOT skill logic — documented as
 * such so the same SKILL.md transfers to a different runtime (e.g. Hermes).
 *
 * This module imports no network code; it depends only on the LlmClient
 * interface, so it is fully unit-testable with a scripted fake.
 */

import type { ChatMessage, InterviewerId, LlmClient, Transcript, Turn } from './types.js'

/** Hard backstop on interviewer↔owner exchanges. */
export const MAX_TURNS = 24
/** DONE before this many exchanges is flagged as a premature-completion defect. */
export const MIN_TURNS_BEFORE_DONE = 6
/** Exact-line sentinel the interviewer emits to end the assessment. */
export const DONE_SENTINEL = '===ASSESSMENT-COMPLETE==='
/** Seed message so the interviewer (which speaks first) has a user turn to answer. */
const KICKOFF =
  '[The business owner has just joined the call. Begin the assessment with your opening.]'

/** True only if a whole line equals the sentinel (avoids false stops on incidental mentions). */
export function containsDoneSentinel(text: string): boolean {
  return text.split('\n').some((line) => line.trim() === DONE_SENTINEL)
}

/** Remove the sentinel line(s) so the recorded transcript reads cleanly. */
export function stripDoneSentinel(text: string): string {
  return text
    .split('\n')
    .filter((line) => line.trim() !== DONE_SENTINEL)
    .join('\n')
    .trim()
}

export interface RunConversationOptions {
  readonly llm: LlmClient
  readonly interviewerSystem: string
  readonly ownerSystem: string
  readonly personaId: string
  readonly interviewerId: InterviewerId
  readonly model: string
  /** ISO 8601 UTC, stamped by the caller. */
  readonly startedAt: string
  readonly maxTurns?: number
}

/** Run the dialogue to termination and return the transcript. Never throws on LLM error — records it. */
export async function runConversation(opts: RunConversationOptions): Promise<Transcript> {
  const maxTurns = opts.maxTurns ?? MAX_TURNS
  const turns: Turn[] = []
  const interviewerHistory: ChatMessage[] = [{ role: 'user', content: KICKOFF }]
  const ownerHistory: ChatMessage[] = []
  let exchanges = 0
  let termination: Transcript['termination'] = 'max_turns'
  let prematureDone = false
  let errorMessage: string | undefined

  try {
    while (exchanges < maxTurns) {
      const interviewerRaw = await opts.llm.chat({
        system: opts.interviewerSystem,
        messages: interviewerHistory,
      })
      const done = containsDoneSentinel(interviewerRaw)
      const interviewerText = stripDoneSentinel(interviewerRaw)
      if (interviewerText.length > 0) turns.push({ role: 'interviewer', text: interviewerText })
      interviewerHistory.push({ role: 'assistant', content: interviewerRaw })
      ownerHistory.push({
        role: 'user',
        content: interviewerText.length > 0 ? interviewerText : interviewerRaw,
      })

      if (done) {
        termination = 'done_signal'
        prematureDone = exchanges < MIN_TURNS_BEFORE_DONE
        break
      }

      const ownerText = await opts.llm.chat({ system: opts.ownerSystem, messages: ownerHistory })
      turns.push({ role: 'owner', text: ownerText })
      ownerHistory.push({ role: 'assistant', content: ownerText })
      interviewerHistory.push({ role: 'user', content: ownerText })
      exchanges += 1
    }
  } catch (err: unknown) {
    termination = 'error'
    errorMessage = err instanceof Error ? err.message : String(err)
  }

  return {
    persona_id: opts.personaId,
    interviewer_id: opts.interviewerId,
    model: opts.model,
    started_at: opts.startedAt,
    turns,
    termination,
    premature_done: prematureDone,
    ...(errorMessage !== undefined ? { error: errorMessage } : {}),
  }
}
