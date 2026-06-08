/**
 * Integration tests for the POST handler of `/api/assessment/turn`, focused on
 * the hardening contract (2026-06-08 code review):
 *
 *   - The OPENING turn is served WITHOUT an LLM call. We prove this by running
 *     the opener with NO `ANTHROPIC_API_KEY` in env: it still returns 200 with
 *     a message and a freshly minted session token. If the opener reached the
 *     model it would 503 on the missing key. This is what closes the residual
 *     IP-rotation cost vector — POSTing empty `turns` costs zero LLM calls.
 *   - Continuing turns fail closed before any model call: a missing or invalid
 *     session token is rejected 401, never reaching `assessmentTurn`.
 *
 * The handler reads `env` from the `cloudflare:workers` stub; we inject a
 * signing key and an in-memory KV, and deliberately omit ANTHROPIC_API_KEY.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { env as testEnv } from 'cloudflare:workers'
import { POST } from '../../src/pages/api/assessment/turn'
import { verifyAssessmentSession } from '../../src/lib/assessment/session'
import { ASSESSMENT_OPENING_MESSAGE } from '../../src/lib/claude/assessment'

const TEST_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

function makeKv(): KVNamespace {
  const store = new Map<string, string>()
  return {
    async get(key: string) {
      return store.has(key) ? (store.get(key) as string) : null
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
  } as unknown as KVNamespace
}

async function post(body: unknown): Promise<Response> {
  const request = new Request('https://smd.services/api/assessment/turn', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST({
    request,
    clientAddress: '203.0.113.7',
  } as unknown as Parameters<typeof POST>[0])
}

/** Narrow a string field from a parsed JSON response without an unchecked cast. */
function strField(value: unknown, key: string): string | undefined {
  if (typeof value === 'object' && value !== null && key in value) {
    const v = (value as Record<string, unknown>)[key]
    return typeof v === 'string' ? v : undefined
  }
  return undefined
}

/** Narrow a boolean field from a parsed JSON response. */
function boolField(value: unknown, key: string): boolean {
  return (
    typeof value === 'object' && value !== null && (value as Record<string, unknown>)[key] === true
  )
}

beforeEach(() => {
  for (const k of Object.keys(testEnv)) delete (testEnv as unknown as Record<string, unknown>)[k]
  Object.assign(testEnv, {
    BOOKING_CACHE: makeKv(),
    ASSESSMENT_SESSION_SIGNING_KEY: TEST_KEY_BASE64,
    // ANTHROPIC_API_KEY intentionally ABSENT — the opener must not need it.
  })
})

afterEach(() => {
  for (const k of Object.keys(testEnv)) delete (testEnv as unknown as Record<string, unknown>)[k]
})

describe('opening turn (static, no LLM call)', () => {
  it('returns 200 with the fixed opening + a valid session even with no API key', async () => {
    const res = await post({ turns: [] })
    expect(res.status).toBe(200)

    const data: unknown = await res.json()
    expect(strField(data, 'message')).toBe(ASSESSMENT_OPENING_MESSAGE)
    expect(boolField(data, 'done')).toBe(false)
    const session = strField(data, 'session')
    expect(typeof session).toBe('string')

    // The minted session must verify under the signing key.
    const verified = await verifyAssessmentSession(session)
    expect(verified.ok).toBe(true)
  })
})

describe('continuing turn fails closed before any LLM call', () => {
  it('rejects a continuing turn with no session token (401)', async () => {
    const res = await post({ turns: [{ speaker: 'owner', text: 'We run an HVAC shop.' }] })
    expect(res.status).toBe(401)
    const data: unknown = await res.json()
    expect(strField(data, 'error')).toMatch(/session/i)
  })

  it('rejects a continuing turn with a forged session token (401)', async () => {
    const res = await post({
      turns: [{ speaker: 'owner', text: 'We run an HVAC shop.' }],
      session: 'forged.token',
    })
    expect(res.status).toBe(401)
  })
})

describe('basic request validation still holds', () => {
  it('rejects a malformed body (400)', async () => {
    const res = await post({ turns: 'nope' })
    expect(res.status).toBe(400)
  })
})
