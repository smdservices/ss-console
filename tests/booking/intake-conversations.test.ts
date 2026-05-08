/**
 * Tests for the V2 intake conversation persistence helpers in
 * `src/lib/db/intake-conversations.ts`.
 *
 * Covers: turn appending, turn counting, history reconstruction
 * (chronological, alternating user/assistant), filtering by
 * conversation_id, and the MAX_TURNS constant.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createTestD1,
  runMigrations,
  discoverNumericMigrations,
} from '@venturecrane/crane-test-harness'
import { resolve } from 'path'
import type { D1Database } from '@cloudflare/workers-types'
import {
  appendUserTurn,
  appendAssistantTurn,
  countUserTurns,
  loadConversationHistory,
  MAX_TURNS,
  V2_USER_SOURCE,
  V2_AI_SOURCE,
  markConversationClosed,
  isConversationClosed,
  setInFlight,
  clearInFlight,
  isInFlight,
  recordIdempotencySnapshot,
  lookupIdempotencySnapshot,
} from '../../src/lib/db/intake-conversations'

const migrationsDir = resolve(process.cwd(), 'migrations')
const ORG_ID = 'org-icv'
const ENTITY_ID = 'ent-icv'
const CONV_ID = 'conv-1'

describe('intake-conversations persistence', () => {
  let db: D1Database

  beforeEach(async () => {
    db = createTestD1()
    await runMigrations(db, { files: discoverNumericMigrations(migrationsDir) })
    await db
      .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .bind(ORG_ID, 'Org ICV', 'org-icv')
      .run()
    await db
      .prepare(
        `INSERT INTO entities (id, org_id, name, slug, stage, stage_changed_at)
         VALUES (?, ?, ?, ?, 'prospect', datetime('now'))`
      )
      .bind(ENTITY_ID, ORG_ID, 'ICV Co', 'icv-co')
      .run()
  })

  it('round-trips a single user/assistant turn pair', async () => {
    await appendUserTurn(db, ORG_ID, {
      entityId: ENTITY_ID,
      conversationId: CONV_ID,
      turn: 1,
      content: 'Hello, this is the first user message.',
    })
    await appendAssistantTurn(db, ORG_ID, {
      entityId: ENTITY_ID,
      conversationId: CONV_ID,
      turn: 1,
      content: 'And this is the AI reply.',
    })

    const history = await loadConversationHistory(db, ENTITY_ID, CONV_ID)
    expect(history).toEqual([
      { role: 'user', content: 'Hello, this is the first user message.' },
      { role: 'assistant', content: 'And this is the AI reply.' },
    ])
  })

  it('orders multi-turn history chronologically by (turn, role)', async () => {
    // Persist out of order to confirm sort.
    await appendAssistantTurn(db, ORG_ID, {
      entityId: ENTITY_ID,
      conversationId: CONV_ID,
      turn: 2,
      content: 'turn2-ai',
    })
    await appendUserTurn(db, ORG_ID, {
      entityId: ENTITY_ID,
      conversationId: CONV_ID,
      turn: 2,
      content: 'turn2-user',
    })
    await appendAssistantTurn(db, ORG_ID, {
      entityId: ENTITY_ID,
      conversationId: CONV_ID,
      turn: 1,
      content: 'turn1-ai',
    })
    await appendUserTurn(db, ORG_ID, {
      entityId: ENTITY_ID,
      conversationId: CONV_ID,
      turn: 1,
      content: 'turn1-user',
    })

    const history = await loadConversationHistory(db, ENTITY_ID, CONV_ID)
    expect(history.map((t) => t.content)).toEqual([
      'turn1-user',
      'turn1-ai',
      'turn2-user',
      'turn2-ai',
    ])
  })

  it('isolates by conversation_id', async () => {
    await appendUserTurn(db, ORG_ID, {
      entityId: ENTITY_ID,
      conversationId: 'conv-a',
      turn: 1,
      content: 'A1',
    })
    await appendUserTurn(db, ORG_ID, {
      entityId: ENTITY_ID,
      conversationId: 'conv-b',
      turn: 1,
      content: 'B1',
    })
    const a = await loadConversationHistory(db, ENTITY_ID, 'conv-a')
    const b = await loadConversationHistory(db, ENTITY_ID, 'conv-b')
    expect(a).toEqual([{ role: 'user', content: 'A1' }])
    expect(b).toEqual([{ role: 'user', content: 'B1' }])
  })

  it('countUserTurns returns the number of user turns recorded', async () => {
    expect(await countUserTurns(db, ENTITY_ID, CONV_ID)).toBe(0)
    await appendUserTurn(db, ORG_ID, {
      entityId: ENTITY_ID,
      conversationId: CONV_ID,
      turn: 1,
      content: 'one',
    })
    expect(await countUserTurns(db, ENTITY_ID, CONV_ID)).toBe(1)
    // Assistant turns do not count.
    await appendAssistantTurn(db, ORG_ID, {
      entityId: ENTITY_ID,
      conversationId: CONV_ID,
      turn: 1,
      content: 'one-ai',
    })
    expect(await countUserTurns(db, ENTITY_ID, CONV_ID)).toBe(1)
    await appendUserTurn(db, ORG_ID, {
      entityId: ENTITY_ID,
      conversationId: CONV_ID,
      turn: 2,
      content: 'two',
    })
    expect(await countUserTurns(db, ENTITY_ID, CONV_ID)).toBe(2)
  })

  it('exposes the MAX_TURNS cap and V2 source constants', () => {
    // Sanity: MAX_TURNS is a generous-but-finite limit.
    expect(MAX_TURNS).toBeGreaterThanOrEqual(10)
    expect(MAX_TURNS).toBeLessThanOrEqual(50)
    expect(V2_USER_SOURCE).toBe('website_intake_v2_user')
    expect(V2_AI_SOURCE).toBe('website_intake_v2_ai')
  })

  describe('intake_conversation_meta', () => {
    it('markConversationClosed is idempotent — second call does not change closed_at', async () => {
      expect(await isConversationClosed(db, CONV_ID)).toBe(false)

      await markConversationClosed(db, { conversationId: CONV_ID, entityId: ENTITY_ID })
      expect(await isConversationClosed(db, CONV_ID)).toBe(true)

      // Capture the first closed_at, repeat the call, confirm the
      // timestamp did not move forward.
      const first = await db
        .prepare('SELECT closed_at FROM intake_conversation_meta WHERE conversation_id = ?')
        .bind(CONV_ID)
        .first<{ closed_at: string }>()

      await markConversationClosed(db, { conversationId: CONV_ID, entityId: ENTITY_ID })

      const second = await db
        .prepare('SELECT closed_at FROM intake_conversation_meta WHERE conversation_id = ?')
        .bind(CONV_ID)
        .first<{ closed_at: string }>()

      expect(second?.closed_at).toBe(first?.closed_at)
      expect(await isConversationClosed(db, CONV_ID)).toBe(true)
    })

    it('isConversationClosed is false for unknown conversation_ids', async () => {
      expect(await isConversationClosed(db, 'never-existed')).toBe(false)
    })

    it('setInFlight + isInFlight + clearInFlight cycle', async () => {
      expect(await isInFlight(db, CONV_ID)).toBe(false)

      await setInFlight(db, { conversationId: CONV_ID, entityId: ENTITY_ID })
      expect(await isInFlight(db, CONV_ID)).toBe(true)

      await clearInFlight(db, CONV_ID)
      expect(await isInFlight(db, CONV_ID)).toBe(false)
    })

    it('setInFlight is idempotent — second call extends the deadline, not duplicates the row', async () => {
      await setInFlight(db, { conversationId: CONV_ID, entityId: ENTITY_ID, ttlSeconds: 60 })
      await setInFlight(db, { conversationId: CONV_ID, entityId: ENTITY_ID, ttlSeconds: 120 })

      const rows = await db
        .prepare('SELECT COUNT(*) as count FROM intake_conversation_meta WHERE conversation_id = ?')
        .bind(CONV_ID)
        .first<{ count: number }>()
      expect(rows?.count).toBe(1)
      expect(await isInFlight(db, CONV_ID)).toBe(true)
    })

    it('expired in_flight_until reads as not in flight', async () => {
      // Set a deadline in the past directly so we don't have to wait.
      await db
        .prepare(
          `INSERT INTO intake_conversation_meta (conversation_id, entity_id, in_flight_until)
           VALUES (?, ?, datetime('now', '-60 seconds'))`
        )
        .bind('conv-expired', ENTITY_ID)
        .run()

      expect(await isInFlight(db, 'conv-expired')).toBe(false)
    })

    it('close + in-flight are independent flags on the same row', async () => {
      await setInFlight(db, { conversationId: CONV_ID, entityId: ENTITY_ID })
      await markConversationClosed(db, { conversationId: CONV_ID, entityId: ENTITY_ID })

      expect(await isInFlight(db, CONV_ID)).toBe(true)
      expect(await isConversationClosed(db, CONV_ID)).toBe(true)

      const row = await db
        .prepare(
          'SELECT closed_at, in_flight_until FROM intake_conversation_meta WHERE conversation_id = ?'
        )
        .bind(CONV_ID)
        .first<{ closed_at: string | null; in_flight_until: string | null }>()
      expect(row?.closed_at).not.toBeNull()
      expect(row?.in_flight_until).not.toBeNull()
    })
  })

  describe('idempotency snapshot', () => {
    it('round-trips a snapshot keyed by (conversation_id, idempotency_key)', async () => {
      await recordIdempotencySnapshot(db, {
        conversationId: CONV_ID,
        entityId: ENTITY_ID,
        idempotencyKey: 'key-1',
        turn: 2,
        aiReply: 'How big is the team today?',
        slotPickerNext: false,
      })

      const snap = await lookupIdempotencySnapshot(db, CONV_ID, 'key-1')
      expect(snap).toEqual({
        turn: 2,
        aiReply: 'How big is the team today?',
        slotPickerNext: false,
      })
    })

    it('preserves the slotPickerNext flag', async () => {
      await recordIdempotencySnapshot(db, {
        conversationId: CONV_ID,
        entityId: ENTITY_ID,
        idempotencyKey: 'key-ready',
        turn: 4,
        aiReply: 'Got enough to make the call useful.',
        slotPickerNext: true,
      })

      const snap = await lookupIdempotencySnapshot(db, CONV_ID, 'key-ready')
      expect(snap?.slotPickerNext).toBe(true)
    })

    it('returns null for an unknown key', async () => {
      expect(await lookupIdempotencySnapshot(db, CONV_ID, 'never')).toBeNull()
    })

    it('overwrites the previous snapshot on the next turn (sticky to most recent)', async () => {
      await recordIdempotencySnapshot(db, {
        conversationId: CONV_ID,
        entityId: ENTITY_ID,
        idempotencyKey: 'key-old',
        turn: 1,
        aiReply: 'first',
        slotPickerNext: false,
      })
      await recordIdempotencySnapshot(db, {
        conversationId: CONV_ID,
        entityId: ENTITY_ID,
        idempotencyKey: 'key-new',
        turn: 2,
        aiReply: 'second',
        slotPickerNext: false,
      })

      // Old key no longer hits.
      expect(await lookupIdempotencySnapshot(db, CONV_ID, 'key-old')).toBeNull()
      // New key is what's stored.
      expect((await lookupIdempotencySnapshot(db, CONV_ID, 'key-new'))?.aiReply).toBe('second')
    })

    it('coexists with closed_at and in_flight_until on the same row', async () => {
      await markConversationClosed(db, { conversationId: CONV_ID, entityId: ENTITY_ID })
      await recordIdempotencySnapshot(db, {
        conversationId: CONV_ID,
        entityId: ENTITY_ID,
        idempotencyKey: 'key-closed',
        turn: 3,
        aiReply: 'reply',
        slotPickerNext: false,
      })

      // The snapshot record did not clear the close.
      expect(await isConversationClosed(db, CONV_ID)).toBe(true)
      expect(await lookupIdempotencySnapshot(db, CONV_ID, 'key-closed')).not.toBeNull()
    })
  })
})
