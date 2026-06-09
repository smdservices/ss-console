import type { APIRoute } from 'astro'
import { resolveOperatorAccess } from '../../../../../../lib/portal/operator-access'
import { markNotificationRead } from '../../../../../../lib/portal/operator/notifications'
import { env } from 'cloudflare:workers'

/**
 * POST /api/portal/operator/notifications/[id]/mark-read
 *
 * Mark a single notification read. Driven by HTML <form method="POST">
 * submissions from `NotificationRow.astro`; no JSON / fetch client.
 *
 * Form fields:
 *   returnTo: TEXT (optional) — server-validated path to redirect back
 *                                to on success. Defaults to the full
 *                                notifications page when missing or
 *                                pointing at an unsafe target.
 *
 * Authorization:
 *   - Clerk session required (middleware enforces)
 *   - Active Operator subscription on the entity
 *   - Caller holds at least one of: principal, operator, compliance
 *
 * Contract semantics: this endpoint is intent-idempotent. POSTing for
 * a notification that doesn't exist, was already read, or was deleted
 * still returns a 303 to the return target — the caller does not need
 * to read the row first. The underlying resolver returns false in
 * those cases; the redirect status is independent.
 *
 * Today the resolver layer returns false unconditionally because the
 * Hermes bridge is not wired (#821). The endpoint documents the
 * contract so client surfaces can be built against it; the actual
 * state mutation lands when the bridge wires through.
 */

const NOTIFICATIONS_PAGE = '/portal/products/operator/notifications'

/**
 * Server-side allowlist of return-target paths. POST handlers must
 * not redirect to caller-supplied absolute URLs — that's an open
 * redirect. We accept same-origin paths under /portal/products/operator
 * only, which is the surface set that has a legitimate reason to
 * point at the notifications mark-read flow.
 *
 * Anything outside the allowed prefix collapses to the default
 * notifications page. Empty / missing also collapses to the default.
 */
function resolveReturnTarget(raw: FormDataEntryValue | null): string {
  if (typeof raw !== 'string') return NOTIFICATIONS_PAGE
  const trimmed = raw.trim()
  if (trimmed.length === 0) return NOTIFICATIONS_PAGE
  if (!trimmed.startsWith('/portal/products/operator')) {
    return NOTIFICATIONS_PAGE
  }
  // Defense in depth: reject anything that looks like protocol-relative
  // (`//evil.example`) or scheme-relative (`javascript:`) input.
  if (trimmed.startsWith('//')) return NOTIFICATIONS_PAGE
  if (trimmed.includes(':')) return NOTIFICATIONS_PAGE
  return trimmed
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  const id = params.id
  if (typeof id !== 'string' || id.length === 0) {
    return jsonError(400, 'Missing notification id')
  }

  const access = await resolveOperatorAccess(env.DB, locals, {
    allowedRoles: ['principal', 'staff', 'compliance'],
  })
  if (access.kind === 'redirect') {
    // Auth failure: the caller must sign in / pick an org / activate
    // a subscription. Forward to the same target the access helper
    // resolved (the marketing landing or sign-in surface).
    return new Response(null, {
      status: 303,
      headers: { Location: access.to },
    })
  }

  const formData = await request.formData()
  const returnTarget = resolveReturnTarget(formData.get('returnTo'))

  // Resolver returns false today (bridge not wired). Both true and
  // false are 303 — the URL contract is idempotent on intent.
  await markNotificationRead(access.subscription, id)

  return new Response(null, {
    status: 303,
    headers: { Location: returnTarget },
  })
}
