/**
 * Real Anthropic client for the assessment-eval harness.
 *
 * Raw fetch against the Messages API — no SDK — mirroring
 * src/lib/claude/extract.ts. This module is the ONLY place that imports
 * src/lib/llm/models.ts, and it is wired only by cli.ts. conversation.ts
 * never imports this file; it depends on the `LlmClient` interface in
 * types.ts, so the unit test injects a scripted fake and runs network-free.
 */

import { ANTHROPIC_API_URL, ANTHROPIC_VERSION } from '../../src/lib/llm/models.js'
import type { ChatRequest, LlmClient } from './types.js'

const DEFAULT_MAX_TOKENS = 1024
const DEFAULT_TEMPERATURE = 0.7

/** Thrown when the Anthropic API returns an unexpected response. */
export class AssessmentLlmError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message)
    this.name = 'AssessmentLlmError'
  }
}

/**
 * Build a live Anthropic-backed LlmClient bound to one model + key.
 * The dialogue agents run hot by default (temperature 0.7) for natural
 * variation; callers can override per request.
 */
export function createAnthropicClient(apiKey: string, model: string): LlmClient {
  return {
    async chat(request: ChatRequest): Promise<string> {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model,
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: request.temperature ?? DEFAULT_TEMPERATURE,
          system: request.system,
          messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '<unreadable>')
        throw new AssessmentLlmError(
          `Anthropic API returned ${response.status}: ${response.statusText}`,
          response.status,
          body
        )
      }

      const result: { content?: Array<{ type: string; text?: string }> } = await response.json()
      const blocks = result?.content
      if (!Array.isArray(blocks) || blocks.length === 0) {
        throw new AssessmentLlmError(
          'Anthropic API returned empty content',
          response.status,
          JSON.stringify(result)
        )
      }
      const textBlock = blocks.find((b) => b.type === 'text')
      if (!textBlock?.text) {
        throw new AssessmentLlmError(
          'Anthropic API response contained no text block',
          response.status,
          JSON.stringify(result)
        )
      }
      return textBlock.text
    },
  }
}
