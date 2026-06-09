import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'
import { resolveOperatorAccess } from '../../../../../../../lib/portal/operator-access'
import { getCustomerConfig } from '../../../../../../../lib/portal/customer-config'
import { isClientOperable } from '../../../../../../../lib/operator/authority'
import { handleSecretWrite } from '../../../../../../../lib/operator/credential-secret-write'
import {
  createSecretAudit,
  createSecretWriter,
  isSecretTransportConfigured,
} from '../../../../../../../lib/operator/credential-secret-transport'
import { safeReturnTo } from '../../../../../../../lib/portal/operator/return-to'

/**
 * POST /api/portal/products/operator/connectors/{connector}/secret
 *
 * Write-only static-secret entry (ADR 0042). A client (principal) enters a raw
 * API key for a connector; the value relays straight into the per-customer
 * isolated vault and NEVER touches the console DB, a log, or this transcript.
 * The no-leak orchestration lives in `handleSecretWrite`; the vault transport +
 * audit are wired in credential-secret-transport.ts.
 *
 * Submission model: a plain 0-JS HTML form (the portal ships no client JS). The
 * endpoint 303-redirects back to the form's `return_to` with a `?cs=` status
 * the surface reads to show a banner. The raw value lives ONLY in the POST body
 * — it is never placed in a URL, never reflected in the response, never logged.
 * (This replaced the prior JSON response, which a plain form cannot consume; no
 * other caller depended on it.)
 *
 * Gates (all server-side, never client-only hiding):
 *   - principal role (ADR 0011) — the agent can never reach this surface.
 *   - the connectors authority switch must be `client` (ADR 0041 Verification 5):
 *     a write to a switched-off domain is rejected here, not merely hidden.
 *     At launch every switch is off, so this returns `not_permitted` for all
 *     clients until SMD flips the connectors switch for that client.
 *   - the vault transport must be configured (ADR 0036 relay): until wired,
 *     returns an honest `not_enabled` rather than half-storing the value.
 *
 * Body: form fields `secret` (the raw value, never logged) + `return_to`.
 */

function back(returnTo: string, cs: string): Response {
  const sep = returnTo.includes('?') ? '&' : '?'
  return new Response(null, { status: 303, headers: { Location: `${returnTo}${sep}cs=${cs}` } })
}

export const POST: APIRoute = async ({ locals, params, request }) => {
  const access = await resolveOperatorAccess(env.DB, locals, { allowedRoles: ['principal'] })
  if (access.kind === 'redirect') {
    return new Response(null, { status: 303, headers: { Location: access.to } })
  }

  const form = await request.formData()
  const returnTo = safeReturnTo(form.get('return_to'))

  const connector = params.connector
  if (typeof connector !== 'string' || connector.length === 0) {
    return back(returnTo, 'invalid_connector')
  }

  const config = await getCustomerConfig(env.DB, access.client.id)
  if (!isClientOperable(config?.authority ?? null, 'connectors')) {
    // ADR 0041 Verification 5 — reject server-side, not merely hide.
    return back(returnTo, 'not_permitted')
  }

  if (!isSecretTransportConfigured(env)) {
    return back(returnTo, 'not_enabled')
  }

  const secret = form.get('secret')
  if (typeof secret !== 'string' || secret.length === 0) {
    return back(returnTo, 'empty_secret')
  }

  const result = await handleSecretWrite(
    {
      writer: createSecretWriter(env),
      audit: createSecretAudit(env.DB, { entityId: access.client.id, actorUserId: access.user.id }),
    },
    { customerSlug: config?.customer_slug ?? access.client.id, connector, secret },
    { actor: access.user.email, actorRole: 'principal' }
  )

  if (!result.ok) {
    return back(returnTo, result.error === 'write_failed' ? 'write_failed' : 'invalid')
  }
  // Success carries no value and no ref — only that the write landed.
  return back(returnTo, 'saved')
}
