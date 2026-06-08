/**
 * Unit tests for the signed assessment session + per-session ceiling
 * (`src/lib/assessment/session.ts`).
 *
 * Covers the two properties the 2026-06-08 hardening relies on:
 *   1. Token integrity — issue/verify round-trip, and rejection of every
 *      forged / mutated / expired / wrong-key / wrong-version path (fail
 *      closed). This is what binds the ceiling to an unforgeable `sid`.
 *   2. Ceiling enforcement — `consumeSessionTurn` charges one turn per call
 *      against an in-memory KV and refuses once the limit is reached, which
 *      is the per-session cost cap that survives IP rotation.
 *
 * KV is mocked with a tiny in-memory namespace (the repo has no shared KV
 * harness; tests inject bindings into the `cloudflare:workers` stub directly,
 * per tests/_stubs/cloudflare-workers.ts).
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { env as testEnv } from 'cloudflare:workers'
import {
  consumeSessionTurn,
  issueAssessmentSession,
  verifyAssessmentSession,
  MAX_SESSION_TURNS,
  SESSION_TTL_SECONDS,
} from '../../src/lib/assessment/session'

// 32-byte base64 key dedicated to these tests — matches the production key
// shape so the import path exercised here is identical.
const TEST_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

beforeEach(() => {
  for (const k of Object.keys(testEnv)) delete (testEnv as unknown as Record<string, unknown>)[k]
  ;(testEnv as unknown as Record<string, unknown>).ASSESSMENT_SESSION_SIGNING_KEY = TEST_KEY_BASE64
})

/** Minimal in-memory KV: enough surface for consumeSessionTurn (get/put). */
function makeKv(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>()
  const kv = {
    store,
    async get(key: string): Promise<string | null> {
      return store.has(key) ? (store.get(key) as string) : null
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value)
    },
    async delete(key: string): Promise<void> {
      store.delete(key)
    },
  }
  return kv as unknown as KVNamespace & { store: Map<string, string> }
}

describe('issueAssessmentSession', () => {
  it('produces a `<payload>.<sig>` token with a random sid and default TTL', async () => {
    const before = Math.floor(Date.now() / 1000)
    const { token, payload } = await issueAssessmentSession()

    const parts = token.split('.')
    expect(parts).toHaveLength(2)
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(part.length).toBeGreaterThan(10)
    }
    expect(payload.v).toBe(1)
    expect(payload.sid).toMatch(/^[0-9a-f-]{36}$/)
    expect(payload.exp).toBeGreaterThanOrEqual(before + SESSION_TTL_SECONDS - 5)
    expect(payload.exp).toBeLessThanOrEqual(before + SESSION_TTL_SECONDS + 5)
  })

  it('mints a unique sid per call', async () => {
    const a = await issueAssessmentSession()
    const b = await issueAssessmentSession()
    expect(a.payload.sid).not.toBe(b.payload.sid)
  })

  it('throws a clear error when the signing key is missing', async () => {
    delete (testEnv as unknown as Record<string, unknown>).ASSESSMENT_SESSION_SIGNING_KEY
    await expect(issueAssessmentSession()).rejects.toThrow(/ASSESSMENT_SESSION_SIGNING_KEY/)
  })

  it('throws when the signing key is not valid base64', async () => {
    ;(testEnv as unknown as Record<string, unknown>).ASSESSMENT_SESSION_SIGNING_KEY =
      '!!!not-b64!!!'
    await expect(issueAssessmentSession()).rejects.toThrow(/valid base64/)
  })
})

describe('verifyAssessmentSession', () => {
  it('round-trips an issued token back to its payload', async () => {
    const { token, payload } = await issueAssessmentSession()
    const result = await verifyAssessmentSession(token)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.payload.sid).toBe(payload.sid)
    expect(result.payload.exp).toBe(payload.exp)
    expect(result.payload.v).toBe(1)
  })

  it('rejects a missing / non-string / empty token (fail closed)', async () => {
    const bads: unknown[] = [undefined, null, '', 42, {}]
    for (const bad of bads) {
      const result = await verifyAssessmentSession(bad)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(['malformed', 'bad_signature']).toContain(result.error)
    }
  })

  it('rejects a structurally malformed token', async () => {
    for (const bad of ['notoken', '..', 'only-one-part', 'a.']) {
      const result = await verifyAssessmentSession(bad)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(['malformed', 'bad_signature']).toContain(result.error)
    }
  })

  it('rejects a token with a tampered payload', async () => {
    const { token } = await issueAssessmentSession()
    const [payloadB64, sig] = token.split('.')
    const tampered = `${payloadB64.slice(0, -1)}${payloadB64.slice(-1) === 'A' ? 'B' : 'A'}.${sig}`
    const result = await verifyAssessmentSession(tampered)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(['bad_signature', 'malformed']).toContain(result.error)
  })

  it('rejects a token with a tampered signature', async () => {
    const { token } = await issueAssessmentSession()
    const [payloadB64, sig] = token.split('.')
    const tamperedSig = (sig.charAt(0) === 'A' ? 'B' : 'A') + sig.slice(1)
    const result = await verifyAssessmentSession(`${payloadB64}.${tamperedSig}`)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('bad_signature')
  })

  it('rejects a token signed with a different key', async () => {
    const { token } = await issueAssessmentSession()
    ;(testEnv as unknown as Record<string, unknown>).ASSESSMENT_SESSION_SIGNING_KEY =
      'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA='
    const result = await verifyAssessmentSession(token)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('bad_signature')
  })

  it('rejects an expired token', async () => {
    const originalNow = Date.now
    try {
      Date.now = () => 1_700_000_000_000
      const { token } = await issueAssessmentSession(60) // 60s TTL
      Date.now = () => 1_700_000_000_000 + 120 * 1000 // 2 minutes later
      const result = await verifyAssessmentSession(token)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe('expired')
    } finally {
      Date.now = originalNow
    }
  })

  it('rejects a token with an unknown schema version', async () => {
    // Hand-build a v2 payload signed with the test key by re-using the issue
    // path is impossible (version is fixed), so verify rejection via a forged
    // body: the signature won't match, but the version check is also exercised
    // by mutating an otherwise-valid token's decoded version. We assert the
    // negative outcome regardless of which guard fires first.
    const { token } = await issueAssessmentSession()
    // Decode, bump version, re-encode payload but keep old signature → fails
    // signature first; the important property is that it is NOT accepted.
    const [payloadB64, sig] = token.split('.')
    const json = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))) as {
      v: number
    }
    json.v = 999
    const reencoded = btoa(JSON.stringify(json))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const result = await verifyAssessmentSession(`${reencoded}.${sig}`)
    expect(result.ok).toBe(false)
  })
})

describe('consumeSessionTurn', () => {
  it('charges one turn per call and increments the counter', async () => {
    const kv = makeKv()
    const sid = 'sid-1'
    const first = await consumeSessionTurn(kv, sid, 3)
    const second = await consumeSessionTurn(kv, sid, 3)
    expect(first).toEqual({ ok: true, count: 1, limit: 3 })
    expect(second).toEqual({ ok: true, count: 2, limit: 3 })
  })

  it('refuses once the ceiling is reached', async () => {
    const kv = makeKv()
    const sid = 'sid-cap'
    await consumeSessionTurn(kv, sid, 2)
    await consumeSessionTurn(kv, sid, 2)
    const third = await consumeSessionTurn(kv, sid, 2)
    expect(third.ok).toBe(false)
    if (!third.ok) {
      expect(third.reason).toBe('ceiling_reached')
      expect(third.count).toBe(2)
      expect(third.limit).toBe(2)
    }
  })

  it('keeps separate counters per sid', async () => {
    const kv = makeKv()
    await consumeSessionTurn(kv, 'sid-a', 1)
    const a2 = await consumeSessionTurn(kv, 'sid-a', 1)
    const b1 = await consumeSessionTurn(kv, 'sid-b', 1)
    expect(a2.ok).toBe(false) // sid-a exhausted
    expect(b1.ok).toBe(true) // sid-b independent
  })

  it('uses the default ceiling when none is passed', async () => {
    const kv = makeKv()
    const result = await consumeSessionTurn(kv, 'sid-default')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.limit).toBe(MAX_SESSION_TURNS)
  })

  it('treats a corrupt counter value as zero rather than failing open or NaN', async () => {
    const kv = makeKv()
    kv.store.set('as:turns:sid-corrupt', 'not-a-number')
    const result = await consumeSessionTurn(kv, 'sid-corrupt', 3)
    expect(result).toEqual({ ok: true, count: 1, limit: 3 })
  })

  it('allows the turn when KV is undefined (dev mode), mirroring the rate-limiter', async () => {
    const result = await consumeSessionTurn(undefined, 'sid-dev', 1)
    expect(result.ok).toBe(true)
  })

  it('persists under an `as:turns:<sid>` key', async () => {
    const kv = makeKv()
    await consumeSessionTurn(kv, 'sid-keycheck', 5)
    expect(kv.store.has('as:turns:sid-keycheck')).toBe(true)
    expect(kv.store.get('as:turns:sid-keycheck')).toBe('1')
  })
})
