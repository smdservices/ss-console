/**
 * Google Workspace OAuth provider entry.
 *
 * Provider-specific authorize-URL + token-exchange details for the
 * customer-facing portal connect flow at
 * `src/pages/portal/products/operator/oauth/[connector]/` (initiate +
 * callback). Mirrors `providers/ms-graph.ts`.
 *
 * Scope discipline: read + draft only. `gmail.send` is explicitly
 * refused (mirror of ms-graph's `Mail.Send` refusal) — the connectors
 * draft, never send as the principal (the authored token scope is the
 * wall, ADR 0035). The default scope set deliberately OMITS
 * `drive.readonly`: it is a Google *restricted* scope (CASA security
 * assessment for production verification, same burden as gmail.modify)
 * and redundant with `drive.file` for agent-created docs. Include it
 * only when a connector demonstrably needs org-wide read, authored
 * per-customer in `customer.yaml` and gated as a separate decision.
 *
 * The on-disk token shape the Machine connectors read is the google-auth
 * "authorized user" JSON (`Credentials.from_authorized_user_file`), not
 * this exchange response — the relay (`src/lib/oauth/store.ts`) converts.
 *
 * Reference: `docs/specs/operator/oauth-lifecycle.md`.
 */

import { env } from 'cloudflare:workers'

import type { OAuthProvider, ProviderTokenResponse } from '../providers.js'

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

/**
 * Default operator scope set requested by the portal connect flow when a
 * customer's `customer.yaml` does not narrow it. `openid` + `email`
 * identify the connecting account; the three capability scopes back the
 * Gmail / Calendar / Drive connectors. `drive.readonly` is intentionally
 * absent (see file header).
 */
export const GOOGLE_OPERATOR_SCOPES: readonly string[] = Object.freeze([
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.file',
])

/** Scopes the authorize-URL builder refuses to emit, by suffix. */
const FORBIDDEN_SCOPE_SUFFIXES = ['/gmail.send']

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
  const response = await fetch(GOOGLE_TOKEN_URL, {
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
 * Build the Google authorize URL for a customer's initial consent /
 * re-consent. `state` MUST be the signed token from
 * `src/lib/oauth/state.ts`. `access_type=offline` + `prompt=consent`
 * force Google to return a refresh_token (the relay rejects a token
 * without one — a token that can't self-refresh would silently die when
 * the access token expires).
 */
export function buildGoogleAuthorizeUrl(args: {
  client_id: string
  redirect_uri: string
  state: string
  scopes?: readonly string[]
  login_hint?: string
}): string {
  if (!args.client_id) throw new Error('client_id is required')
  if (!args.redirect_uri) throw new Error('redirect_uri is required')
  if (!args.state) throw new Error('state is required')
  const scopes = args.scopes ?? GOOGLE_OPERATOR_SCOPES
  if (scopes.length === 0) throw new Error('at least one scope is required')
  // Defense-in-depth: never emit a URL requesting send-as-principal.
  const offender = scopes.find((s) =>
    FORBIDDEN_SCOPE_SUFFIXES.some((suffix) => s.toLowerCase().endsWith(suffix))
  )
  if (offender) {
    throw new Error(`refusing to emit authorize URL requesting forbidden scope: ${offender}`)
  }
  const params = new URLSearchParams({
    client_id: args.client_id,
    response_type: 'code',
    redirect_uri: args.redirect_uri,
    scope: scopes.join(' '),
    state: args.state,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  })
  if (args.login_hint) params.set('login_hint', args.login_hint)
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`
}

/**
 * Provider registry entry. Reads `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
 * from Workers env at exchange time; secrets are never logged.
 */
export const googleWorkspaceProvider: OAuthProvider = {
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
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri,
        grant_type: 'authorization_code',
      }),
      googleWorkspaceProvider.label
    )
  },
}

export { GOOGLE_AUTHORIZE_URL, GOOGLE_TOKEN_URL }
