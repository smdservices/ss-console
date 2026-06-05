/**
 * Assessment-eval harness — shared types.
 *
 * This harness GENERATES multi-turn assessment transcripts (an interviewer
 * LLM in conversation with a simulated owner LLM) so their caliber can be
 * judged. It does NOT grade them programmatically — grading is the
 * blind-subagent procedure in GRADING.md, against rubric.md. See README.md.
 *
 * Nothing here reads or writes external state; persistence lives in
 * run-writer.ts and the CLI. The `LlmClient` interface is the injection seam
 * that keeps conversation.ts network-free and unit-testable (a scripted fake
 * is substituted in tests; the real Anthropic client lives in llm.ts and is
 * wired only by cli.ts).
 */

/** Who is speaking in a recorded transcript turn. */
export type Role = 'interviewer' | 'owner'

/** Anthropic Messages API role for a single chat message. */
export type ChatRole = 'user' | 'assistant'

/** One message in a single model's conversation history. */
export interface ChatMessage {
  readonly role: ChatRole
  readonly content: string
}

/** One recorded line of the assessment transcript. */
export interface Turn {
  readonly role: Role
  readonly text: string
}

/** How a conversation ended. */
export type Termination = 'done_signal' | 'max_turns' | 'error'

/** Which interviewer skill drove the conversation. `null` is the negative control. */
export type InterviewerId = 'assessment-interview' | 'null'

/** Request shape for a single model turn. */
export interface ChatRequest {
  readonly system: string
  readonly messages: ReadonlyArray<ChatMessage>
  readonly maxTokens?: number
  readonly temperature?: number
}

/**
 * The injection seam. conversation.ts depends only on this interface, never
 * on llm.ts or models.ts — so the unit test injects a scripted fake and CI
 * passes with no ANTHROPIC_API_KEY.
 */
export interface LlmClient {
  chat(request: ChatRequest): Promise<string>
}

/** The product of one conversation run. */
export interface Transcript {
  readonly persona_id: string
  readonly interviewer_id: InterviewerId
  readonly model: string
  /** ISO 8601 UTC, stamped by the caller (never inside the loop — keeps it deterministic/testable). */
  readonly started_at: string
  readonly turns: ReadonlyArray<Turn>
  readonly termination: Termination
  /** true when the interviewer emitted DONE before the minimum-turns floor — a quality defect to surface. */
  readonly premature_done: boolean
  /** Present only when termination === 'error'. */
  readonly error?: string
}

/**
 * A loaded persona fixture. `publicPrompt` is what the owner-LLM sees;
 * `groundTruth` is the grader's answer key and is NEVER passed to the owner.
 */
export interface PersonaFixture {
  readonly id: string
  readonly frontmatter: Readonly<Record<string, string>>
  readonly publicPrompt: string
  readonly groundTruth: string
}
