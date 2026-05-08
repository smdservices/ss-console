/**
 * Intake conversation persistence — V2 multi-turn intake (`/book` Send +
 * follow-up turns).
 *
 * Design: messages are stored in the existing `context` table as
 * `type='intake'` rows with V2-specific sources and `conversation_id` +
 * `turn` + `role` in metadata. No new schema. Filter and reconstruct
 * happens app-side on the small per-conversation N (capped at MAX_TURNS
 * × 2 entries).
 *
 * Sources (per V2):
 *   - `website_intake_v2_user`      — a user message for a given turn
 *   - `website_intake_v2_ai`        — the AI's reply for that turn
 *
 * The existing intake-core context entry (`source='website_intake_send'`)
 * is preserved as the canonical "first contact" record for admin viewing.
 * V2 stores its own user-turn-1 entry so conversation history is uniform
 * (a small duplication, deliberately accepted to keep the admin record
 * untouched).
 */

import { appendContext, listContext } from './context'
import type { ContextEntry } from './context'
import type { ConversationTurn } from '../claude/conversation'

export const MAX_TURNS = 20
export const V2_USER_SOURCE = 'website_intake_v2_user'
export const V2_AI_SOURCE = 'website_intake_v2_ai'
const V2_SOURCES = new Set([V2_USER_SOURCE, V2_AI_SOURCE])

interface V2Metadata {
  conversation_id: string
  turn: number
  role: 'user' | 'assistant'
}

function parseV2Metadata(raw: string | null): V2Metadata | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const conversation_id = parsed?.conversation_id
    const turn = parsed?.turn
    const role = parsed?.role
    if (
      typeof conversation_id !== 'string' ||
      typeof turn !== 'number' ||
      (role !== 'user' && role !== 'assistant')
    ) {
      return null
    }
    return { conversation_id, turn, role }
  } catch {
    return null
  }
}

interface OrderedEntry {
  entry: ContextEntry
  meta: V2Metadata
}

async function listV2Entries(
  db: D1Database,
  entityId: string,
  conversationId: string
): Promise<OrderedEntry[]> {
  const all = await listContext(db, entityId, { type: 'intake' })
  const ordered: OrderedEntry[] = []
  for (const entry of all) {
    if (!V2_SOURCES.has(entry.source)) continue
    const meta = parseV2Metadata(entry.metadata)
    if (!meta) continue
    if (meta.conversation_id !== conversationId) continue
    ordered.push({ entry, meta })
  }
  ordered.sort((a, b) => {
    if (a.meta.turn !== b.meta.turn) return a.meta.turn - b.meta.turn
    // user before assistant within the same turn
    if (a.meta.role === b.meta.role) return 0
    return a.meta.role === 'user' ? -1 : 1
  })
  return ordered
}

/**
 * Load conversation history as ConversationTurn[] for sending to Claude.
 * Returns turns in chronological order, alternating user / assistant.
 */
export async function loadConversationHistory(
  db: D1Database,
  entityId: string,
  conversationId: string
): Promise<ConversationTurn[]> {
  const ordered = await listV2Entries(db, entityId, conversationId)
  return ordered.map(({ entry, meta }) => ({
    role: meta.role,
    content: entry.content,
  }))
}

/**
 * Count how many user turns have been recorded for the conversation.
 * Used to enforce MAX_TURNS and to compute the next turn number.
 */
export async function countUserTurns(
  db: D1Database,
  entityId: string,
  conversationId: string
): Promise<number> {
  const ordered = await listV2Entries(db, entityId, conversationId)
  return ordered.filter((e) => e.meta.role === 'user').length
}

/**
 * Persist a user turn. `turn` is 1-indexed; for follow-ups it must equal
 * `prior user turns + 1`.
 */
export async function appendUserTurn(
  db: D1Database,
  orgId: string,
  params: { entityId: string; conversationId: string; turn: number; content: string }
): Promise<void> {
  await appendContext(db, orgId, {
    entity_id: params.entityId,
    type: 'intake',
    content: params.content,
    source: V2_USER_SOURCE,
    metadata: {
      conversation_id: params.conversationId,
      turn: params.turn,
      role: 'user',
    },
  })
}

/**
 * Persist an AI assistant turn. `turn` matches the user turn it replies to.
 */
export async function appendAssistantTurn(
  db: D1Database,
  orgId: string,
  params: {
    entityId: string
    conversationId: string
    turn: number
    content: string
    model?: string
  }
): Promise<void> {
  await appendContext(db, orgId, {
    entity_id: params.entityId,
    type: 'intake',
    content: params.content,
    source: V2_AI_SOURCE,
    metadata: {
      conversation_id: params.conversationId,
      turn: params.turn,
      role: 'assistant',
      model: params.model ?? 'claude',
    },
  })
}

/**
 * Per-conversation state row. Backs the V3 Done flow (idempotent close)
 * and the in-flight guard that prevents Done from racing an in-progress
 * assistant turn. See migration 0037_intake_conversation_meta.sql.
 */

/** Window we hold the in-flight flag for. Tuned to be longer than the
 *  worst-case Claude latency so a stuck request still releases the lock
 *  cleanly. Done arriving inside the window returns 409 — the client
 *  retries once the in-flight assistant turn lands. */
export const IN_FLIGHT_TTL_SECONDS = 120

/**
 * Idempotent close. First call writes closed_at; later calls are no-ops
 * but still return ok: true so the client never sees an error after
 * reaching the Done acknowledgment card.
 */
export async function markConversationClosed(
  db: D1Database,
  params: { conversationId: string; entityId: string }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO intake_conversation_meta (conversation_id, entity_id, closed_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(conversation_id) DO UPDATE
         SET closed_at = COALESCE(closed_at, datetime('now')),
             updated_at = datetime('now')
       WHERE intake_conversation_meta.closed_at IS NULL`
    )
    .bind(params.conversationId, params.entityId)
    .run()
}

export async function isConversationClosed(
  db: D1Database,
  conversationId: string
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT closed_at FROM intake_conversation_meta WHERE conversation_id = ?`)
    .bind(conversationId)
    .first<{ closed_at: string | null }>()
  return row != null && row.closed_at != null
}

/**
 * Mark the conversation as having an assistant turn in flight. Sets
 * in_flight_until to now() + IN_FLIGHT_TTL_SECONDS. Idempotent — a second
 * call simply pushes the deadline forward.
 */
export async function setInFlight(
  db: D1Database,
  params: { conversationId: string; entityId: string; ttlSeconds?: number }
): Promise<void> {
  const ttl = params.ttlSeconds ?? IN_FLIGHT_TTL_SECONDS
  await db
    .prepare(
      `INSERT INTO intake_conversation_meta (conversation_id, entity_id, in_flight_until)
       VALUES (?, ?, datetime('now', '+' || ? || ' seconds'))
       ON CONFLICT(conversation_id) DO UPDATE
         SET in_flight_until = datetime('now', '+' || ? || ' seconds'),
             updated_at = datetime('now')`
    )
    .bind(params.conversationId, params.entityId, ttl, ttl)
    .run()
}

export async function clearInFlight(db: D1Database, conversationId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE intake_conversation_meta
         SET in_flight_until = NULL, updated_at = datetime('now')
       WHERE conversation_id = ?`
    )
    .bind(conversationId)
    .run()
}

/**
 * True if the conversation has an assistant turn currently being generated.
 * Compared against datetime('now'); expired locks read as not in flight,
 * so a crashed handler can't permanently wedge the conversation.
 */
export async function isInFlight(db: D1Database, conversationId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT in_flight_until FROM intake_conversation_meta
         WHERE conversation_id = ?
           AND in_flight_until IS NOT NULL
           AND in_flight_until > datetime('now')`
    )
    .bind(conversationId)
    .first<{ in_flight_until: string }>()
  return row != null
}

/**
 * Last-turn idempotency snapshot. Backs the Retry button: a client that
 * POSTs the same idempotency key gets the same reply replayed without
 * duplicating the user turn server-side. Sticky to the most recent turn
 * only — older keys are overwritten.
 */
export interface IdempotencySnapshot {
  turn: number
  aiReply: string
  slotPickerNext: boolean
}

export async function recordIdempotencySnapshot(
  db: D1Database,
  params: {
    conversationId: string
    entityId: string
    idempotencyKey: string
    turn: number
    aiReply: string
    slotPickerNext: boolean
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO intake_conversation_meta
         (conversation_id, entity_id, last_idempotency_key, last_turn,
          last_ai_reply, last_slot_picker_next, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(conversation_id) DO UPDATE
         SET last_idempotency_key = excluded.last_idempotency_key,
             last_turn = excluded.last_turn,
             last_ai_reply = excluded.last_ai_reply,
             last_slot_picker_next = excluded.last_slot_picker_next,
             updated_at = datetime('now')`
    )
    .bind(
      params.conversationId,
      params.entityId,
      params.idempotencyKey,
      params.turn,
      params.aiReply,
      params.slotPickerNext ? 1 : 0
    )
    .run()
}

export async function lookupIdempotencySnapshot(
  db: D1Database,
  conversationId: string,
  idempotencyKey: string
): Promise<IdempotencySnapshot | null> {
  const row = await db
    .prepare(
      `SELECT last_turn, last_ai_reply, last_slot_picker_next
         FROM intake_conversation_meta
         WHERE conversation_id = ? AND last_idempotency_key = ?
           AND last_ai_reply IS NOT NULL`
    )
    .bind(conversationId, idempotencyKey)
    .first<{ last_turn: number; last_ai_reply: string; last_slot_picker_next: number }>()
  if (!row) return null
  return {
    turn: row.last_turn,
    aiReply: row.last_ai_reply,
    slotPickerNext: row.last_slot_picker_next === 1,
  }
}
