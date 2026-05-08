import type { APIContext, APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { ORG_ID } from '../../../lib/constants'
import { rateLimitByIp } from '../../../lib/booking/rate-limit'
import {
  generateConversationReply,
  ConversationApiError,
  postProcessReply,
} from '../../../lib/claude/conversation'
import {
  appendUserTurn,
  appendAssistantTurn,
  countUserTurns,
  loadConversationHistory,
  MAX_TURNS,
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
 * Follow-up turn in a multi-turn intake conversation. The first turn is
 * established by `/api/intake/send`, which issues the signed
 * `ss_intake_conv` cookie. Each `/continue` POST verifies the cookie,
 * loads the conversation history, calls Claude with the full history,
 * persists the new user/assistant pair, and returns the AI reply.
 *
 * Request body:
 *   { message: string }    — the prospect's next message (1..MAX_MESSAGE_CHARS)
 *
 * Response:
 *   200 { ok, ai_reply, turn, can_continue }
 *   401 { error: 'session_expired' | 'unauthorized' }
 *   400 { error: 'validation_failed', message }
 *   429 { error: 'rate_limited' }
 *   503 { error: 'ai_unavailable' }      — Claude call failed; user turn was still persisted
 *
 * `can_continue` is false when the conversation has reached MAX_TURNS,
 * signaling the UI to surface the booking CTA as the next step.
 *
 * Cookie is rotated on every successful turn so the TTL slides forward
 * with active engagement.
 */

const MAX_MESSAGE_CHARS = 5000
/** /continue is generous because each conversation can produce up to MAX_TURNS hits per user. */
const RATE_LIMIT_PER_HOUR = 60

interface ValidatedContinueBody {
  messageRaw: string
}

function validateContinueBody(body: Record<string, unknown>): ValidatedContinueBody | Response {
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
  return { messageRaw: message }
}

/**
 * Design notes for the auth + idempotency posture on /continue:
 *
 *   - Turn numbers are computed server-side (`countUserTurns + 1`) rather
 *     than supplied by the client as an idempotency key. Intake is a
 *     low-stakes user-facing flow; the signed cookie + IP rate limit cap
 *     exposure to abuse, and accidental double-submits at this scale are
 *     a UX nuisance, not a data-integrity concern. For higher-stakes
 *     mutating endpoints (e.g. /api/booking/reserve) a client-supplied
 *     idempotency key would be expected.
 *
 *   - The `rendered_at` bot check that /api/intake/send enforces is
 *     deliberately absent here. The cookie's existence proves the
 *     prospect already cleared the bot gate when they submitted /send.
 *     Adding a second timestamp check would not improve security and
 *     would add a confusing failure mode if the prospect simply replied
 *     fast.
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
  const validated = validateContinueBody(body)
  if (validated instanceof Response) return validated

  const priorUserTurns = await countUserTurns(env.DB, entityId, conversationId)
  if (priorUserTurns >= MAX_TURNS) {
    return jsonResponse(200, {
      ok: true,
      ai_reply: null,
      turn: priorUserTurns,
      can_continue: false,
      message: 'turn_cap_reached',
    })
  }
  const turn = priorUserTurns + 1

  // Persist user turn first so admin sees what they wrote even if
  // Claude fails.
  try {
    await appendUserTurn(env.DB, ORG_ID, {
      entityId,
      conversationId,
      turn,
      content: validated.messageRaw,
    })
  } catch (err) {
    console.error('[api/intake/continue] User turn append failed:', err)
    return jsonResponse(500, { error: 'Internal server error' })
  }

  const claudeResult = await callClaudeForTurn(entityId, conversationId, validated.messageRaw)
  if (claudeResult instanceof Response) return claudeResult
  const { aiReply } = claudeResult
  postProcessReply(aiReply, {
    endpoint: 'api/intake/continue',
    entityId,
    conversationId,
    turn,
  })

  try {
    await appendAssistantTurn(env.DB, ORG_ID, {
      entityId,
      conversationId,
      turn,
      content: aiReply,
    })
  } catch (err) {
    console.error('[api/intake/continue] AI turn append failed:', err)
    // Reply was generated; persistence loss is non-fatal for the response.
  }

  return buildContinueResponse({ conversationId, entityId, turn, aiReply })
}

async function buildContinueResponse(args: {
  conversationId: string
  entityId: string
  turn: number
  aiReply: string
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
