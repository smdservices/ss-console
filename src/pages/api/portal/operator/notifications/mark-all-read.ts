import type { APIRoute } from 'astro'
import { resolveOperatorAccess } from '../../../../../lib/portal/operator-access'
import { markAllNotificationsRead } from '../../../../../lib/portal/operator/notifications'
import { env } from 'cloudflare:workers'

/**
 * POST /api/portal/operator/notifications/mark-all-read
 *
 * Mark every unread notification on the caller's active Operator
 * subscription read. Driven by HTML <form method="POST"> submissions
 * from `NotificationPanel.astro` and the notifications page header;
 * no JSON / fetch client.
 *
 * Form fields:
 *   returnTo: TEXT (optional) — server-validated path to redirect back
 *                                to. Same allowlist as the single-row
 *                                mark-read endpoint.
 *
 * Authorization:
 *   - Clerk session required (middleware enforces)
 *   - Active Operator subscription on the entity
 *   - Caller holds at least one of: principal, operator, compliance
 *
 * Contract semantics: intent-idempotent. Always returns 303 to the
 * return target even when zero rows changed (already all-read, no
 * notifications exist, bridge stub). The resolver returns the count
 * of rows that flipped; the endpoint surfaces it on the redirect URL
 * as `?marked=N` so the destination page can render a banner if it
 * wants to. Today the bridge stub returns 0 unconditionally because
 * the read side is also empty.
 */

const NOTIFICATIONS_PAGE = '/portal/products/operator/notifications'

function resolveReturnTarget(raw: FormDataEntryValue | null): string {
  if (typeof raw !== 'string') return NOTIFICATIONS_PAGE
  const trimmed = raw.trim()
  if (trimmed.length === 0) return NOTIFICATIONS_PAGE
  if (!trimmed.startsWith('/portal/products/operator')) {
    return NOTIFICATIONS_PAGE
  }
  if (trimmed.startsWith('//')) return NOTIFICATIONS_PAGE
  if (trimmed.includes(':')) return NOTIFICATIONS_PAGE
  return trimmed
}

/**
 * Build the destination URL with `?marked=N` appended (or merged when
 * the return target already has a query string). Encoding handled by
 * URL itself; we never echo unvalidated input back into the path.
 */
function withMarkedParam(target: string, marked: number): string {
  // URL needs a base when parsing a path-only string. We use a
  // throwaway origin and immediately strip it so the redirect remains
  // same-origin path-relative.
  const url = new URL(target, 'https://placeholder.invalid')
  url.searchParams.set('marked', String(marked))
  return `${url.pathname}${url.search}`
}

export const POST: APIRoute = async ({ request, locals }) => {
  const access = await resolveOperatorAccess(env.DB, locals, {
    allowedRoles: ['principal', 'operator', 'compliance'],
  })
  if (access.kind === 'redirect') {
    return new Response(null, {
      status: 303,
      headers: { Location: access.to },
    })
  }

  const formData = await request.formData()
  const returnTarget = resolveReturnTarget(formData.get('returnTo'))

  const marked = await markAllNotificationsRead(access.subscription)
  const finalTarget = withMarkedParam(returnTarget, marked)

  return new Response(null, {
    status: 303,
    headers: { Location: finalTarget },
  })
}
