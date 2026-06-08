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

/**
 * POST /api/portal/products/operator/connectors/{connector}/secret
 *
 * Write-only static-secret entry (ADR 0042). A client (principal) enters a raw
 * API key for a connector; the value relays straight into the per-customer
 * isolated vault and NEVER touches the console DB, a log, or this transcript.
 * Only a masked confirmation is returned. The no-leak orchestration lives in
 * `handleSecretWrite`; the vault transport + audit are wired in
 * credential-secret-transport.ts.
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
 * Body: form field `secret` (the raw value). Never logged.
 * Returns JSON: { ok: true, masked, ref } | { ok: false, error }.
 */

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const POST: APIRoute = async ({ locals, params, request }) => {
  const access = await resolveOperatorAccess(env.DB, locals, { allowedRoles: ['principal'] })
  if (access.kind === 'redirect') {
    return json(403, { ok: false, error: 'forbidden' })
  }

  const connector = params.connector
  if (typeof connector !== 'string' || connector.length === 0) {
    return json(400, { ok: false, error: 'invalid_connector' })
  }

  const config = await getCustomerConfig(env.DB, access.client.id)
  if (!isClientOperable(config?.authority ?? null, 'connectors')) {
    // ADR 0041 Verification 5 — reject server-side, not merely hide.
    return json(403, { ok: false, error: 'not_permitted' })
  }

  if (!isSecretTransportConfigured(env)) {
    return json(503, { ok: false, error: 'not_enabled' })
  }

  const form = await request.formData()
  const secret = form.get('secret')
  if (typeof secret !== 'string') {
    return json(400, { ok: false, error: 'empty_secret' })
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
    const status = result.error === 'write_failed' ? 502 : 400
    return json(status, { ok: false, error: result.error })
  }
  return json(200, { ok: true, masked: result.masked, ref: result.ref })
}
