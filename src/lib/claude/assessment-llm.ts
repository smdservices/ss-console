/**
 * OpenAI-compatible custom-LLM bridge for the ElevenLabs voice agent
 * (ADR 0039 node [1], voice channel). ElevenLabs calls a `/chat/completions`
 * endpoint on us; we inject OUR interviewer system prompt (the same skill body
 * the typed loop and the eval harness use) and proxy to Anthropic, translating
 * the Anthropic SSE stream into OpenAI `chat.completion.chunk` SSE so the voice
 * agent's brain is our eval-proven operator, not a model in their dashboard.
 */

import { INTERVIEWER_SYSTEM } from '../assessment/prompts'
import { ANTHROPIC_API_URL, ANTHROPIC_VERSION, QUALITY_MODEL } from '../llm/models'

export interface OpenAIChatMessage {
  /** OpenAI role; validated against system/user/assistant at the route + here. */
  role: string
  content: string
}

const MAX_TOKENS = 1024
const OPENAI_MODEL_LABEL = 'smd-assessment-interviewer'

/**
 * Appended to the interviewer system prompt for the voice channel: the reply is
 * spoken aloud, so it must stay short and must never voice the typed-mode
 * completion marker or any markdown/symbols. The voice session ends on the
 * owner's action, not a sentinel.
 */
const VOICE_ADDENDUM = `

--- VOICE MODE ---
You are speaking aloud to the owner over a live voice call. Keep every reply short and natural for speech — a sentence or two, one question at a time. Never say, spell, or output any completion marker, a line of equals signs, or "===ASSESSMENT-COMPLETE===". When you have covered the ground, give a brief, warm spoken wrap-up and stop. Never read markdown, symbols, or formatting aloud.`

/**
 * Split incoming OpenAI messages into the Anthropic shape: our interviewer
 * prompt is the authoritative system; any system text ElevenLabs injects is
 * appended after it; user/assistant turns become the message list. Anthropic
 * requires the first message to be `user`, so a leading assistant turn is
 * given a minimal user kickoff.
 */
export function toAnthropicRequest(messages: ReadonlyArray<OpenAIChatMessage>): {
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
} {
  const extraSystem = messages
    .filter((m) => m.role === 'system' && typeof m.content === 'string')
    .map((m) => m.content)
    .join('\n\n')
  const base = extraSystem ? `${INTERVIEWER_SYSTEM}\n\n${extraSystem}` : INTERVIEWER_SYSTEM
  const system = base + VOICE_ADDENDUM

  const turns = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content ?? '') }))

  if (turns.length === 0 || turns[0]?.role !== 'user') {
    turns.unshift({ role: 'user', content: '[The business owner has joined the call.]' })
  }
  return { system, messages: turns }
}

function sseChunk(delta: { role?: string; content?: string }, finish: string | null): string {
  const payload = {
    id: 'chatcmpl-assessment',
    object: 'chat.completion.chunk',
    model: OPENAI_MODEL_LABEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
  }
  return `data: ${JSON.stringify(payload)}\n\n`
}

/** Extract the text out of one Anthropic SSE `data:` line, or null if it carries no text. */
function textFromAnthropicEvent(jsonLine: string): string | null {
  try {
    const evt: unknown = JSON.parse(jsonLine)
    if (
      typeof evt === 'object' &&
      evt !== null &&
      (evt as { type?: unknown }).type === 'content_block_delta'
    ) {
      const delta = (evt as { delta?: { type?: string; text?: string } }).delta
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') return delta.text
    }
  } catch {
    // ignore non-JSON keepalive lines
  }
  return null
}

/**
 * Call Anthropic with streaming and return an OpenAI-compatible SSE Response.
 * Throws (caller maps to an error response) only on the initial connect; once
 * the stream is open, transport errors end the stream cleanly.
 */
export async function streamInterviewerCompletion(
  apiKey: string,
  messages: ReadonlyArray<OpenAIChatMessage>
): Promise<Response> {
  const { system, messages: anthropicMessages } = toAnthropicRequest(messages)

  const upstream = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: QUALITY_MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: anthropicMessages,
      stream: true,
    }),
  })

  if (!upstream.ok || !upstream.body) {
    throw new Error(`Anthropic stream failed: ${upstream.status}`)
  }

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseChunk({ role: 'assistant', content: '' }, null)))
    },
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) {
        controller.enqueue(encoder.encode(sseChunk({}, 'stop')))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
        return
      }
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const text = textFromAnthropicEvent(trimmed.slice(5).trim())
        if (text) controller.enqueue(encoder.encode(sseChunk({ content: text }, null)))
      }
    },
    cancel() {
      void reader.cancel()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}
