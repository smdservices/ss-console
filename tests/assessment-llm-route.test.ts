/**
 * Route-handler tests for POST /api/assessment/llm — the (public) ElevenLabs
 * custom-LLM proxy. These cover the auth/guard behavior, NOT the OpenAI↔Anthropic
 * translation (that's tests/assessment-voice-llm.test.ts).
 *
 * The critical property: the route is FAIL-CLOSED. With ELEVENLABS_LLM_SECRET
 * unset it must 503, never proxy Anthropic open (2026-06-30 code-review C1).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest'
import { env as testEnv } from 'cloudflare:workers'

// Mock only the streaming call so the happy path never hits Anthropic; keep the
// real transform exports the route/type-imports rely on.
vi.mock('../src/lib/claude/assessment-llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/claude/assessment-llm')>()
  return {
    ...actual,
    streamInterviewerCompletion: vi.fn(
      async () =>
        new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        })
    ),
  }
})

import { POST } from '../src/pages/api/assessment/llm'
import { streamInterviewerCompletion } from '../src/lib/claude/assessment-llm'

const SECRET = 'test-elevenlabs-secret'

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://smd.services/api/assessment/llm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function call(request: Request): Promise<Response> {
  // The handler only reads `request` off the context.
  return (POST as unknown as (ctx: { request: Request }) => Promise<Response>)({ request })
}

const validBody = { messages: [{ role: 'user', content: 'hello' }] }

beforeEach(() => {
  for (const k of Object.keys(testEnv)) delete (testEnv as unknown as Record<string, unknown>)[k]
  vi.clearAllMocks()
})

describe('POST /api/assessment/llm — fail-closed auth', () => {
  it('returns 503 when ELEVENLABS_LLM_SECRET is unset (never serves open)', async () => {
    Object.assign(testEnv, { ANTHROPIC_API_KEY: 'sk-present' }) // key present, secret absent
    const res = await call(req(validBody, { authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(503)
    expect(streamInterviewerCompletion).not.toHaveBeenCalled()
  })

  it('returns 401 when the secret is set but the bearer is missing', async () => {
    Object.assign(testEnv, { ELEVENLABS_LLM_SECRET: SECRET, ANTHROPIC_API_KEY: 'sk-present' })
    const res = await call(req(validBody))
    expect(res.status).toBe(401)
    expect(streamInterviewerCompletion).not.toHaveBeenCalled()
  })

  it('returns 401 when the bearer does not match', async () => {
    Object.assign(testEnv, { ELEVENLABS_LLM_SECRET: SECRET, ANTHROPIC_API_KEY: 'sk-present' })
    const res = await call(req(validBody, { authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    expect(streamInterviewerCompletion).not.toHaveBeenCalled()
  })

  it('returns 503 when ANTHROPIC_API_KEY is missing even with a valid bearer', async () => {
    Object.assign(testEnv, { ELEVENLABS_LLM_SECRET: SECRET }) // no ANTHROPIC_API_KEY
    const res = await call(req(validBody, { authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(503)
    expect(streamInterviewerCompletion).not.toHaveBeenCalled()
  })
})

describe('POST /api/assessment/llm — authenticated request handling', () => {
  beforeEach(() => {
    Object.assign(testEnv, { ELEVENLABS_LLM_SECRET: SECRET, ANTHROPIC_API_KEY: 'sk-present' })
  })

  it('streams a 200 for a valid, authenticated request', async () => {
    const res = await call(req(validBody, { authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(streamInterviewerCompletion).toHaveBeenCalledTimes(1)
  })

  it('returns 400 on invalid JSON', async () => {
    const res = await call(req('not json{', { authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when there is no usable conversation', async () => {
    const res = await call(req({ messages: [] }, { authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when a single message exceeds the size cap (8KB)', async () => {
    const oversized = { messages: [{ role: 'user', content: 'x'.repeat(8_001) }] }
    const res = await call(req(oversized, { authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(400)
    expect(streamInterviewerCompletion).not.toHaveBeenCalled()
  })

  it('returns 400 when total content exceeds the batch cap (64KB)', async () => {
    // 10 messages × ~6.5KB each = ~65KB total, each under the 8KB per-message cap.
    const messages = Array.from({ length: 10 }, () => ({
      role: 'user',
      content: 'y'.repeat(6_500),
    }))
    const res = await call(req({ messages }, { authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(400)
    expect(streamInterviewerCompletion).not.toHaveBeenCalled()
  })
})
