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
import { getCustomerConfig } from '../../../../../../lib/portal/customer-config.js'
import { issueOAuthState } from '../../../../../../lib/oauth/state.js'
import { buildGoogleAuthorizeUrl } from '../../../../../../lib/oauth/providers/google-workspace.js'
import { requirePortalBaseUrl } from '../../../../../../lib/config/app-url.js'

const SETTINGS_PATH = '/portal/products/operator/settings'

function failed(portalBase: string, reason: string): Response {
  const url = new URL(`${portalBase}${SETTINGS_PATH}`)
  url.searchParams.set('status', 'failed')
  url.searchParams.set('reason', reason)
  return new Response(null, { status: 302, headers: { Location: url.toString() } })
}

function portalCallbackUrl(portalBase: string, providerSlug: string): string {
  return `${portalBase}/portal/products/operator/oauth/${encodeURIComponent(providerSlug)}/callback`
}

export const GET: APIRoute = async ({ locals, params, redirect }) => {
  const portalBase = requirePortalBaseUrl(env)
  const connector = typeof params.connector === 'string' ? params.connector : ''

  // v1: only Google Workspace is wired end-to-end (provider + relay).
  if (connector !== 'google-workspace') {
    return failed(portalBase, 'unknown_connector')
  }

  const access = await resolveOperatorAccess(env.DB, locals, { allowedRoles: ['principal'] })
  if (access.kind === 'redirect') {
    return redirect(access.to, 302)
  }

  const config = await getCustomerConfig(env.DB, access.client.id)
  if (!config) {
    return failed(portalBase, 'no_customer_config')
  }

  if (!env.GOOGLE_CLIENT_ID) {
    return failed(portalBase, 'provider_not_configured')
  }

  // Bind the state to the reviewer's CLERK id — the callback verifies against
  // `locals.auth().userId` (Clerk), so reviewer_id must be the Clerk id, not the
  // local users.id. Using the local id here made every real consent attempt fail
  // `reviewer_mismatch` (2026-06-30 code review, PR 2a). A Clerk-authenticated
  // portal user always has clerk_user_id; guard the null case rather than issue a
  // state that can never match.
  const reviewerClerkId = access.user.clerk_user_id
  if (!reviewerClerkId) {
    return failed(portalBase, 'no_clerk_identity')
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
