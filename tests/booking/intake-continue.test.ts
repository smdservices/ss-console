/**
 * End-to-end behavioral tests for POST /api/intake/continue.
 *
 * Exercises the auth (signed cookie) → rate-limit → validate → turn-cap →
 * persist user → call Claude → persist assistant → rotate cookie pipeline
 * with real D1 migrations via @venturecrane/crane-test-harness. The
 * Claude API is mocked at the helper boundary so the handler's own wiring
 * is what's actually under test.
 *
 * Mirrors `tests/booking/reserve.test.ts` shape.
 */

import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
  installWorkerdPolyfills,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import { env as testEnv } from 'cloudflare:workers'
import { ORG_ID } from '../../src/lib/constants'
import {
  signConversationToken,
  CONVERSATION_COOKIE_NAME,
} from '../../src/lib/booking/conversation-token'
import {
  appendUserTurn,
  appendAssistantTurn,
  MAX_TURNS,
  isConversationClosed,
  setInFlight,
} from '../../src/lib/db/intake-conversations'

// ---------------------------------------------------------------------------
// Mocks for external boundaries.
// ---------------------------------------------------------------------------
//
// generateConversationReply is mocked so we can flip success/failure per
// test. postProcessReply is the real implementation — we want it
// exercised against the same shapes the prod path sees.

let claudeReplyResult: string | Error = 'How big is the team today?'

vi.mock('../../src/lib/claude/conversation', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/claude/conversation')>(
    '../../src/lib/claude/conversation'
  )
  return {
    ...actual,
    generateConversationReply: vi.fn(async () => {
      if (claudeReplyResult instanceof Error) throw claudeReplyResult
      return claudeReplyResult
    }),
  }
})

import { POST } from '../../src/pages/api/intake/continue'
import { ConversationApiError } from '../../src/lib/claude/conversation'

// ---------------------------------------------------------------------------
// Test KV (in-memory) for rate-limit.
// ---------------------------------------------------------------------------

function createMemoryKv(): KVNamespace {
  const store = new Map<string, string>()
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const migrationsDir = resolve(process.cwd(), 'migrations')
const TEST_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
const ENTITY_ID = 'ent-cont-1'
const CONV_ID = 'conv-cont-1'

installWorkerdPolyfills()

interface BuildCtxOpts {
  body: Record<string, unknown>
  cookie?: string
  ip?: string
}

function buildContext(opts: BuildCtxOpts) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (opts.cookie) headers.set('cookie', `${CONVERSATION_COOKIE_NAME}=${opts.cookie}`)
  if (opts.ip) headers.set('cf-connecting-ip', opts.ip)
  const request = new Request('http://test.local/api/intake/continue', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body),
  })
  return {
    request,
    params: {},
    locals: {},
    redirect: (url: string, status: number) =>
      new Response(null, { status, headers: { Location: url } }),
  } as unknown as Parameters<typeof POST>[0]
}

async function parseJson<T>(res: Response): Promise<T> {
  return res.json()
}

async function seedTurn1(db: D1Database): Promise<void> {
  await appendUserTurn(db, ORG_ID, {
    entityId: ENTITY_ID,
    conversationId: CONV_ID,
    turn: 1,
    content: 'We do HVAC, mostly residential, twelve years.',
  })
  await appendAssistantTurn(db, ORG_ID, {
    entityId: ENTITY_ID,
    conversationId: CONV_ID,
    turn: 1,
    content: 'How big is the team today?',
  })
}

interface ContinueResponse {
  ok?: boolean
  ai_reply?: string | null
  turn?: number
  can_continue?: boolean
  slot_picker_next?: boolean
  closed?: boolean
  error?: string
  message?: string
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/intake/continue', () => {
  let db: D1Database
  let kv: KVNamespace

  beforeAll(() => {
    expect(discoverNumericMigrations(migrationsDir).length).toBeGreaterThan(0)
  })

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    kv = createMemoryKv()

    Object.assign(testEnv, {
      DB: db,
      BOOKING_CACHE: kv,
      ANTHROPIC_API_KEY: 'fake-anthropic-key',
      BOOKING_ENCRYPTION_KEY: TEST_KEY_BASE64,
    })

    // Seed an entity that the cookie will reference.
    await db
      .prepare(
        `INSERT INTO entities (id, org_id, name, slug, stage, stage_changed_at)
         VALUES (?, ?, ?, ?, 'prospect', datetime('now'))`
      )
      .bind(ENTITY_ID, ORG_ID, 'HVAC Co', 'hvac-co')
      .run()

    claudeReplyResult = 'How many crews are you running?'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('happy path: turn 2 succeeds, persists user + AI, rotates cookie', async () => {
    await seedTurn1(db)
    const token = await signConversationToken({
      conversation_id: CONV_ID,
      entity_id: ENTITY_ID,
    })

    const res = await POST(
      buildContext({ body: { message: 'Four crews, mostly two-person.' }, cookie: token })
    )
    expect(res.status).toBe(200)
    const body = await parseJson<ContinueResponse>(res)
    expect(body.ok).toBe(true)
    expect(body.ai_reply).toBe('How many crews are you running?')
    expect(body.turn).toBe(2)
    expect(body.can_continue).toBe(true)
    // Default: low turn, no marker, ceiling not hit -> picker not surfaced.
    expect(body.slot_picker_next).toBe(false)

    // Cookie was rotated.
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    expect(setCookie).toContain(`${CONVERSATION_COOKIE_NAME}=`)

    // History now has 4 entries (turn 1 user + AI, turn 2 user + AI).
    const turns = await db
      .prepare(
        `SELECT source, content FROM context
         WHERE entity_id = ? AND type = 'intake'
         ORDER BY created_at ASC`
      )
      .bind(ENTITY_ID)
      .all<{ source: string; content: string }>()
    expect(turns.results).toHaveLength(4)
    expect(turns.results[2].content).toBe('Four crews, mostly two-person.')
    expect(turns.results[3].content).toBe('How many crews are you running?')
  })

  it('401 when the cookie is missing', async () => {
    const res = await POST(buildContext({ body: { message: 'hello' } }))
    expect(res.status).toBe(401)
    const body = await parseJson<ContinueResponse>(res)
    expect(body.error).toBe('unauthorized')
  })

  it('401 session_expired when the cookie has expired', async () => {
    const realNow = Date.now
    try {
      Date.now = () => 1_700_000_000_000
      const token = await signConversationToken({
        conversation_id: CONV_ID,
        entity_id: ENTITY_ID,
        ttl_seconds: 60,
      })
      Date.now = () => 1_700_000_000_000 + 61_000
      const res = await POST(buildContext({ body: { message: 'hello' }, cookie: token }))
      expect(res.status).toBe(401)
      const body = await parseJson<ContinueResponse>(res)
      expect(body.error).toBe('session_expired')
    } finally {
      Date.now = realNow
    }
  })

  it('401 unauthorized when the cookie signature is tampered', async () => {
    const token = await signConversationToken({
      conversation_id: CONV_ID,
      entity_id: ENTITY_ID,
    })
    const [payload] = token.split('.')
    const tampered = `${payload}.AAAAAAAAAAAAAAAA`
    const res = await POST(buildContext({ body: { message: 'hello' }, cookie: tampered }))
    expect(res.status).toBe(401)
    const body = await parseJson<ContinueResponse>(res)
    expect(body.error).toBe('unauthorized')
  })

  it('400 validation_failed on empty message', async () => {
    await seedTurn1(db)
    const token = await signConversationToken({
      conversation_id: CONV_ID,
      entity_id: ENTITY_ID,
    })
    const res = await POST(buildContext({ body: { message: '' }, cookie: token }))
    expect(res.status).toBe(400)
    const body = await parseJson<ContinueResponse>(res)
    expect(body.error).toBe('validation_failed')
  })

  it('400 validation_failed when message exceeds the max length', async () => {
    await seedTurn1(db)
    const token = await signConversationToken({
      conversation_id: CONV_ID,
      entity_id: ENTITY_ID,
    })
    const res = await POST(buildContext({ body: { message: 'x'.repeat(5001) }, cookie: token }))
    expect(res.status).toBe(400)
    const body = await parseJson<ContinueResponse>(res)
    expect(body.error).toBe('validation_failed')
  })

  it('hits the turn cap and returns can_continue: false without calling Claude', async () => {
    // Seed MAX_TURNS prior user turns + assistant turns.
    for (let t = 1; t <= MAX_TURNS; t++) {
      await appendUserTurn(db, ORG_ID, {
        entityId: ENTITY_ID,
        conversationId: CONV_ID,
        turn: t,
        content: `user turn ${t}`,
      })
      await appendAssistantTurn(db, ORG_ID, {
        entityId: ENTITY_ID,
        conversationId: CONV_ID,
        turn: t,
        content: `ai turn ${t}?`,
      })
    }
    const token = await signConversationToken({
      conversation_id: CONV_ID,
      entity_id: ENTITY_ID,
    })
    const res = await POST(buildContext({ body: { message: 'one more thing' }, cookie: token }))
    expect(res.status).toBe(200)
    const body = await parseJson<ContinueResponse>(res)
    expect(body.ok).toBe(true)
    expect(body.ai_reply).toBeNull()
    expect(body.can_continue).toBe(false)
  })

  it('history accumulates correctly across two consecutive /continue calls', async () => {
    await seedTurn1(db)
    const token = await signConversationToken({
      conversation_id: CONV_ID,
      entity_id: ENTITY_ID,
    })

    claudeReplyResult = 'AI reply turn 2?'
    const res1 = await POST(buildContext({ body: { message: 'turn 2 user' }, cookie: token }))
    expect(res1.status).toBe(200)
    const body1 = await parseJson<ContinueResponse>(res1)
    expect(body1.turn).toBe(2)

    claudeReplyResult = 'AI reply turn 3?'
    const res2 = await POST(buildContext({ body: { message: 'turn 3 user' }, cookie: token }))
    expect(res2.status).toBe(200)
    const body2 = await parseJson<ContinueResponse>(res2)
    expect(body2.turn).toBe(3)

    const turns = await db
      .prepare(
        `SELECT content FROM context
         WHERE entity_id = ? AND type = 'intake'
         ORDER BY created_at ASC`
      )
      .bind(ENTITY_ID)
      .all<{ content: string }>()
    expect(turns.results.map((r) => r.content)).toEqual([
      'We do HVAC, mostly residential, twelve years.',
      'How big is the team today?',
      'turn 2 user',
      'AI reply turn 2?',
      'turn 3 user',
      'AI reply turn 3?',
    ])
  })

  it('503 ai_unavailable when Claude API throws; user turn was still persisted', async () => {
    await seedTurn1(db)
    const token = await signConversationToken({
      conversation_id: CONV_ID,
      entity_id: ENTITY_ID,
    })
    claudeReplyResult = new ConversationApiError('Boom', 500)

    const res = await POST(
      buildContext({ body: { message: 'this should reach DB then 503' }, cookie: token })
    )
    expect(res.status).toBe(503)
    const body = await parseJson<ContinueResponse>(res)
    expect(body.error).toBe('ai_unavailable')

    // User turn 2 was persisted before Claude was called.
    const userTurns = await db
      .prepare(
        `SELECT content FROM context
         WHERE entity_id = ? AND source = 'website_intake_v2_user'
         ORDER BY created_at ASC`
      )
      .bind(ENTITY_ID)
      .all<{ content: string }>()
    expect(userTurns.results.map((r) => r.content)).toEqual([
      'We do HVAC, mostly residential, twelve years.',
      'this should reach DB then 503',
    ])
  })

  // ---------------------------------------------------------------------------
  // V3 additions: slot-picker readiness, Done flow, idempotency.
  // ---------------------------------------------------------------------------

  describe('slot-picker readiness', () => {
    it('AI marker on its own line fires slot_picker_next and is stripped from the persisted reply', async () => {
      await seedTurn1(db)
      const token = await signConversationToken({
        conversation_id: CONV_ID,
        entity_id: ENTITY_ID,
      })
      claudeReplyResult = 'Where in the chain does the slowdown hit?\n[[READY-FOR-CALL]]'

      const res = await POST(
        buildContext({ body: { message: 'Four crews, scheduling is killing us.' }, cookie: token })
      )
      const body = await parseJson<ContinueResponse>(res)
      expect(body.slot_picker_next).toBe(true)
      expect(body.ai_reply).toBe('Where in the chain does the slowdown hit?')
      expect(body.ai_reply).not.toContain('[[READY-FOR-CALL]]')

      // Persisted reply was stripped too.
      const persisted = await db
        .prepare(
          `SELECT content FROM context
             WHERE entity_id = ? AND source = 'website_intake_v2_ai'
             ORDER BY created_at DESC LIMIT 1`
        )
        .bind(ENTITY_ID)
        .first<{ content: string }>()
      expect(persisted?.content).toBe('Where in the chain does the slowdown hit?')
      expect(persisted?.content).not.toContain('[[READY-FOR-CALL]]')
    })

    it('ceiling fires slot_picker_next at turn 4 even without the marker', async () => {
      // Seed turns 1..3 (user + AI each).
      for (let t = 1; t <= 3; t++) {
        await appendUserTurn(db, ORG_ID, {
          entityId: ENTITY_ID,
          conversationId: CONV_ID,
          turn: t,
          content: `user turn ${t}`,
        })
        await appendAssistantTurn(db, ORG_ID, {
          entityId: ENTITY_ID,
          conversationId: CONV_ID,
          turn: t,
          content: `ai turn ${t}?`,
        })
      }
      const token = await signConversationToken({
        conversation_id: CONV_ID,
        entity_id: ENTITY_ID,
      })
      claudeReplyResult = 'And what is running the schedule today?'

      const res = await POST(
        buildContext({ body: { message: 'turn 4 user content' }, cookie: token })
      )
      const body = await parseJson<ContinueResponse>(res)
      expect(body.turn).toBe(4)
      expect(body.slot_picker_next).toBe(true)
      // No marker in the model reply, so ceiling is what set it.
    })

    it('turn 3 without marker stays under the ceiling and does not fire slot_picker_next', async () => {
      // Seed turns 1..2.
      for (let t = 1; t <= 2; t++) {
        await appendUserTurn(db, ORG_ID, {
          entityId: ENTITY_ID,
          conversationId: CONV_ID,
          turn: t,
          content: `user turn ${t}`,
        })
        await appendAssistantTurn(db, ORG_ID, {
          entityId: ENTITY_ID,
          conversationId: CONV_ID,
          turn: t,
          content: `ai turn ${t}?`,
        })
      }
      const token = await signConversationToken({
        conversation_id: CONV_ID,
        entity_id: ENTITY_ID,
      })
      claudeReplyResult = 'How many jobs a week is the team turning?'

      const res = await POST(buildContext({ body: { message: 'turn 3 user' }, cookie: token }))
      const body = await parseJson<ContinueResponse>(res)
      expect(body.turn).toBe(3)
      expect(body.slot_picker_next).toBe(false)
    })
  })

  describe('Done close flow', () => {
    it('closed: true marks the conversation closed and is idempotent', async () => {
      await seedTurn1(db)
      const token = await signConversationToken({
        conversation_id: CONV_ID,
        entity_id: ENTITY_ID,
      })

      const res1 = await POST(buildContext({ body: { closed: true }, cookie: token }))
      expect(res1.status).toBe(200)
      const body1 = await parseJson<ContinueResponse>(res1)
      expect(body1.ok).toBe(true)
      expect(body1.closed).toBe(true)
      expect(await isConversationClosed(db, CONV_ID)).toBe(true)

      // Second call: still 200, still closed.
      const res2 = await POST(buildContext({ body: { closed: true }, cookie: token }))
      expect(res2.status).toBe(200)
      const body2 = await parseJson<ContinueResponse>(res2)
      expect(body2.closed).toBe(true)
    })

    it('closed: true returns 409 when an assistant turn is in flight', async () => {
      await seedTurn1(db)
      // Simulate an in-flight assistant turn by seeding the row directly.
      await setInFlight(db, { conversationId: CONV_ID, entityId: ENTITY_ID })
      const token = await signConversationToken({
        conversation_id: CONV_ID,
        entity_id: ENTITY_ID,
      })

      const res = await POST(buildContext({ body: { closed: true }, cookie: token }))
      expect(res.status).toBe(409)
      const body = await parseJson<ContinueResponse>(res)
      expect(body.error).toBe('in_flight')
      // Conversation stayed open.
      expect(await isConversationClosed(db, CONV_ID)).toBe(false)
    })

    it('closed conversation rejects subsequent /continue with 401', async () => {
      await seedTurn1(db)
      const token = await signConversationToken({
        conversation_id: CONV_ID,
        entity_id: ENTITY_ID,
      })
      // Close.
      await POST(buildContext({ body: { closed: true }, cookie: token }))
      // Continue against a closed conversation.
      const res = await POST(buildContext({ body: { message: 'still typing' }, cookie: token }))
      expect(res.status).toBe(401)
      const body = await parseJson<ContinueResponse>(res)
      expect(body.error).toBe('unauthorized')
    })
  })

  describe('idempotency-key replay', () => {
    it('replays the previous result without duplicating the user turn', async () => {
      await seedTurn1(db)
      const token = await signConversationToken({
        conversation_id: CONV_ID,
        entity_id: ENTITY_ID,
      })
      claudeReplyResult = 'How many crews are you running?'

      // First call with idempotency_key.
      const res1 = await POST(
        buildContext({
          body: { message: 'Four crews.', idempotency_key: 'k-1' },
          cookie: token,
        })
      )
      const body1 = await parseJson<ContinueResponse>(res1)
      expect(body1.turn).toBe(2)
      expect(body1.ai_reply).toBe('How many crews are you running?')

      // Second call with the SAME key. Claude must NOT be called again
      // (we'd see the new claudeReplyResult below if it were).
      claudeReplyResult = 'DIFFERENT REPLY THAT MUST NOT WIN'
      const res2 = await POST(
        buildContext({
          body: { message: 'Four crews.', idempotency_key: 'k-1' },
          cookie: token,
        })
      )
      const body2 = await parseJson<ContinueResponse>(res2)
      expect(body2.turn).toBe(2)
      expect(body2.ai_reply).toBe('How many crews are you running?')

      // The user turn was NOT duplicated.
      const userTurns = await db
        .prepare(
          `SELECT content FROM context
             WHERE entity_id = ? AND source = 'website_intake_v2_user'
             ORDER BY created_at ASC`
        )
        .bind(ENTITY_ID)
        .all<{ content: string }>()
      expect(userTurns.results).toHaveLength(2) // turn 1 (seed) + turn 2 (only one)
      expect(userTurns.results[1].content).toBe('Four crews.')
    })

    it('a new key after the snapshot is recorded creates a fresh turn', async () => {
      await seedTurn1(db)
      const token = await signConversationToken({
        conversation_id: CONV_ID,
        entity_id: ENTITY_ID,
      })
      claudeReplyResult = 'How many crews?'

      await POST(
        buildContext({
          body: { message: 'Four crews.', idempotency_key: 'k-1' },
          cookie: token,
        })
      )

      claudeReplyResult = 'And how does the work get scheduled today?'
      const res2 = await POST(
        buildContext({
          body: { message: 'Whiteboard and texts.', idempotency_key: 'k-2' },
          cookie: token,
        })
      )
      const body2 = await parseJson<ContinueResponse>(res2)
      expect(body2.turn).toBe(3)
      expect(body2.ai_reply).toBe('And how does the work get scheduled today?')
    })
  })

  it('400 on invalid JSON body', async () => {
    const token = await signConversationToken({
      conversation_id: CONV_ID,
      entity_id: ENTITY_ID,
    })
    const headers = new Headers({
      'Content-Type': 'application/json',
      cookie: `${CONVERSATION_COOKIE_NAME}=${token}`,
    })
    const request = new Request('http://test.local/api/intake/continue', {
      method: 'POST',
      headers,
      body: '{not json',
    })
    const ctx = {
      request,
      params: {},
      locals: {},
      redirect: (url: string, status: number) =>
        new Response(null, { status, headers: { Location: url } }),
    } as unknown as Parameters<typeof POST>[0]
    const res = await POST(ctx)
    expect(res.status).toBe(400)
  })
})
