import type { APIRoute, APIContext } from 'astro'
import { clerkClient } from '@clerk/astro/server'
import { getPortalClient } from '../../../../../lib/portal/session'
import { getProductSubscription, listProductRoles } from '../../../../../lib/portal/product-access'
import type { PortalUserRow } from '../../../../../lib/auth/clerk-bridge'
import type { Entity } from '../../../../../lib/db/entities'
import { env } from 'cloudflare:workers'

/**
 * POST /api/portal/products/ai-employee/invitations
 *
 * Creates a Clerk Organization invitation. After the invitee accepts
 * and signs in for the first time, the JIT bridge (clerk-bridge.ts)
 * creates their local users row, and the principal returns to the
 * Users page to grant them a product role. Two-step UX intentionally
 * — pre-assigning roles via invitation metadata + webhook is deferred
 * to a future slice.
 *
 * Form fields:
 *   email: TEXT  — invitee email address
 *
 * Authorization (same as role-action):
 *   - Clerk session required (middleware)
 *   - Active AI Employee subscription on this entity
 *   - Caller holds the 'principal' role on (entity, 'ai-employee')
 *
 * Also requires that the entity has been bound to a Clerk Organization
 * (entities.clerk_org_id IS NOT NULL). If not bound yet, redirects
 * back with status=no_clerk_org so the principal sees a clear message.
 *
 * Clerk's Organization role for the invitation is hardcoded to
 * 'org:member'. Org-admin Clerk role is reserved for SMD-side
 * accounts. Product roles (principal | operator | compliance) are a
 * separate axis managed via role-action.ts after the invitee accepts.
 */

const PRODUCT_SLUG = 'ai-employee'
const USERS_PAGE_URL = '/portal/products/ai-employee/settings/users'

function redirectWithStatus(status: string): Response {
  const target = `${USERS_PAGE_URL}?status=${encodeURIComponent(status)}`
  return new Response(null, {
    status: 303,
    headers: { Location: target },
  })
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

interface AuthorizedContext {
  user: PortalUserRow
  client: Entity
}

async function authorize(locals: App.Locals): Promise<Response | AuthorizedContext> {
  const portalData = await getPortalClient(env.DB, locals)
  if (!portalData) return jsonError(401, 'Unauthorized')
  if (!portalData.client) return jsonError(403, 'Forbidden')

  const { user, client } = portalData
  const roles = await listProductRoles(env.DB, user.id, client.id, PRODUCT_SLUG)
  if (!roles.includes('principal')) return jsonError(403, 'Forbidden')

  const subscription = await getProductSubscription(env.DB, client.id, PRODUCT_SLUG)
  if (!subscription) return jsonError(404, 'No active subscription')

  return { user, client }
}

// RFC 5322-lite email check. Sufficient guard against accidental
// nonsense (the canonical validator is Clerk itself, which will
// reject malformed addresses with a clearer error).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseEmail(formData: FormData): string | null {
  const raw = formData.get('email')
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!EMAIL_RE.test(trimmed)) return null
  return trimmed
}

export const POST: APIRoute = async (context: APIContext) => {
  const ctxOrResponse = await authorize(context.locals)
  if (ctxOrResponse instanceof Response) return ctxOrResponse
  const ctx = ctxOrResponse

  if (!ctx.client.clerk_org_id) return redirectWithStatus('no_clerk_org')
  if (!ctx.user.clerk_user_id) return redirectWithStatus('no_clerk_user')

  const formData = await context.request.formData()
  const email = parseEmail(formData)
  if (!email) return redirectWithStatus('invalid_email')

  const redirectUrl = `${new URL(context.request.url).origin}/portal/products/ai-employee`
  try {
    await clerkClient(context).organizations.createOrganizationInvitation({
      organizationId: ctx.client.clerk_org_id,
      emailAddress: email,
      role: 'org:member',
      inviterUserId: ctx.user.clerk_user_id,
      redirectUrl,
    })
  } catch (err) {
    // Clerk's typed errors: duplicate, already-member, etc. We don't
    // surface raw Clerk error codes to the principal. Instead map a
    // small set to friendly status values and fall back to a generic
    // 'invite_failed' otherwise.
    const message = err instanceof Error ? err.message : String(err)
    if (/already a member/i.test(message)) return redirectWithStatus('already_member')
    if (/already invited|duplicate/i.test(message)) return redirectWithStatus('already_invited')
    console.error('Clerk invitation failed', { email, message })
    return redirectWithStatus('invite_failed')
  }

  return redirectWithStatus('invited')
}
