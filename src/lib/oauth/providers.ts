/**
 * OAuth provider registry for AI Employee connector consent flows.
 *
 * Each provider entry knows how to exchange an authorization code for an
 * access + refresh token pair on its issuer. The callback at
 * /api/oauth/callback dispatches by provider slug after validating the
 * signed state parameter.
 *
 * Provider slugs match the `connectors:` value shape in customer.yaml
 * (see docs/specs/ai-employee/customer-yaml-schema.md and the per-connector
 * oauth_scopes.json files in ai-employee/connectors/). v1 covers the
 * Phase 1 connectors that ship with first customer-zero: Microsoft Graph
 * and Google Workspace. Subsequent providers (Clio, LawPay, QuickBooks,
 * Slack, etc.) layer in by extending PROVIDERS without touching the
 * callback endpoint.
 *
 * Token responses are normalized to the shape described in ADR 0010 §
 * "Storage shape" so the store interface in src/lib/oauth/store.ts has a
 * single contract regardless of which provider issued the token.
 *
 * Client secrets are read from Cloudflare Workers env at exchange time.
 * Secrets are never logged. Error payloads from the issuer are passed to
 * the caller as opaque strings (no token material), so the callback can
 * surface a short error code to the dashboard without exposing details
 * upstream.
 */

import { env } from 'cloudflare:workers'

export interface ProviderTokenResponse {
  /** Short-lived access token. */
  access_token: string
  /** Long-lived refresh token, if the provider issued one. */
  refresh_token: string | null
  /** Space-separated scopes the issuer actually granted. */
  scopes: string
  /** ISO 8601 timestamp at which `access_token` expires. */
  expires_at: string
  /** ISO 8601 timestamp at which this token was obtained. */
  obtained_at: string
}

export interface OAuthProvider {
  /** Slug used in customer.yaml `connectors:` and the state parameter. */
  slug: string
  /** Human label for logs and dashboard surfaces. */
  label: string
  /** Issuer token endpoint. */
  token_url: string
  /**
   * Exchange an authorization code for tokens. Implementations call
   * `token_url` with `grant_type=authorization_code`, normalize the
   * response to `ProviderTokenResponse`, and throw on non-2xx.
   */
  exchange_code(args: { code: string; redirect_uri: string }): Promise<ProviderTokenResponse>
}

const MS_GRAPH_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

interface RawTokenJson {
  access_token?: unknown
  refresh_token?: unknown
  scope?: unknown
  expires_in?: unknown
}

async function postFormForToken(
  tokenUrl: string,
  body: URLSearchParams,
  providerLabel: string
): Promise<ProviderTokenResponse> {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    // Issuer error bodies are not logged with token material — they only
    // contain error codes and descriptions per the OAuth 2 RFC.
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

const microsoftGraph: OAuthProvider = {
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
      MS_GRAPH_TOKEN_URL,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri,
        grant_type: 'authorization_code',
      }),
      microsoftGraph.label
    )
  },
}

const googleWorkspace: OAuthProvider = {
  slug: 'google-workspace',
  label: 'Google Workspace',
  token_url: GOOGLE_TOKEN_URL,
  async exchange_code({ code, redirect_uri }) {
    const clientId = env.GOOGLE_CLIENT_ID
    const clientSecret = env.GOOGLE_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      throw new Error(
        'Google Workspace client credentials are not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).'
      )
    }
    return postFormForToken(
      GOOGLE_TOKEN_URL,
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri,
        grant_type: 'authorization_code',
      }),
      googleWorkspace.label
    )
  },
}

const PROVIDERS: Record<string, OAuthProvider> = {
  [microsoftGraph.slug]: microsoftGraph,
  [googleWorkspace.slug]: googleWorkspace,
}

export function getOAuthProvider(slug: string): OAuthProvider | null {
  return PROVIDERS[slug] ?? null
}

export function listOAuthProviderSlugs(): string[] {
  return Object.keys(PROVIDERS)
}
