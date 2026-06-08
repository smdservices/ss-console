/**
 * POST /api/assessment/turn
 *
 * One turn of the live web assessment (ADR 0039 node [1]). Body:
 *   { turns: { speaker: 'owner' | 'operator', text: string }[], session?: string }
 *
 * The opening request sends an empty `turns` array and no `session`; the
 * response mints a signed session token (`{ message, done, session }`) that the
 * client must echo on every subsequent turn. Returns:
 *   { message: string, done: boolean, session?: string }
 *
 * Public surface, hardened for ad traffic (2026-06-08 code review). Two layers:
 *
 *   1. IP rate limit (cheap, sheds volume) — `rateLimitByIp`.
 *   2. Signed session + server-side per-session turn/cost ceiling — defeats
 *      IP-rotation budget exhaustion, which the IP limit alone cannot. See
 *      `src/lib/assessment/session.ts` for the threat model and design.
 *
 * Fails closed: a non-opening turn with a missing / malformed / expired /
 * forged session token is refused before any LLM call.
 */

import type { APIContext, APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { assessmentTurn, type Turn } from '../../../lib/claude/assessment'
import { rateLimitByIp } from '../../../lib/booking/rate-limit'
import {
  consumeSessionTurn,
  issueAssessmentSession,
  verifyAssessmentSession,
} from '../../../lib/assessment/session'

const RATE_LIMIT_PER_HOUR = 200
const MAX_TURNS = 60
const MAX_TURN_CHARS = 4000

/** Parsed, validated request: the turns array plus the optional session token. */
export interface ParsedTurnRequest {
  turns: Turn[]
  /** Present once the opening turn has issued a session; absent on the opener. */
  session: string | null
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Narrow one array element into a `Turn`, or null if it is not a valid turn. */
function parseTurn(item: unknown): Turn | null {
  if (typeof item !== 'object' || item === null) return null
  const speaker = (item as { speaker?: unknown }).speaker
  const text = (item as { text?: unknown }).text
  if (speaker !== 'owner' && speaker !== 'operator') return null
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TURN_CHARS) return null
  return { speaker, text }
}

/**
 * Narrow the optional session token. Absent/null is valid (the opening turn
 * carries none); a non-empty string is the token; anything else is malformed.
 * Returns `{ ok: false }` rather than a sentinel string so a valid token that
 * happened to equal a sentinel can't be confused with an error.
 */
function parseSession(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false }
  return { ok: true, value: raw }
}

/**
 * Parse + validate the request body. Never casts — every field is narrowed
 * from `unknown`. Returns null on any malformed input (callers map that to 400).
 */
export function parseTurnRequest(body: unknown): ParsedTurnRequest | null {
  if (typeof body !== 'object' || body === null) return null

  const raw = (body as { turns?: unknown }).turns
  if (!Array.isArray(raw) || raw.length > MAX_TURNS) return null

  const turns: Turn[] = []
  for (const item of raw) {
    const turn = parseTurn(item)
    if (turn === null) return null
    turns.push(turn)
  }

  const session = parseSession((body as { session?: unknown }).session)
  if (!session.ok) return null

  return { turns, session: session.value }
}

/** An opening turn carries no prior history. */
function isOpeningTurn(req: ParsedTurnRequest): boolean {
  return req.turns.length === 0
}

export const POST: APIRoute = async ({ request, clientAddress }: APIContext) => {
  const rate = await rateLimitByIp(
    env.BOOKING_CACHE,
    'assessment_turn',
    clientAddress,
    RATE_LIMIT_PER_HOUR
  )
  if (!rate.allowed) return json(429, { error: 'Too many requests. Please slow down.' })

  if (!env.ANTHROPIC_API_KEY) return json(503, { error: 'Assessment is temporarily unavailable.' })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json(400, { error: 'Invalid JSON.' })
  }

  const parsed = parseTurnRequest(body)
  if (parsed === null) return json(400, { error: 'Invalid request.' })

  const opening = isOpeningTurn(parsed)

  // Continuing turns must present a valid signed session, and each one is
  // charged against the session's ceiling. Fail closed on every bad-token path.
  // This is the layer that survives IP rotation: the ceiling is bound to the
  // signed session, not the address.
  if (!opening) {
    if (parsed.session === null) {
      return json(401, { error: 'Missing assessment session. Please restart the assessment.' })
    }
    const verified = await verifyAssessmentSession(parsed.session)
    if (!verified.ok) {
      return json(401, { error: 'Your assessment session is no longer valid. Please restart.' })
    }
    const charge = await consumeSessionTurn(env.BOOKING_CACHE, verified.payload.sid)
    if (!charge.ok) {
      return json(429, {
        error: 'This assessment has reached its length limit. Please restart to continue.',
      })
    }
  }

  // Opening turn: mint the session that gates every turn after it. Minting
  // before the LLM call is fine — a session id is free; a failed opener just
  // leaves an unused id that self-expires from KV.
  let issuedSession: string | null = null
  if (opening) {
    const session = await issueAssessmentSession()
    issuedSession = session.token
  }

  try {
    const result = await assessmentTurn(env.ANTHROPIC_API_KEY, parsed.turns)
    return json(200, issuedSession ? { ...result, session: issuedSession } : result)
  } catch {
    return json(502, { error: 'The operator could not respond. Please try again.' })
  }
}
