import type { APIContext, APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { ORG_ID } from '../../../lib/constants'
import { rateLimitByIp } from '../../../lib/booking/rate-limit'
import { processIntakeSubmission } from '../../../lib/booking/intake-core'
import { generateConversationReply, ConversationApiError } from '../../../lib/claude/conversation'
import { appendUserTurn, appendAssistantTurn } from '../../../lib/db/intake-conversations'
import {
  signConversationToken,
  buildConversationCookieHeader,
  DEFAULT_CONVERSATION_TTL_SECONDS,
} from '../../../lib/booking/conversation-token'
import { sendEmail } from '../../../lib/email/resend'
import { buildAdminUrl } from '../../../lib/config/app-url'

const NOTIFY_EMAIL = 'team@smd.services'
const RATE_LIMIT_PER_HOUR = 10
const MAX_MESSAGE_CHARS = 5000

/**
 * POST /api/intake/send
 *
 * The first turn of the unified /book intake conversation. Captures
 * identity fields and the prospect's free-text "tell us about your
 * business" message, persists the lead, generates the AI's first reply,
 * and issues a signed conversation cookie so subsequent
 * `/api/intake/continue` posts can authenticate as this conversation.
 *
 * Security: render-timestamp check + IP rate limiting (10/hour) +
 * HMAC-signed cookie binding conversation_id to entity_id (see
 * src/lib/booking/conversation-token.ts). Cloudflare zone-level Bot
 * Fight Mode runs at the edge before requests reach this Worker.
 *
 * The previous offscreen `<input name="website_url">` honeypot was visible to
 * Chrome's autofill classifier and suppressed autofill suggestions on the
 * named identity fields (the offscreen positioning lived on the parent div,
 * so to Chrome the input was a normal visible text field). Switched to a
 * render-timestamp check: client captures Date.now() at form-script-execute
 * time and sends `rendered_at`. Submissions under 2 seconds old are treated
 * as bot-driven (200 silent OK so the bot thinks it succeeded). Real users
 * take 30+ seconds to fill the form, easily clearing the threshold.
 */
const MIN_FORM_FILL_MS = 2000

interface ValidatedSendBody {
  name: string
  email: string
  businessName: string
  phone: string
  website: string | null
  messageRaw: string
}

function validateSendBody(body: Record<string, unknown>): ValidatedSendBody | Response {
  const name = trimString(body.name)
  const email = trimString(body.email)
  const businessName = trimString(body.business_name)
  const phone = trimString(body.phone)

  const fieldErrors: Record<string, string> = {}
  if (!name) fieldErrors.name = 'Name is required.'
  if (!email) fieldErrors.email = 'Email is required.'
  else if (!isValidEmail(email)) fieldErrors.email = 'Email looks invalid.'
  if (!businessName) fieldErrors.business_name = 'Business name is required.'
  if (!phone) fieldErrors.phone = 'Phone is required.'

  if (Object.keys(fieldErrors).length > 0) {
    return jsonResponse(400, {
      error: 'validation_failed',
      message: 'Some required fields are missing.',
      field_errors: fieldErrors,
    })
  }

  const messageRaw = typeof body.message === 'string' ? body.message.trim() : ''
  if (messageRaw.length > MAX_MESSAGE_CHARS) {
    return jsonResponse(400, {
      error: 'validation_failed',
      message: `Your message is too long (max ${MAX_MESSAGE_CHARS} characters).`,
    })
  }

  return {
    name: name!,
    email: email!,
    businessName: businessName!,
    phone: phone!,
    website: trimString(body.website),
    messageRaw,
  }
}

/**
 * Generate the AI's reply to the prospect's first message and persist
 * both the user turn and the AI turn against the V2 conversation. Returns
 * the AI reply text (or null if generation failed or message was empty).
 */
async function generateAndPersistFirstTurn(
  entityId: string,
  conversationId: string,
  messageRaw: string
): Promise<string | null> {
  if (!messageRaw) return null

  // Persist user turn 1 first so the conversation history is complete
  // even if Claude errors out. The admin can still see what they wrote.
  try {
    await appendUserTurn(env.DB, ORG_ID, {
      entityId,
      conversationId,
      turn: 1,
      content: messageRaw,
    })
  } catch (ctxErr) {
    console.error('[api/intake/send] User turn 1 append failed:', ctxErr)
  }

  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[api/intake/send] ANTHROPIC_API_KEY not configured')
    return null
  }
  try {
    const aiReply = await generateConversationReply(apiKey, messageRaw, [])
    try {
      await appendAssistantTurn(env.DB, ORG_ID, {
        entityId,
        conversationId,
        turn: 1,
        content: aiReply,
      })
    } catch (ctxErr) {
      console.error('[api/intake/send] AI turn 1 append failed:', ctxErr)
    }
    return aiReply
  } catch (err) {
    if (err instanceof ConversationApiError) {
      console.error('[api/intake/send] Claude API error:', err.message, {
        status: err.statusCode,
        body: err.responseBody?.slice(0, 500),
      })
    } else {
      console.error('[api/intake/send] Unexpected Claude error:', err)
    }
    return null
  }
}

async function handlePost({ request, clientAddress }: APIContext): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' })
  }

  const renderedAt = typeof body.rendered_at === 'number' ? body.rendered_at : NaN
  if (!Number.isFinite(renderedAt) || Date.now() - renderedAt < MIN_FORM_FILL_MS) {
    return jsonResponse(200, { ok: true })
  }

  const rateResult = await rateLimitByIp(
    env.BOOKING_CACHE,
    'intake_send',
    clientAddress,
    RATE_LIMIT_PER_HOUR
  )
  if (!rateResult.allowed) {
    return jsonResponse(429, { error: 'Too many submissions. Please try again later.' })
  }

  const validated = validateSendBody(body)
  if (validated instanceof Response) return validated

  let intakeResult: Awaited<ReturnType<typeof processIntakeSubmission>>
  try {
    intakeResult = await processIntakeSubmission(
      env.DB,
      ORG_ID,
      {
        name: validated.name,
        email: validated.email,
        businessName: validated.businessName,
        phone: validated.phone,
        website: validated.website,
        userMessage: validated.messageRaw || null,
      },
      { source: 'website_intake_send' }
    )
  } catch (err) {
    console.error('[api/intake/send] processIntakeSubmission failed:', err)
    return jsonResponse(500, { error: 'Internal server error' })
  }

  const conversationId = crypto.randomUUID()
  const aiReply = await generateAndPersistFirstTurn(
    intakeResult.entityId,
    conversationId,
    validated.messageRaw
  )

  try {
    await sendAdminNotification(env, {
      ...validated,
      aiReply,
      entityId: intakeResult.entityId,
      message: validated.messageRaw,
    })
  } catch (emailErr) {
    console.error('[api/intake/send] Admin notification failed:', emailErr)
  }

  // Issue a signed conversation cookie so /api/intake/continue can
  // authenticate follow-up turns. Only set the cookie when we actually
  // started a conversation (i.e. there was a non-empty message that
  // produced an AI reply).
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (aiReply) {
    const token = await signConversationToken({
      conversation_id: conversationId,
      entity_id: intakeResult.entityId,
    })
    headers['Set-Cookie'] = buildConversationCookieHeader(token, DEFAULT_CONVERSATION_TTL_SECONDS)
  }

  return new Response(
    JSON.stringify({
      ok: true,
      entity_id: intakeResult.entityId,
      ai_reply: aiReply,
      can_continue: aiReply !== null,
    }),
    { status: 200, headers }
  )
}

export const POST: APIRoute = (ctx) => handlePost(ctx)

interface AdminNotificationParams {
  name: string
  email: string
  businessName: string
  phone: string
  website: string | null
  message: string
  aiReply: string | null
  entityId: string
}

async function sendAdminNotification(
  workerEnv: typeof env,
  params: AdminNotificationParams
): Promise<void> {
  const adminUrl = buildAdminUrl(workerEnv, `/admin/entities/${params.entityId}`)
  const escapedName = escapeHtml(params.name)
  const escapedEmail = escapeHtml(params.email)
  const escapedBusiness = escapeHtml(params.businessName)
  const escapedPhone = escapeHtml(params.phone)
  const escapedWebsite = params.website ? escapeHtml(params.website) : null
  const escapedMessage = params.message ? escapeHtml(params.message) : null
  const escapedAiReply = params.aiReply ? escapeHtml(params.aiReply) : null

  const html = [
    `<p><strong>${escapedName}</strong> &lt;${escapedEmail}&gt; from <strong>${escapedBusiness}</strong> sent a message via the Send path on /book.</p>`,
    `<p>Phone: ${escapedPhone}</p>`,
    escapedWebsite ? `<p>Website: <a href="${escapedWebsite}">${escapedWebsite}</a></p>` : '',
    '<hr>',
    escapedMessage
      ? `<p><strong>What they wrote:</strong></p><blockquote>${escapedMessage.replace(/\n/g, '<br>')}</blockquote>`
      : '<p><em>No message — they submitted just contact info.</em></p>',
    escapedAiReply
      ? `<p><strong>AI follow-up sent back to them:</strong></p><blockquote>${escapedAiReply.replace(/\n/g, '<br>')}</blockquote>`
      : '',
    '<hr>',
    `<p><a href="${adminUrl}">View in admin →</a></p>`,
  ]
    .filter(Boolean)
    .join('')

  await sendEmail(workerEnv.RESEND_API_KEY, {
    to: NOTIFY_EMAIL,
    reply_to: params.email,
    subject: `[Send-path lead] ${params.businessName}`,
    html,
  })
}

function trimString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isValidEmail(email: string): boolean {
  if (email.length > 254) return false
  const parts = email.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts
  if (!local || !domain) return false
  if (domain.indexOf('.') === -1) return false
  return true
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
