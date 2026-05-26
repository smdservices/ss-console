/**
 * Microsoft Graph OAuth provider entry.
 *
 * Provider-specific token-exchange details for the unified callback at
 * `src/pages/api/oauth/callback.ts` and the customer-facing portal
 * callback at `src/pages/portal/products/ai-employee/oauth/[connector]/callback.astro`.
 *
 * Scope discipline: read + draft only. `Mail.Send` is explicitly absent
 * — programmatic send is the wave-2 stream (issue #881) under a separate
 * adapter method and a distinct delegated scope.
 *
 * This OAuth provider is the canonical source for the Microsoft Graph
 * delegated-scope contract. Per ADR 0021 Stream F (PR #1081 + #1065),
 * the Mail/Calendar/DocumentStorage capabilities are now bound to MCP
 * servers (`mcp:m365-mail`, `mcp:m365-calendar`,
 * `mcp:softeria/ms-365-mcp-server`); the prior Python BUILD adapter at
 * `ai-employee/connectors/ms_graph/` was deleted in the 2026-05-24
 * realignment. The MCP servers consume the OAuth refresh token this
 * provider mints — token storage and refresh remain owned here.
 *
 * Reference docs:
 *   - `docs/specs/ai-employee/oauth-lifecycle.md` § "Per-connector OAuth scope inventory"
 *   - `docs/runbooks/ai-employee/ms-graph-azure-ad-setup.md`
 *   - `docs/strategy/mcp-vs-build-ms-graph-2026-05-25.md` (F decision packet)
 */

import { env } from 'cloudflare:workers'

import type { OAuthProvider, ProviderTokenResponse } from '../providers.js'

const MS_GRAPH_AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const MS_GRAPH_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

/**
 * Phase 1 delegated scopes. Identical set as
 * `ai-employee/connectors/ms_graph/oauth.py` `PHASE_1_SCOPES`. Any
 * change here must be paired with the Python adapter and the
 * lifecycle spec — they are the same contract.
 */
export const MS_GRAPH_PHASE_1_SCOPES: readonly string[] = Object.freeze([
  'offline_access',
  'User.Read',
  'Mail.Read',
  'Mail.ReadWrite',
  'MailboxSettings.Read',
  'Calendars.ReadWrite',
  'Files.Read',
  'Files.ReadWrite.AppFolder',
])

interface RawTokenJson {
  access_token?: unknown
  refresh_token?: unknown
  scope?: unknown
  expires_in?: unknown
}

async function postFormForToken(
  body: URLSearchParams,
  providerLabel: string
): Promise<ProviderTokenResponse> {
  const response = await fetch(MS_GRAPH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${providerLabel} token exchange failed (${response.status}): ${text}`)
  }
  const raw: RawTokenJson = await response.json()
  if (typeof raw.access_token !== 'string' || raw.access_token.length === 0) {
    throw new Error(`${providerLabel} token exchange returned no access_token`)
  }
  const expiresInSec = typeof raw.expires_in === 'number' ? raw.expires_in : 3600
  const now = Date.now()
  return {
    access_token: raw.access_token,
    refresh_token: typeof raw.refresh_token === 'string' ? raw.refresh_token : null,
    scopes: typeof raw.scope === 'string' ? raw.scope : '',
    expires_at: new Date(now + expiresInSec * 1000).toISOString(),
    obtained_at: new Date(now).toISOString(),
  }
}

/**
 * Build the Microsoft Entra authorize URL for a customer's initial
 * consent flow. The `state` parameter MUST be the signed token from
 * `src/lib/oauth/state.ts` so the callback verifies provenance.
 */
export function buildMicrosoftGraphAuthorizeUrl(args: {
  client_id: string
  redirect_uri: string
  state: string
  login_hint?: string
  scopes?: readonly string[]
}): string {
  if (!args.client_id) throw new Error('client_id is required')
  if (!args.redirect_uri) throw new Error('redirect_uri is required')
  if (!args.state) throw new Error('state is required')
  const scopes = args.scopes ?? MS_GRAPH_PHASE_1_SCOPES
  // Defense-in-depth: refuse to emit a URL that requests Mail.Send.
  if (scopes.some((s) => s.toLowerCase() === 'mail.send')) {
    throw new Error('Mail.Send is a wave-2 scope (issue #881); refusing to emit authorize URL')
  }
  const params = new URLSearchParams({
    client_id: args.client_id,
    response_type: 'code',
    redirect_uri: args.redirect_uri,
    response_mode: 'query',
    scope: scopes.join(' '),
    state: args.state,
  })
  if (args.login_hint) params.set('login_hint', args.login_hint)
  return `${MS_GRAPH_AUTHORIZE_URL}?${params.toString()}`
}

/**
 * Provider registry entry. Plugs into the registry in
 * `src/lib/oauth/providers.ts`. The callback handler reads
 * `client_id` / `client_secret` from Workers env at exchange time;
 * secrets are never logged or returned in response bodies.
 */
export const microsoftGraphProvider: OAuthProvider = {
  slug: 'microsoft-graph',
  label: 'Microsoft Graph',
  token_url: MS_GRAPH_TOKEN_URL,
  async exchange_code({ code, redirect_uri }) {
    const clientId = env.MICROSOFT_GRAPH_CLIENT_ID
    const clientSecret = env.MICROSOFT_GRAPH_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      throw new Error(
        'Microsoft Graph client credentials are not configured (MICROSOFT_GRAPH_CLIENT_ID / MICROSOFT_GRAPH_CLIENT_SECRET).'
      )
    }
    return postFormForToken(
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri,
        grant_type: 'authorization_code',
        scope: MS_GRAPH_PHASE_1_SCOPES.join(' '),
      }),
      'Microsoft Graph'
    )
  },
}

export { MS_GRAPH_AUTHORIZE_URL, MS_GRAPH_TOKEN_URL }
