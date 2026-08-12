import type { APIRoute } from 'astro'
import { createMagicLink, MAGIC_LINK_EXPIRY_MS } from '../../../lib/auth/magic-link'
import { ORG_ID } from '../../../lib/constants'
import { requirePortalBaseUrl } from '../../../lib/config/app-url'
import { sendEmail } from '../../../lib/email/resend'
import { buildMagicLinkUrl, magicLinkEmailHtml } from '../../../lib/email/templates'
import { rateLimitByIp } from '../../../lib/booking/rate-limit'
import { env } from 'cloudflare:workers'

interface UserRow {
  id: string
  org_id: string
  email: string
  name: string
  role: string
  entity_id: string | null
}

/**
 * POST /api/auth/magic-link
 *
 * Generates a magic link for the given email and sends it via Resend.
 * Only works for client-role users (not admin users).
 *
 * On success: redirects to portal login with status=sent.
 * On failure: redirects to portal login with appropriate error.
 *
 * Security: Always returns the same response whether or not the email
 * exists, to prevent email enumeration.
 */
export const POST: APIRoute = async ({ request, redirect }) => {
  try {
    // Rate limit: 5 requests/hour per IP — checked first, before any DB lookup
    const clientIp = request.headers.get('cf-connecting-ip') ?? undefined
    const rateLimitResult = await rateLimitByIp(env.BOOKING_CACHE, 'auth-magic', clientIp, 5)
    if (!rateLimitResult.allowed) {
      return redirect('/auth/sign-in?error=rate_limited', 302)
    }

    const formData = await request.formData()
    const email = formData.get('email')

    if (!email || typeof email !== 'string') {
      return redirect('/auth/sign-in?error=server', 302)
    }

    const normalizedEmail = email.toLowerCase().trim()
    // Look up the portal user in the current app org. Email is not globally
    // unique across organizations.
    //
    // The comparison must be case-insensitive IN SQL (issue #2282). Lowercasing
    // the input in JS is not enough: users.email carries no COLLATE NOCASE
    // (migrations/0001_create_tables.sql) and SQLite `=` is case-sensitive, so a
    // mixed-case STORED address could never match. Nobody controls the casing an
    // address is stored with — it arrives from an IdP, an invitation, or a human
    // typing it into the admin console — and email is treated case-insensitively
    // in practice. The miss was silent besides: a not-found deliberately returns
    // the same success redirect below (anti-enumeration), so the person was told
    // to check their email and nothing was ever sent. Same fix, same reason, as
    // src/lib/auth/clerk-bridge.ts:101.
    const user = await env.DB.prepare(
      `SELECT * FROM users WHERE org_id = ? AND lower(email) = lower(?) AND role = 'client'`
    )
      .bind(ORG_ID, normalizedEmail)
      .first<UserRow>()

    if (!user) {
      // Don't reveal whether the email exists — show same success message
      // This prevents email enumeration attacks
      return redirect('/auth/sign-in?status=sent', 302)
    }

    // Create magic link token (15-minute TTL for client login resend).
    const token = await createMagicLink(
      env.DB,
      {
        orgId: user.org_id,
        userId: user.id,
        email: normalizedEmail,
      },
      MAGIC_LINK_EXPIRY_MS
    )

    // Build the verification URL from the canonical PORTAL_BASE_URL.
    // Never derive from request host — see issue #173.
    const baseUrl = requirePortalBaseUrl(env)
    const magicLinkUrl = buildMagicLinkUrl(baseUrl, token)

    // Send the email
    const html = magicLinkEmailHtml(user.name, magicLinkUrl)
    const result = await sendEmail(env.RESEND_API_KEY, {
      to: normalizedEmail,
      subject: 'Sign in to your SMD Services portal',
      html,
    })

    if (!result.success) {
      console.error(
        '[magic-link] Failed to send portal invite (check Resend dashboard):',
        result.error
      )
      // Still show success to prevent enumeration
    }

    return redirect('/auth/sign-in?status=sent', 302)
  } catch (err) {
    console.error('[magic-link] Error:', err)
    return redirect('/auth/sign-in?error=server', 302)
  }
}
