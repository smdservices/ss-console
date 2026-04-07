import type { APIRoute } from 'astro'
import { findOrCreateEntity } from '../../../lib/db/entities'
import { appendContext } from '../../../lib/db/context'
import { createContact } from '../../../lib/db/contacts'
import { createAssessment } from '../../../lib/db/assessments'
import { sendEmail } from '../../../lib/email/resend'
import { ORG_ID } from '../../../lib/constants'

const NOTIFY_EMAIL = 'team@smd.services'

/**
 * POST /api/booking/intake
 *
 * Public endpoint for the post-booking intake form. Creates a client,
 * contact, and scheduled assessment from prospect-submitted data.
 *
 * Security:
 * - Honeypot field rejects bot submissions silently
 * - Email dedup prevents double-submit from creating duplicate records
 * - No auth required (prospect-facing)
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env

  // Parse JSON body
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' })
  }

  // Honeypot check — bots fill this hidden field, humans don't
  if (typeof body.website_url === 'string' && body.website_url.trim() !== '') {
    return jsonResponse(200, { ok: true })
  }

  // Validate required fields
  const name = trimString(body.name)
  const email = trimString(body.email)
  const businessName = trimString(body.business_name)

  if (!name || !email || !businessName) {
    return jsonResponse(400, { error: 'name, email, and business_name are required' })
  }

  // Optional fields
  const vertical = trimString(body.vertical) || null
  const employeeCount =
    typeof body.employee_count === 'string' ? parseInt(body.employee_count, 10) || null : null
  const yearsInBusiness =
    typeof body.years_in_business === 'string' ? parseInt(body.years_in_business, 10) || null : null
  const biggestChallenge = trimString(body.biggest_challenge)
  const howHeard = trimString(body.how_heard)

  try {
    // Find or create entity record (dedup is by business name slug)
    const { entity } = await findOrCreateEntity(env.DB, ORG_ID, {
      name: businessName,
      stage: 'prospect',
      source_pipeline: 'website_booking',
    })

    // Append intake data as context — every submission gets recorded,
    // even from repeat submitters, so we don't lose new information.
    const intakeParts: string[] = []
    if (vertical) intakeParts.push(`Vertical: ${vertical}`)
    if (employeeCount) intakeParts.push(`Employees: ${employeeCount}`)
    if (yearsInBusiness) intakeParts.push(`Years in business: ${yearsInBusiness}`)
    if (biggestChallenge) intakeParts.push(`What they're trying to accomplish: ${biggestChallenge}`)
    if (howHeard) intakeParts.push(`How they found us: ${howHeard}`)

    if (intakeParts.length > 0) {
      await appendContext(env.DB, ORG_ID, {
        entity_id: entity.id,
        type: 'intake',
        content: intakeParts.join('\n'),
        source: 'website_booking',
        metadata: {
          name,
          email,
          vertical,
          employee_count: employeeCount,
          years_in_business: yearsInBusiness,
          biggest_challenge: biggestChallenge,
          how_heard: howHeard,
        },
      })
    }

    // Create contact only if one with this email doesn't already exist
    // for this entity. Repeat submissions update context but don't duplicate
    // contact rows.
    const existingContact = await env.DB.prepare(
      'SELECT id FROM contacts WHERE org_id = ? AND email = ? LIMIT 1'
    )
      .bind(ORG_ID, email)
      .first<{ id: string }>()

    if (!existingContact) {
      await createContact(env.DB, ORG_ID, entity.id, { name, email })
    }

    // Create assessment record (status defaults to 'scheduled')
    await createAssessment(env.DB, ORG_ID, entity.id, {})

    // Notify the team — fire and forget, don't block the response
    try {
      const escapedName = escapeHtml(name)
      const escapedEmail = escapeHtml(email)
      const escapedBusiness = escapeHtml(businessName)
      const detailLines = intakeParts.map((line) => `<p>${escapeHtml(line)}</p>`).join('')

      await sendEmail(env.RESEND_API_KEY, {
        to: NOTIFY_EMAIL,
        reply_to: email,
        subject: `New booking intake: ${businessName}`,
        html:
          `<p><strong>${escapedName}</strong> &lt;${escapedEmail}&gt; from <strong>${escapedBusiness}</strong> just booked a call and submitted the intake form.</p>` +
          `<hr>${detailLines}` +
          `<hr><p><a href="https://smd.services/admin/entities/${entity.id}">View in admin →</a></p>`,
      })
    } catch (emailErr) {
      // Email failure should not block the response
      console.error('[api/booking/intake] Notification email error:', emailErr)
    }

    return jsonResponse(201, { ok: true, client_id: entity.id })
  } catch (err) {
    console.error('[api/booking/intake] Error:', err)
    return jsonResponse(500, { error: 'Internal server error' })
  }
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
