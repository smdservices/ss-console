/**
 * Tests for the V2 intake conversation cookie token (HMAC-SHA256, base64url).
 *
 * Mirrors the test posture of `signed-link.test.ts` since the crypto
 * shape and threat model are the same.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env as testEnv } from 'cloudflare:workers'
import {
  signConversationToken,
  verifyConversationToken,
  buildConversationCookieHeader,
  readConversationCookie,
  DEFAULT_CONVERSATION_TTL_SECONDS,
  CONVERSATION_COOKIE_NAME,
} from '../../src/lib/booking/conversation-token'

const TEST_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

beforeEach(() => {
  for (const k of Object.keys(testEnv)) delete (testEnv as unknown as Record<string, unknown>)[k]
  ;(testEnv as unknown as Record<string, unknown>).BOOKING_ENCRYPTION_KEY = TEST_KEY_BASE64
})

describe('signConversationToken / verifyConversationToken', () => {
  it('round-trips and exposes the original payload fields', async () => {
    const token = await signConversationToken({
      conversation_id: 'conv-1',
      entity_id: 'ent-1',
    })
    const result = await verifyConversationToken(token)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.conversation_id).toBe('conv-1')
      expect(result.payload.entity_id).toBe('ent-1')
      expect(result.payload.v).toBe(1)
      expect(result.payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
    }
  })

  it('produces a `<payload>.<sig>` token', async () => {
    const token = await signConversationToken({
      conversation_id: 'conv-1',
      entity_id: 'ent-1',
    })
    const parts = token.split('.')
    expect(parts).toHaveLength(2)
    for (const part of parts) {
      expect(part).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(part.length).toBeGreaterThan(10)
    }
  })

  it('rejects a token with a tampered payload', async () => {
    const token = await signConversationToken({
      conversation_id: 'conv-1',
      entity_id: 'ent-1',
    })
    const [, sig] = token.split('.')
    const tamperedPayload = btoa(
      JSON.stringify({ v: 1, conversation_id: 'conv-evil', entity_id: 'ent-evil', exp: 9999999999 })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const tampered = `${tamperedPayload}.${sig}`
    const result = await verifyConversationToken(tampered)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('bad_signature')
  })

  it('rejects an expired token', async () => {
    const originalNow = Date.now
    try {
      Date.now = () => 1_700_000_000_000
      const token = await signConversationToken({
        conversation_id: 'conv-1',
        entity_id: 'ent-1',
        ttl_seconds: 60,
      })
      Date.now = () => 1_700_000_000_000 + 61_000
      const result = await verifyConversationToken(token)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBe('expired')
    } finally {
      Date.now = originalNow
    }
  })

  it('rejects a malformed token', async () => {
    for (const bad of ['', '...', 'no-dot-here', '.', 'abc.', '.def']) {
      const result = await verifyConversationToken(bad)
      expect(result.ok).toBe(false)
    }
  })

  it('throws a clear error when BOOKING_ENCRYPTION_KEY is missing', async () => {
    delete (testEnv as unknown as Record<string, unknown>).BOOKING_ENCRYPTION_KEY
    await expect(signConversationToken({ conversation_id: 'c', entity_id: 'e' })).rejects.toThrow(
      /BOOKING_ENCRYPTION_KEY/
    )
  })

  it('default TTL matches DEFAULT_CONVERSATION_TTL_SECONDS', async () => {
    const before = Math.floor(Date.now() / 1000)
    const token = await signConversationToken({ conversation_id: 'c', entity_id: 'e' })
    const result = await verifyConversationToken(token)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const expectedExp = before + DEFAULT_CONVERSATION_TTL_SECONDS
      expect(result.payload.exp).toBeGreaterThanOrEqual(expectedExp - 2)
      expect(result.payload.exp).toBeLessThanOrEqual(expectedExp + 2)
    }
  })
})

describe('buildConversationCookieHeader / readConversationCookie', () => {
  it('builds an HttpOnly SameSite=Lax cookie with the configured Max-Age', () => {
    const header = buildConversationCookieHeader('TOKENVAL', 60)
    expect(header).toMatch(new RegExp(`^${CONVERSATION_COOKIE_NAME}=TOKENVAL; `))
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
    expect(header).toContain('Max-Age=60')
    expect(header).toContain('Secure')
  })

  it('omits Secure when explicitly opted out', () => {
    const header = buildConversationCookieHeader('TOKENVAL', 60, false)
    expect(header).not.toContain('Secure')
  })

  it('reads the cookie value out of a request Cookie header', () => {
    const req = new Request('https://example.com/', {
      headers: { cookie: `other=foo; ${CONVERSATION_COOKIE_NAME}=BAZ; trailing=bar` },
    })
    expect(readConversationCookie(req)).toBe('BAZ')
  })

  it('returns null when the cookie is absent', () => {
    const req = new Request('https://example.com/', {
      headers: { cookie: 'other=foo; trailing=bar' },
    })
    expect(readConversationCookie(req)).toBeNull()
  })

  it('returns null when the request has no Cookie header', () => {
    const req = new Request('https://example.com/')
    expect(readConversationCookie(req)).toBeNull()
  })
})
