import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resolveOperatorAccess } from '../../../../lib/portal/operator-access'
import { createChangeRequest } from '../../../../lib/portal/operator/change-request'
import { safeReturnTo, instanceFromOperatorPath } from '../../../../lib/portal/operator/return-to'
import { changeRequestDomainLabel } from '../../../../lib/admin/change-request-inbox'
import { isSwitchableDomain } from '../../../../lib/operator/authority'
import { getAdminBaseUrl } from '../../../../lib/config/app-url'
import { sendEmail } from '../../../../lib/email/resend'
import { operatorChangeRequestNotificationEmailHtml } from '../../../../lib/email/operator-templates'

/**
 * POST /api/portal/operator/change-request
 *
 * The Read + Request filing path (client-portal §3, ADR 0041 §4.3). When a
 * domain is SMD-operated (its authority switch is off — the launch default for
 * every domain), the dual-mode surface renders read-only with a "Request a
 * change" form that posts here. The request lands in `operator_change_requests`;
 * the admin change-request inbox reads it.
 *
 * Driven by a plain HTML <form method="POST"> from RequestChangeForm.astro — no
 * JSON / fetch, no client JS (the portal ships 0KB JS). Form fields:
 *   domain     — the switchable authority domain the request concerns
 *   summary    — the client's request text
 *   return_to  — same-origin path to redirect back to (validated)
 *
 * Authorization: any client-internal role may FILE a request — it is a message
 * to SMD, not an operation on the operator. The domain/summary validation lives
 * in createChangeRequest (parse-and-validate; never cast a client value). The
 * row itself carries the actor (user id + email) + timestamp as its record.
 *
 * Returns a 303 redirect to `return_to` with a `?cr=` status the surface reads
 * to render a confirmation or error banner.
 */

const ALL_CLIENT_ROLES = ['principal', 'staff', 'compliance'] as const

function redirect(returnTo: string, status: 'filed' | 'invalid' | 'error'): Response {
  const sep = returnTo.includes('?') ? '&' : '?'
  return new Response(null, {
    status: 303,
    headers: { Location: `${returnTo}${sep}cr=${status}` },
  })
}

export const POST: APIRoute = async ({ locals, request }) => {
  const form = await request.formData()
  const domain = form.get('domain')
  const summary = form.get('summary')
  const returnTo = safeReturnTo(form.get('return_to'))

  // The operator instance is carried by the (already instance-scoped) return_to
  // path — no separate field to thread through the form components. Ownership is
  // enforced centrally by resolveOperatorAccess({ customerSlug }).
  const instance = instanceFromOperatorPath(returnTo)
  if (!instance) {
    return new Response(null, { status: 303, headers: { Location: '/portal/products/operator' } })
  }

  const access = await resolveOperatorAccess(env.DB, locals, {
    allowedRoles: ALL_CLIENT_ROLES,
    customerSlug: instance,
  })
  if (access.kind === 'redirect') {
    return new Response(null, { status: 303, headers: { Location: access.to } })
  }

  if (typeof domain !== 'string' || typeof summary !== 'string') {
    return redirect(returnTo, 'invalid')
  }

  const result = await createChangeRequest(env.DB, {
    entity_id: access.client.id,
    customer_slug: access.customerSlug,
    domain,
    requested_by_user_id: access.user.id,
    requested_by_email: access.user.email,
    summary,
  })

  if (!result.ok) {
    return redirect(returnTo, 'invalid')
  }

  // Operational baton to team@ — without it the request sits silently in the
  // admin inbox until someone happens to look (a request filed 2026-06-23 went
  // unnoticed for three weeks). Best-effort: never blocks or fails the filing.
  try {
    const adminBase = getAdminBaseUrl(env) ?? 'https://admin.smd.services'
    await sendEmail(env.RESEND_API_KEY, {
      to: 'team@smd.services',
      subject: `Operator change request: ${access.client.name} (${access.customerSlug})`,
      html: operatorChangeRequestNotificationEmailHtml({
        entityName: access.client.name,
        customerSlug: access.customerSlug,
        domainLabel: isSwitchableDomain(domain) ? changeRequestDomainLabel(domain) : domain,
        requestedByEmail: access.user.email,
        summary: summary.trim(),
        adminInboxUrl: `${adminBase}/admin/operator/requests`,
      }),
    })
  } catch (err) {
    console.error('[operator/change-request] team notification failed:', err)
  }
  return redirect(returnTo, 'filed')
}
