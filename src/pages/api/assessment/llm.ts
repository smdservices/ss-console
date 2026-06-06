/**
 * POST /api/assessment/llm  — OpenAI-compatible `/chat/completions` for the
 * ElevenLabs voice agent's custom LLM (ADR 0039 node [1], voice channel).
 *
 * ElevenLabs calls this with the conversation in OpenAI format; we inject our
 * interviewer system prompt and stream back Anthropic's reply translated to
 * OpenAI `chat.completion.chunk` SSE. The brain is our eval-proven operator.
 *
 * Auth: if ELEVENLABS_LLM_SECRET is configured, a matching `Authorization:
 * Bearer <secret>` is required (set the same secret on the agent's custom-LLM
 * config). If unset, the endpoint is open (dogfood default).
 */

import type { APIContext, APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import {
  streamInterviewerCompletion,
  type OpenAIChatMessage,
} from '../../../lib/claude/assessment-llm'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Normalize OpenAI content, which may arrive as a string OR an array of parts (ElevenLabs/OpenAI multimodal). */
function contentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'object' &&
        part !== null &&
        typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : ''
      )
      .join('')
  }
  return ''
}

/**
 * Lenient parse: coerce each message rather than rejecting the whole batch on a
 * single odd one (the agent may send array-content or empty placeholder turns).
 * Returns null only if there is no usable conversation at all.
 */
function parseMessages(body: unknown): OpenAIChatMessage[] | null {
  if (typeof body !== 'object' || body === null) return null
  const raw = (body as { messages?: unknown }).messages
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return null
  const messages: OpenAIChatMessage[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const role = (item as { role?: unknown }).role
    if (typeof role !== 'string') continue
    const content = contentToString((item as { content?: unknown }).content)
    if (content.length === 0) continue
    messages.push({ role, content })
  }
  return messages.length > 0 ? messages : null
}

export const POST: APIRoute = async ({ request }: APIContext) => {
  const expected = env.ELEVENLABS_LLM_SECRET
  if (expected) {
    const auth = request.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${expected}`) return json(401, { error: 'unauthorized' })
  }

  if (!env.ANTHROPIC_API_KEY) return json(503, { error: 'unavailable' })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'invalid json' })
  }

  const messages = parseMessages(body)
  if (messages === null) return json(400, { error: 'invalid messages' })

  // Diagnostic: metadata only (counts + roles), never content. Aids wrangler tail
  // while the voice channel is being stabilized.
  console.error(
    `[assessment-llm] in ${messages.length} msgs [${messages.map((m) => m.role).join(',')}]`
  )

  try {
    return await streamInterviewerCompletion(env.ANTHROPIC_API_KEY, messages, Date.now())
  } catch {
    // Always answer the custom-LLM caller in SSE shape, never JSON.
    return new Response('data: {"error":"upstream error"}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    })
  }
}
