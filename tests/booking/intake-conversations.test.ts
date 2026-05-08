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
})
