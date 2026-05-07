import type { APIContext, APIRoute } from 'astro'
import { processIntakeSubmission } from '../../lib/booking/intake-core'
import { rateLimitByIp } from '../../lib/booking/rate-limit'
import { sendEmail } from '../../lib/email/resend'
import { ORG_ID } from '../../lib/constants'
import { buildAdminUrl } from '../../lib/config/app-url'
import { env } from 'cloudflare:workers'

const NOTIFY_EMAIL = 'team@smd.services'
const RATE_LIMIT = 5

/**
 * POST /api/intake
 *
 * Standalone intake endpoint — prospects share business info without
 * booking a call. Lower commitment than /api/booking/reserve.
 *
 * Creates entity + contact + context (no assessment — that happens when
 * a call is actually scheduled). Sends admin notification.
 *
 * Security: honeypot + IP rate limiting (5/hour). Cloudflare zone-level
 * Bot Fight Mode runs at the edge before requests reach this Worker.
 */
interface ValidatedIntake {
  name: string
  email: string
  businessName: string
  biggestChallenge: string
  vertical: string | null
  employeeCount: number | null
  yearsInBusiness: number | null
  howHeard: string | null
}

function validateIntakeBody(body: Record<string, unknown>): ValidatedIntake | Response {
  const name = trimString(body.name)
  const email = trimString(body.email)
  const businessName = trimString(body.business_name)
  const biggestChallenge = trimString(body.biggest_challenge)

  if (!name || !email || !businessName || !biggestChallenge) {
    return jsonResponse(400, {
      error: 'name, email, business_name, and biggest_challenge are required',
    })
  }
  if (!isValidEmail(email)) {
    return jsonResponse(400, { error: 'Invalid email address' })
  }

  const ecRaw = trimString(body.employee_count) || null
  const yibRaw = trimString(body.years_in_business) || null
  return {
    name,
    email,
    businessName,
    biggestChallenge,
    vertical: trimString(body.vertical) || null,
    employeeCount: ecRaw ? parseInt(ecRaw, 10) || null : null,
    yearsInBusiness: yibRaw ? parseInt(yibRaw, 10) || null : null,
    howHeard: trimString(body.how_heard),
  }
}

async function notifyTeam(
  validated: ValidatedIntake,
  entityId: string,
  intakeLines: string[]
): Promise<void> {
  try {
    const escapedName = escapeHtml(validated.name)
    const escapedEmail = escapeHtml(validated.email)
    const escapedBusiness = escapeHtml(validated.businessName)
    const detailLines = intakeLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
    await sendEmail(env.RESEND_API_KEY, {
      to: NOTIFY_EMAIL,
      reply_to: validated.email,
      subject: `New inquiry: ${validated.businessName}`,
      html:
        `<p><strong>${escapedName}</strong> &lt;${escapedEmail}&gt; from <strong>${escapedBusiness}</strong> shared info about their business (no call scheduled yet).</p>` +
        `<hr>${detailLines}` +
        `<hr><p><a href="${buildAdminUrl(env, `/admin/entities/${entityId}`)}">View in admin →</a></p>`,
    })
  } catch (emailErr) {
    console.error('[api/intake] Notification email error:', emailErr)
  }
}

async function handlePost({ request, clientAddress }: APIContext): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' })
  }

  // Honeypot check — bots fill this hidden field, humans don't
  if (typeof body.website_url === 'string' && body.website_url.trim() !== '') {
    return jsonResponse(200, { ok: true })
  }

  const rateResult = await rateLimitByIp(env.BOOKING_CACHE, 'intake', clientAddress, RATE_LIMIT)
  if (!rateResult.allowed) {
    return jsonResponse(429, { error: 'Too many submissions. Please try again later.' })
  }

  const validated = validateIntakeBody(body)
  if (validated instanceof Response) return validated

  try {
    const result = await processIntakeSubmission(
      env.DB,
      ORG_ID,
      {
        name: validated.name,
        email: validated.email,
        businessName: validated.businessName,
        vertical: validated.vertical,
        employeeCount: validated.employeeCount,
        yearsInBusiness: validated.yearsInBusiness,
        biggestChallenge: validated.biggestChallenge,
        howHeard: validated.howHeard,
      },
      { source: 'website_intake' }
    )
    await notifyTeam(validated, result.entityId, result.intakeLines)
    return jsonResponse(201, { ok: true })
  } catch (err) {
    console.error('[api/intake] Error:', err)
    return jsonResponse(500, { error: 'Internal server error' })
  }
}

export const POST: APIRoute = (ctx) => handlePost(ctx)

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

function trimString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function jsonResponse(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
