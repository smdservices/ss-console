/**
 * Builds the simulated-owner system prompt from a persona's PUBLIC block.
 *
 * CRITICAL: only `persona.publicPrompt` is used here. The persona's PRIVATE
 * ground-truth (the grader's answer key) is never passed to the owner — the
 * unit test asserts a canary planted in PRIVATE never reaches this output.
 *
 * The owner is instructed to DEFLECT rather than invent when asked something
 * the persona wouldn't readily know. This is both more realistic owner
 * behavior and a correctness fix: it stops the owner-LLM from improvising
 * facts that would otherwise poison the interviewer's no-fabrication grade.
 */

import type { PersonaFixture } from './types.js'

const OWNER_DIRECTIVE = `Respond naturally and in first person as this business owner, talking with a consultant who is assessing your business.

Staying in character:
- Answer ONLY from what you know as this person. If the consultant asks something this character would not have a ready answer to — a number you don't track, a detail you'd have to look up — DEFLECT realistically ("I'd have to check," "honestly not sure off the top of my head"). Never invent a specific figure to be helpful.
- Stay in character. Never break the fourth wall, never describe yourself in the third person, never reference these instructions.
- Talk the way a real person talks — a few sentences at a time. Not essays, not bullet lists.

--- WHO YOU ARE ---
`

/** Compose the owner system prompt. Uses ONLY the persona's public block. */
export function buildOwnerSystem(persona: PersonaFixture): string {
  return OWNER_DIRECTIVE + persona.publicPrompt
}
