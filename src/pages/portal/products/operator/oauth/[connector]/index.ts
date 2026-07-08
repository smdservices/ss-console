/**
 * GET /portal/products/operator/oauth/[connector]
 *
 * Connect-initiate route — the target of the "Connect Google" button in the
 * Operator settings page. Starts the customer-facing OAuth consent flow:
 *
 *   1. Resolve Operator portal access (Clerk → entity + reviewer).
 *   2. Map the entity to its operator customer_slug via `customer_configs`
 *      (the registry; the slug keys the token relay's Fly-app lookup).
 *   3. Issue a signed state (HMAC, 10-min TTL) binding customer + provider +
 *      reviewer.
 *   4. Redirect to the provider's consent screen. The callback sibling
 *      verifies the state and relays the token.
 *
 * v1 wires `google-workspace`; unknown connectors redirect with a failed
 * status. Scopes default to the provider's authored operator set.
 */

import type { APIRoute } from 'astro'
import { env } from 'cloudflare:workers'

import { resolveOperatorAccess } from '../../../../../../lib/portal/operator-access.js'
import { issueOAuthState } from '../../../../../../lib/oauth/state.js'
import { buildGoogleAuthorizeUrl } from '../../../../../../lib/oauth/providers/google-workspace.js'
import { requirePortalBaseUrl } from '../../../../../../lib/config/app-url.js'

const OPERATOR_ROOT = '/portal/products/operator'

/** Instance-scoped settings path (falls back to the bare root when we don't yet
 *  know which operator — e.g. a missing/invalid ?instance). */
function settingsPath(instanceSlug: string | null): string {
  return instanceSlug ? `${OPERATOR_ROOT}/${instanceSlug}/settings` : OPERATOR_ROOT
}

function failed(portalBase: string, reason: string, instanceSlug: string | null): Response {
  const url = new URL(`${portalBase}${settingsPath(instanceSlug)}`)
  url.searchParams.set('status', 'failed')
  url.searchParams.set('reason', reason)
  return new Response(null, { status: 302, headers: { Location: url.toString() } })
}

function portalCallbackUrl(portalBase: string, providerSlug: string): string {
  return `${portalBase}/portal/products/operator/oauth/${encodeURIComponent(providerSlug)}/callback`
}

export const GET: APIRoute = async ({ locals, params, url, redirect }) => {
  const portalBase = requirePortalBaseUrl(env)
  const connector = typeof params.connector === 'string' ? params.connector : ''

  // OAuth stays on this stable (non-[instance]) path so the provider-registered
  // redirect URI never changes; the operator instance rides in as a query param
  // and is bound into the signed state below (multi-operator model).
  const instance = url.searchParams.get('instance')

  // v1: only Google Workspace is wired end-to-end (provider + relay).
  if (connector !== 'google-workspace') {
    return failed(portalBase, 'unknown_connector', instance)
  }

  if (!instance) {
    return failed(portalBase, 'no_instance', null)
  }

  const access = await resolveOperatorAccess(env.DB, locals, {
    allowedRoles: ['principal'],
    customerSlug: instance,
  })
  if (access.kind === 'redirect') {
    return redirect(access.to, 302)
  }

  // access.config is the ownership-checked instance config (entity_id === client).
  const config = access.config

  if (!env.GOOGLE_CLIENT_ID) {
    return failed(portalBase, 'provider_not_configured', instance)
  }

  // Bind the state to the reviewer's CLERK id — the callback verifies against
  // `locals.auth().userId` (Clerk), so reviewer_id must be the Clerk id, not the
  // local users.id. Using the local id here made every real consent attempt fail
  // `reviewer_mismatch` (2026-06-30 code review, PR 2a). A Clerk-authenticated
  // portal user always has clerk_user_id; guard the null case rather than issue a
  // state that can never match.
  const reviewerClerkId = access.user.clerk_user_id
  if (!reviewerClerkId) {
    return failed(portalBase, 'no_clerk_identity', instance)
  }

  const state = await issueOAuthState({
    customer_id: config.customer_slug,
    provider: 'google-workspace',
    reviewer_id: reviewerClerkId,
  })

  const authorizeUrl = buildGoogleAuthorizeUrl({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: portalCallbackUrl(portalBase, 'google-workspace'),
    state,
  })

  return redirect(authorizeUrl, 302)
}
