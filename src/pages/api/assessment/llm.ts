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

function parseMessages(body: unknown): OpenAIChatMessage[] | null {
  if (typeof body !== 'object' || body === null) return null
  const raw = (body as { messages?: unknown }).messages
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return null
  const messages: OpenAIChatMessage[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const role = (item as { role?: unknown }).role
    const content = (item as { content?: unknown }).content
    if (typeof role !== 'string') return null
    if (typeof content !== 'string') return null
    messages.push({ role, content })
  }
  return messages
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

  try {
    return await streamInterviewerCompletion(env.ANTHROPIC_API_KEY, messages)
  } catch {
    return json(502, { error: 'upstream error' })
  }
}
