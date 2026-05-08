import type { APIContext, APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { ORG_ID } from '../../../lib/constants'
import { rateLimitByIp } from '../../../lib/booking/rate-limit'
import {
  generateConversationReply,
  ConversationApiError,
  postProcessReply,
  detectAndStripReadyMarker,
} from '../../../lib/claude/conversation'
import {
  appendUserTurn,
  appendAssistantTurn,
  countUserTurns,
  loadConversationHistory,
  MAX_TURNS,
  markConversationClosed,
  isConversationClosed,
  setInFlight,
  clearInFlight,
  isInFlight,
  recordIdempotencySnapshot,
  lookupIdempotencySnapshot,
} from '../../../lib/db/intake-conversations'
import {
  verifyConversationToken,
  readConversationCookie,
  signConversationToken,
  buildConversationCookieHeader,
  DEFAULT_CONVERSATION_TTL_SECONDS,
} from '../../../lib/booking/conversation-token'

/**
 * POST /api/intake/continue
 *
 * Two shapes share this endpoint:
 *
 *   - Continue:  { message, idempotency_key? }    — append a user turn,
 *                                                   call Claude, persist
 *                                                   the AI reply, return
 *                                                   it. Same idempotency
 *                                                   key on a retry replays
 *                                                   the previous result
 *                                                   without duplicating
 *                                                   the user turn.
 *
 *   - Close:     { closed: true }                 — V3 "Done" button.
 *                                                   Marks the conversation
 *                                                   closed (idempotent).
 *                                                   Returns 409 if an
 *                                                   assistant turn is
 *                                                   currently in flight.
 *
 * The conversation lives in the existing `context` table with V2 turn
 * sources. Per-conversation flags (closed_at, in_flight_until,
 * last-turn idempotency snapshot) live in `intake_conversation_meta`
 * (migration 0037).
 *
 * Response (continue, 200):
 *   { ok, ai_reply, turn, can_continue, slot_picker_next }
 *
 * Response (close, 200):
 *   { ok: true, closed: true }
 *
 * Response (close, 409):
 *   { error: 'in_flight' }   — retry once the in-flight turn lands
 *
 * Other responses unchanged from V2:
 *   401 unauthorized | session_expired
 *   400 validation_failed | invalid JSON
 *   429 rate_limited
 *   503 ai_unavailable
 *
 * Cookie is rotated on every successful continue turn so the TTL slides
 * forward with active engagement. Close does not rotate the cookie —
 * the conversation is over.
 *
 * ## Slot-picker readiness
 *
 * The response field `slot_picker_next` tells the client to render the
 * slot picker as the NEXT assistant turn. Two paths set it:
 *
 *   - AI marker: the system prompt instructs the model to emit
 *     `[[READY-FOR-CALL]]` on its own line when the prospect has shared
 *     enough signal. The server strips the marker before persistence
 *     and display.
 *   - Ceiling: at `user_turns >= READINESS_CEILING_TURNS` (default 4),
 *     the picker fires regardless of marker. Tire-kicker safety net
 *     and high-signal prospects who didn't trip the marker.
 */

const MAX_MESSAGE_CHARS = 5000
/** /continue is generous because each conversation can produce up to MAX_TURNS hits per user. */
const RATE_LIMIT_PER_HOUR = 60
/** AI-marker fast path; ceiling is the floor for offering the picker. */
const READINESS_CEILING_TURNS = 4

interface ValidatedContinueBody {
  kind: 'continue'
  messageRaw: string
  idempotencyKey: string | null
}
interface ValidatedCloseBody {
  kind: 'close'
}
type ValidatedBody = ValidatedContinueBody | ValidatedCloseBody

function validateBody(body: Record<string, unknown>): ValidatedBody | Response {
  if (body.closed === true) {
    return { kind: 'close' }
  }
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) {
    return jsonResponse(400, {
      error: 'validation_failed',
      message: 'Message is required.',
    })
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return jsonResponse(400, {
      error: 'validation_failed',
      message: `Your message is too long (max ${MAX_MESSAGE_CHARS} characters).`,
    })
  }
  const idempotencyKey =
    typeof body.idempotency_key === 'string' && body.idempotency_key.length > 0
      ? body.idempotency_key.slice(0, 128)
      : null
  return { kind: 'continue', messageRaw: message, idempotencyKey }
}

/**
 * Design notes for the auth + idempotency posture on /continue:
 *
 *   - Turn numbers are computed server-side (`countUserTurns + 1`) rather
 *     than supplied by the client.
 *
 *   - V3 adds an optional client-supplied `idempotency_key` for the
 *     Retry-after-network-failure case. If a previous POST with the
 *     same key reached the server and persisted, the snapshot row
 *     replays the AI reply. If the key is absent, the legacy V2 posture
 *     applies (best-effort dedup; double-submits are rare at this
 *     scale).
 *
 *   - The `rendered_at` bot check that /api/intake/send enforces is
 *     deliberately absent here. The cookie's existence proves the
 *     prospect already cleared the bot gate when they submitted /send.
 */
async function authConversationCookie(
  request: Request
): Promise<{ conversationId: string; entityId: string } | Response> {
  const token = readConversationCookie(request)
  if (!token) {
    return jsonResponse(401, { error: 'unauthorized', message: 'No conversation in progress.' })
  }
  const verify = await verifyConversationToken(token)
  if (!verify.ok) {
    const which = verify.error === 'expired' ? 'session_expired' : 'unauthorized'
    return jsonResponse(401, { error: which })
  }
  return { conversationId: verify.payload.conversation_id, entityId: verify.payload.entity_id }
}

async function callClaudeForTurn(
  entityId: string,
  conversationId: string,
  userMessage: string
): Promise<{ aiReply: string } | Response> {
  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[api/intake/continue] ANTHROPIC_API_KEY not configured')
    return jsonResponse(503, { error: 'ai_unavailable' })
  }
  const fullHistory = await loadConversationHistory(env.DB, entityId, conversationId)
  // The just-persisted user turn sits at the end of fullHistory; Claude's
  // messages[] expects the new user turn as the prompt and prior turns
  // as history.
  const historyForClaude = fullHistory.slice(0, -1)
  try {
    const aiReply = await generateConversationReply(apiKey, userMessage, historyForClaude)
    return { aiReply }
  } catch (err) {
    if (err instanceof ConversationApiError) {
      console.error('[api/intake/continue] Claude API error:', err.message, {
        status: err.statusCode,
        body: err.responseBody?.slice(0, 500),
      })
    } else {
      console.error('[api/intake/continue] Unexpected Claude error:', err)
    }
    return jsonResponse(503, { error: 'ai_unavailable' })
  }
}

async function handleClose(args: { conversationId: string; entityId: string }): Promise<Response> {
  // Reject Done while an assistant turn is mid-generation. The client
  // suppresses the close button briefly and lets the in-flight turn
  // land before sending Done.
  if (await isInFlight(env.DB, args.conversationId)) {
    return jsonResponse(409, { error: 'in_flight' })
  }
  await markConversationClosed(env.DB, {
    conversationId: args.conversationId,
    entityId: args.entityId,
  })
  return jsonResponse(200, { ok: true, closed: true })
}

async function persistUserTurnSafe(args: {
  entityId: string
  conversationId: string
  turn: number
  content: string
}): Promise<Response | null> {
  try {
    await appendUserTurn(env.DB, ORG_ID, args)
    return null
  } catch (err) {
    console.error('[api/intake/continue] User turn append failed:', err)
    return jsonResponse(500, { error: 'Internal server error' })
  }
}

async function callClaudeWithInFlight(args: {
  entityId: string
  conversationId: string
  messageRaw: string
}): Promise<{ aiReply: string } | Response> {
  await setInFlight(env.DB, { conversationId: args.conversationId, entityId: args.entityId })
  try {
    return await callClaudeForTurn(args.entityId, args.conversationId, args.messageRaw)
  } finally {
    await clearInFlight(env.DB, args.conversationId).catch(() => undefined)
  }
}

async function persistAssistantAndSnapshot(args: {
  conversationId: string
  entityId: string
  turn: number
  cleanReply: string
  slotPickerNext: boolean
  idempotencyKey: string | null
}): Promise<void> {
  try {
    await appendAssistantTurn(env.DB, ORG_ID, {
      entityId: args.entityId,
      conversationId: args.conversationId,
      turn: args.turn,
      content: args.cleanReply,
    })
  } catch (err) {
    console.error('[api/intake/continue] AI turn append failed:', err)
    // Reply was generated; persistence loss is non-fatal for the response.
  }

  if (args.idempotencyKey) {
    await recordIdempotencySnapshot(env.DB, {
      conversationId: args.conversationId,
      entityId: args.entityId,
      idempotencyKey: args.idempotencyKey,
      turn: args.turn,
      aiReply: args.cleanReply,
      slotPickerNext: args.slotPickerNext,
    }).catch((err) => {
      console.error('[api/intake/continue] Idempotency snapshot write failed:', err)
    })
  }
}

async function handleContinue(args: {
  conversationId: string
  entityId: string
  messageRaw: string
  idempotencyKey: string | null
}): Promise<Response> {
  const { conversationId, entityId, messageRaw, idempotencyKey } = args

  if (await isConversationClosed(env.DB, conversationId)) {
    return jsonResponse(401, { error: 'unauthorized', message: 'Conversation already closed.' })
  }

  if (idempotencyKey) {
    const snap = await lookupIdempotencySnapshot(env.DB, conversationId, idempotencyKey)
    if (snap) {
      return buildContinueResponse({
        conversationId,
        entityId,
        turn: snap.turn,
        aiReply: snap.aiReply,
        slotPickerNext: snap.slotPickerNext,
      })
    }
  }

  const priorUserTurns = await countUserTurns(env.DB, entityId, conversationId)
  if (priorUserTurns >= MAX_TURNS) {
    return jsonResponse(200, {
      ok: true,
      ai_reply: null,
      turn: priorUserTurns,
      can_continue: false,
      slot_picker_next: true,
      message: 'turn_cap_reached',
    })
  }
  const turn = priorUserTurns + 1

  const userTurnError = await persistUserTurnSafe({
    entityId,
    conversationId,
    turn,
    content: messageRaw,
  })
  if (userTurnError) return userTurnError

  const claudeResult = await callClaudeWithInFlight({ entityId, conversationId, messageRaw })
  if (claudeResult instanceof Response) return claudeResult

  const { reply: cleanReply, ready: markerReady } = detectAndStripReadyMarker(claudeResult.aiReply)
  postProcessReply(cleanReply, {
    endpoint: 'api/intake/continue',
    entityId,
    conversationId,
    turn,
  })

  const slotPickerNext = markerReady || turn >= READINESS_CEILING_TURNS
  await persistAssistantAndSnapshot({
    conversationId,
    entityId,
    turn,
    cleanReply,
    slotPickerNext,
    idempotencyKey,
  })

  return buildContinueResponse({
    conversationId,
    entityId,
    turn,
    aiReply: cleanReply,
    slotPickerNext,
  })
}

async function handlePost({ request, clientAddress }: APIContext): Promise<Response> {
  const auth = await authConversationCookie(request)
  if (auth instanceof Response) return auth
  const { conversationId, entityId } = auth

  const rateResult = await rateLimitByIp(
    env.BOOKING_CACHE,
    'intake_continue',
    clientAddress,
    RATE_LIMIT_PER_HOUR
  )
  if (!rateResult.allowed) {
    return jsonResponse(429, {
      error: 'rate_limited',
      message: 'Too many messages. Please wait a moment.',
    })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' })
  }
  const validated = validateBody(body)
  if (validated instanceof Response) return validated

  if (validated.kind === 'close') {
    return handleClose({ conversationId, entityId })
  }

  return handleContinue({
    conversationId,
    entityId,
    messageRaw: validated.messageRaw,
    idempotencyKey: validated.idempotencyKey,
  })
}

async function buildContinueResponse(args: {
  conversationId: string
  entityId: string
  turn: number
  aiReply: string
  slotPickerNext: boolean
}): Promise<Response> {
  const newToken = await signConversationToken({
    conversation_id: args.conversationId,
    entity_id: args.entityId,
  })
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Set-Cookie': buildConversationCookieHeader(newToken, DEFAULT_CONVERSATION_TTL_SECONDS),
  }
  return new Response(
    JSON.stringify({
      ok: true,
      ai_reply: args.aiReply,
      turn: args.turn,
      can_continue: args.turn < MAX_TURNS,
      slot_picker_next: args.slotPickerNext,
    }),
    { status: 200, headers }
  )
}

export const POST: APIRoute = (ctx) => handlePost(ctx)

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
