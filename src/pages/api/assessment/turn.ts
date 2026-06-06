/**
 * POST /api/assessment/turn
 *
 * One turn of the live web assessment (ADR 0039 node [1]). Body:
 *   { turns: { speaker: 'owner' | 'operator', text: string }[] }
 * (empty `turns` requests the operator's opening message.)
 * Returns: { message: string, done: boolean } — the operator's next message,
 * with `done` true when the assessment is complete and findings can be drafted.
 *
 * Preview surface: unlinked, rate-limited, dogfood-only. Hardening for public
 * traffic (stronger abuse controls, persistence) is a follow-up before launch.
 */

import type { APIContext, APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { assessmentTurn, type Turn } from '../../../lib/claude/assessment'
import { rateLimitByIp } from '../../../lib/booking/rate-limit'

const RATE_LIMIT_PER_HOUR = 200
const MAX_TURNS = 60
const MAX_TURN_CHARS = 4000

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Parse + validate the request body into a turns array, or null if malformed. */
function parseTurns(body: unknown): Turn[] | null {
  if (typeof body !== 'object' || body === null) return null
  const raw = (body as { turns?: unknown }).turns
  if (!Array.isArray(raw) || raw.length > MAX_TURNS) return null
  const turns: Turn[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null
    const speaker = (item as { speaker?: unknown }).speaker
    const text = (item as { text?: unknown }).text
    if (speaker !== 'owner' && speaker !== 'operator') return null
    if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TURN_CHARS) return null
    turns.push({ speaker, text })
  }
  return turns
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

  const turns = parseTurns(body)
  if (turns === null) return json(400, { error: 'Invalid request.' })

  try {
    const result = await assessmentTurn(env.ANTHROPIC_API_KEY, turns)
    return json(200, result)
  } catch {
    return json(502, { error: 'The operator could not respond. Please try again.' })
  }
}
