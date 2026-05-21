import type { APIRoute } from 'astro'
import { verifyOAuthState, type OAuthStatePayload } from '../../../lib/oauth/state.js'
import { getOAuthProvider, type ProviderTokenResponse } from '../../../lib/oauth/providers.js'
import { getDefaultTokenStore } from '../../../lib/oauth/store.js'
import { emitAuditEvent } from '../../../lib/oauth/audit.js'
import { requireAdminBaseUrl } from '../../../lib/config/app-url.js'
import { env } from 'cloudflare:workers'

/**
 * GET /api/oauth/callback
 *
 * Unified OAuth callback for AI Employee connector consent flows
 * (issue #879, spec docs/specs/ai-employee/oauth-lifecycle.md,
 * storage decision docs/adr/0010-per-customer-oauth-token-storage.md).
 *
 * Lives on the admin subdomain. Provider apps are registered with their
 * redirect URI list pointing at `${ADMIN_BASE_URL}/api/oauth/callback`
 * (a single URL for all providers — provider is carried in the state).
 *
 * Flow:
 *
 *   1. Verify state parameter signature + expiry (HMAC-SHA256, 10 min TTL).
 *   2. Verify the state's `reviewer_id` matches the currently
 *      authenticated admin session. This is the CSRF defense — a
 *      leaked state is useless without the reviewer's cookie.
 *   3. Dispatch to the provider registry for token exchange.
 *   4. Hand the token to the per-customer store (delegates to the
 *      customer's Fly Machine per ADR 0010; v1 is a no-op pending
 *      Hermes Machine control plane wiring).
 *   5. Audit-log the outcome (writer is a no-op until #891 lands).
 *   6. Redirect the reviewer to the admin connectors page with a
 *      `status=connected` or `status=failed&reason=<short>` query
 *      string. The dashboard page consumes these params; this endpoint
 *      does not depend on the page existing yet.
 *
 * Failure modes redirect with short reason codes:
 *   provider_error, missing_params, bad_state, expired_state,
 *   reviewer_mismatch, unknown_provider, exchange_failed, store_failed.
 *
 * No token material is logged, returned in response bodies, or placed
 * in URLs. Issuer error payloads stay on the server side.
 */

type RedirectFn = (path: string, status?: 300 | 301 | 302 | 303 | 304 | 307 | 308) => Response

interface CallbackCtx {
  redirect: RedirectFn
  adminBase: string
}

function buildResultUrl(
  adminBase: string,
  customerSlug: string,
  params: Record<string, string>
): string {
  const url = new URL(`${adminBase}/admin/customers/${encodeURIComponent(customerSlug)}/connectors`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}

async function reject(
  ctx: CallbackCtx,
  reason: string,
  meta: {
    customer_id: string | null
    provider: string | null
    reviewer_id: string | null
    auditReason?: string
  }
): Promise<Response> {
  await emitAuditEvent({
    action: 'token-rejected',
    customer_id: meta.customer_id,
    provider: meta.provider,
    reviewer_id: meta.reviewer_id,
    reason: meta.auditReason ?? reason,
  })
  const params: Record<string, string> = { status: 'failed', reason }
  if (meta.provider) params.provider = meta.provider
  return ctx.redirect(buildResultUrl(ctx.adminBase, meta.customer_id ?? 'unknown', params), 302)
}

async function handleProviderError(
  ctx: CallbackCtx,
  url: URL,
  providerError: string,
  providerErrorDescription: string | null
): Promise<Response> {
  // Provider rejected the consent (user denied, scope mismatch, etc).
  // Try to read state for audit context, but don't fail the failure
  // path on a missing or invalid state.
  const rawState = url.searchParams.get('state')
  let customer: string | null = null
  let provider: string | null = null
  if (rawState) {
    const result = await verifyOAuthState(rawState)
    if (result.ok) {
      customer = result.payload.customer_id
      provider = result.payload.provider
    }
  }
  const detail = providerErrorDescription ? `:${providerErrorDescription}` : ''
  return reject(ctx, 'provider_error', {
    customer_id: customer,
    provider,
    reviewer_id: null,
    auditReason: `provider_error:${providerError}${detail}`,
  })
}

interface ValidatedState {
  payload: OAuthStatePayload
}

async function validateStateOrReject(
  ctx: CallbackCtx,
  stateParam: string
): Promise<Response | ValidatedState> {
  const stateResult = await verifyOAuthState(stateParam)
  if (stateResult.ok) return { payload: stateResult.payload }
  const reason = stateResult.error === 'expired' ? 'expired_state' : 'bad_state'
  return reject(ctx, reason, {
    customer_id: null,
    provider: null,
    reviewer_id: null,
    auditReason: `${reason}:${stateResult.error}`,
  })
}

async function exchangeOrReject(
  ctx: CallbackCtx,
  payload: OAuthStatePayload,
  code: string
): Promise<Response | ProviderTokenResponse> {
  const provider = getOAuthProvider(payload.provider)
  if (!provider) {
    return reject(ctx, 'unknown_provider', {
      customer_id: payload.customer_id,
      provider: payload.provider,
      reviewer_id: payload.reviewer_id,
    })
  }
  try {
    return await provider.exchange_code({
      code,
      redirect_uri: `${ctx.adminBase}/api/oauth/callback`,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'unknown'
    console.error(`[oauth/callback] exchange_failed provider=${payload.provider}: ${detail}`)
    return reject(ctx, 'exchange_failed', {
      customer_id: payload.customer_id,
      provider: payload.provider,
      reviewer_id: payload.reviewer_id,
    })
  }
}

function reviewerMatches(
  session: { userId: string; role: string } | null | undefined,
  reviewer_id: string
): boolean {
  return Boolean(session && session.role === 'admin' && session.userId === reviewer_id)
}

export const GET: APIRoute = async ({ request, redirect, locals }) => {
  const url = new URL(request.url)
  const ctx: CallbackCtx = { redirect, adminBase: requireAdminBaseUrl(env) }

  const providerError = url.searchParams.get('error')
  if (providerError) {
    return handleProviderError(ctx, url, providerError, url.searchParams.get('error_description'))
  }

  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  if (!code || !stateParam) {
    return reject(ctx, 'missing_params', {
      customer_id: null,
      provider: null,
      reviewer_id: null,
    })
  }

  const stateOrFail = await validateStateOrReject(ctx, stateParam)
  if (stateOrFail instanceof Response) return stateOrFail

  const { customer_id, provider: providerSlug, reviewer_id } = stateOrFail.payload

  if (!reviewerMatches(locals.session, reviewer_id)) {
    return reject(ctx, 'reviewer_mismatch', {
      customer_id,
      provider: providerSlug,
      reviewer_id,
    })
  }

  const tokenOrFail = await exchangeOrReject(ctx, stateOrFail.payload, code)
  if (tokenOrFail instanceof Response) return tokenOrFail

  const storeResult = await getDefaultTokenStore().store({
    customer_id,
    provider: providerSlug,
    reviewer_id,
    token: tokenOrFail,
  })

  if (!storeResult.ok) {
    return reject(ctx, 'store_failed', {
      customer_id,
      provider: providerSlug,
      reviewer_id,
      auditReason: `store_failed:${storeResult.reason}`,
    })
  }

  await emitAuditEvent({
    action: 'token-issued',
    customer_id,
    provider: providerSlug,
    reviewer_id,
  })

  return redirect(
    buildResultUrl(ctx.adminBase, customer_id, {
      status: 'connected',
      provider: providerSlug,
    }),
    302
  )
}
