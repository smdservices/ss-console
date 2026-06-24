/**
 * GET /api/operator/smokeball/connect-callback
 *
 * The hosted landing page for the Smokeball firm-delegated (authorization_code)
 * connect flow (ADR 0053). The firm clicks an authorize link we hand them
 * (built by `operator/bin/connect-smokeball.sh`), signs into Smokeball, clicks
 * Allow, and Smokeball redirects HERE with `?code=…&state=…`.
 *
 * Authorization model — DELIBERATELY state-only, NOT Clerk-gated. The connecting
 * party is the FIRM, who has no portal session. The signed `state`
 * (HMAC-SHA256 + 10-min TTL + nonce, `src/lib/oauth/state.ts`) is the
 * authorization: it proves WE issued this connect for this customer. A captured
 * link is useless after 10 minutes, and the state cannot be forged without the
 * signing key. (The Clerk-gated portal callback at
 * `/portal/products/operator/oauth/[connector]/callback` is a separate surface
 * and stays untouched.)
 *
 * The customer's environment+region travel inside the signed state's `provider`
 * field as `smokeball:<region>:<environment>` (tamper-proof under the HMAC), so
 * this endpoint selects the right Smokeball hosts and client credentials.
 *
 * Flow: verify state → exchange code at the env-specific token endpoint →
 * relay the refresh token to the customer's Machine (Fly secret + restart) →
 * render a plain "✓ Connected" page. No token material is logged or rendered;
 * issuer error bodies stay server-side and collapse to a short reason.
 */

import type { APIRoute } from 'astro'

import { verifyOAuthState } from '../../../../lib/oauth/state.js'
import {
  exchangeSmokeballCode,
  type SmokeballEnvironment,
  type SmokeballRegion,
} from '../../../../lib/oauth/providers/smokeball.js'
import { relaySmokeballRefreshToken } from '../../../../lib/oauth/store.js'
import { emitAuditEvent } from '../../../../lib/oauth/audit.js'

const VALID_REGIONS = new Set(['us', 'au', 'uk'])
const VALID_ENVIRONMENTS = new Set(['staging', 'production'])

function page(title: string, body: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 32rem; margin: 4rem auto;
         padding: 0 1.5rem; color: #1a1a2e; line-height: 1.5; }
  .badge { font-size: 2.5rem; }
  h1 { font-size: 1.4rem; margin: 0.5rem 0; }
  p { color: #444; }
</style></head><body>${body}</body></html>`
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function connectedPage(): Response {
  return page(
    'Connected',
    `<div class="badge">✓</div><h1>Smokeball connected</h1>
     <p>Your Operator is now linked to your Smokeball account. You can close this window.</p>`,
    200
  )
}

function failedPage(reason: string): Response {
  return page(
    'Connection failed',
    `<div class="badge">⚠️</div><h1>We couldn't finish connecting Smokeball</h1>
     <p>Please close this window and let your SMD contact know
        (reference: <code>${reason}</code>). You can safely try again.</p>`,
    400
  )
}

/** Parse `smokeball:<region>:<environment>` from the signed state's provider. */
function parseSmokeballProvider(
  provider: string
): { region: SmokeballRegion; environment: SmokeballEnvironment } | null {
  const parts = provider.split(':')
  if (parts.length !== 3 || parts[0] !== 'smokeball') return null
  const region = parts[1]
  const environment = parts[2]
  if (!VALID_REGIONS.has(region) || !VALID_ENVIRONMENTS.has(environment)) return null
  return { region: region as SmokeballRegion, environment: environment as SmokeballEnvironment }
}

/** Emit a rejection audit row (no token material) and render the failure page. */
async function reject(
  reason: string,
  ctx: {
    customer_id: string | null
    provider: string | null
    reviewer_id: string | null
    auditReason?: string
  }
): Promise<Response> {
  await emitAuditEvent({
    action: 'token-rejected',
    customer_id: ctx.customer_id,
    provider: ctx.provider,
    reviewer_id: ctx.reviewer_id,
    reason: ctx.auditReason ?? reason,
  })
  return failedPage(reason)
}

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url)
  const anon = { customer_id: null, provider: 'smokeball', reviewer_id: null }

  const issuerError = url.searchParams.get('error')
  if (issuerError) {
    return reject('provider_error', { ...anon, auditReason: `provider_error:${issuerError}` })
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return reject('missing_params', anon)

  const stateResult = await verifyOAuthState(state)
  if (!stateResult.ok) {
    const reason = stateResult.error === 'expired' ? 'expired_state' : 'bad_state'
    return reject(reason, { ...anon, auditReason: `${reason}:${stateResult.error}` })
  }

  const { customer_id, provider, reviewer_id } = stateResult.payload
  const ctx = { customer_id, provider, reviewer_id }
  const parsed = parseSmokeballProvider(provider)
  if (!parsed) return reject('unknown_provider', ctx)

  // The redirect_uri sent to the token endpoint MUST byte-match the one used in
  // the authorize step — exactly this endpoint's own URL (origin + path), which
  // is what we registered and what Smokeball just called.
  const redirect_uri = `${url.origin}${url.pathname}`

  let token
  try {
    token = await exchangeSmokeballCode({ code, redirect_uri, ...parsed })
  } catch (err) {
    // The exchange error message carries only a status code, never the body.
    console.error(
      `[smokeball/connect] exchange_failed customer=${customer_id} env=${parsed.environment}: ${
        err instanceof Error ? err.message : 'unknown'
      }`
    )
    return reject('exchange_failed', ctx)
  }

  if (!token.refresh_token) return reject('missing_refresh_token', ctx)

  const relay = await relaySmokeballRefreshToken({
    customer_id,
    refresh_token: token.refresh_token,
  })
  if (!relay.ok)
    return reject('relay_failed', { ...ctx, auditReason: `relay_failed:${relay.reason}` })

  await emitAuditEvent({ action: 'token-issued', customer_id, provider, reviewer_id })
  return connectedPage()
}
