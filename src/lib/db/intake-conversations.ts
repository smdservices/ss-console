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
