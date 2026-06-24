/**
 * Smokeball OAuth — the firm-delegated (authorization_code) connect flow.
 *
 * Unlike the Google / Microsoft providers this is NOT registered in the generic
 * `providers.ts` map, for two reasons that make Smokeball a dedicated flow:
 *
 *   1. Environment-specific hosts. The authorize + token endpoints differ by
 *      region AND environment (staging vs production), and the client
 *      credentials used to exchange the code likewise differ
 *      (SMOKEBALL_STAGING_* vs SMOKEBALL_PROD_*). The generic `OAuthProvider`
 *      interface assumes one static `token_url` + one credential pair, so
 *      Smokeball is modeled as standalone host-aware functions.
 *   2. The connecting user is the FIRM, not a portal user. The Smokeball connect
 *      callback is authorized by the signed state alone (HMAC + short TTL +
 *      nonce), NOT a Clerk session — the firm clicks an authorize link we hand
 *      them and never logs into our portal. The generic portal callback is
 *      Clerk-gated and stays untouched.
 *
 * Token shape on the Machine: the connector reads a PLAIN refresh token from
 * `SMOKEBALL_REFRESH_TOKEN` (not a JSON blob), and mints/refreshes its own
 * access tokens (grant_type=refresh_token). So the relay only needs to deliver
 * the refresh token (see `relaySmokeballRefreshToken` in `../store.ts`).
 *
 * Secrets are never logged. Issuer error bodies are surfaced only as opaque
 * status codes to the caller. Confirmed against docs.smokeball.com (2026-06-23):
 * authorize `{auth_host}/oauth2/authorize`, token `{auth_host}/oauth2/token`,
 * `Authorization: Basic base64(client_id:client_secret)`, access token 60 min,
 * refresh token 30 days.
 */

import { env } from 'cloudflare:workers'

import type { ProviderTokenResponse } from '../providers.js'

export type SmokeballEnvironment = 'staging' | 'production'
export type SmokeballRegion = 'us' | 'au' | 'uk'

/**
 * (region, environment) → auth host. Mirrors the connector's host table
 * (operator/connectors/smokeball/.../client.py `_HOSTS`). The two MUST match —
 * a token minted at a staging auth host is invalid against a production API
 * host, and vice versa.
 */
const AUTH_HOSTS: Readonly<Record<string, string>> = Object.freeze({
  'us:production': 'https://auth.smokeball.com',
  'us:staging': 'https://datastaging-auth.smokeball.com',
  'au:production': 'https://auth.smokeball.com.au',
  'au:staging': 'https://datastaging-auth.smokeball.com.au',
  'uk:production': 'https://auth.smokeball.co.uk',
  'uk:staging': 'https://datastaging-auth.smokeball.co.uk',
})

/**
 * Default minimal scope checklist for the phase-1 law-pack surface (the read
 * tools + `create_memo` + webhook provisioning). The FIRM's app must grant at
 * least these; a narrower grant means a successful-looking Allow followed by the
 * Operator silently unable to read — so this is the list to confirm at app
 * creation. Scope strings are Smokeball's `resource/action` form.
 */
export const SMOKEBALL_OPERATOR_SCOPES: readonly string[] = Object.freeze([
  'matters/read',
  'contacts/read',
  'mattertypes/read',
  'stages/read',
  'tasks/read',
  'staff/read',
  'roles/read',
  'documents/read',
  'memos/read',
  'memos/write', // create_memo — the one internal-log write the wedge uses
  'bankaccounts/read',
  'bankaccountbalances/read',
  'billingconfiguration/read',
  'fees/read',
  'expenses/read',
  'webhooks/read',
  'webhooks/write', // create_webhook_subscription — drives matter.updated
])

function authHost(region: SmokeballRegion, environment: SmokeballEnvironment): string {
  const host = AUTH_HOSTS[`${region}:${environment}`]
  if (!host) {
    throw new Error(`unknown Smokeball region/environment ${region}/${environment}`)
  }
  return host
}

/** The two env-specific credential pairs, by environment. Worker secrets. */
function clientCreds(environment: SmokeballEnvironment): {
  client_id: string | undefined
  client_secret: string | undefined
} {
  if (environment === 'production') {
    return {
      client_id: env.SMOKEBALL_PROD_CLIENT_ID,
      client_secret: env.SMOKEBALL_PROD_CLIENT_SECRET,
    }
  }
  return {
    client_id: env.SMOKEBALL_STAGING_CLIENT_ID,
    client_secret: env.SMOKEBALL_STAGING_CLIENT_SECRET,
  }
}

/**
 * Build the Smokeball authorize URL. `state` MUST be the signed token from
 * `src/lib/oauth/state.ts`. Smokeball returns a refresh token on the
 * authorization_code grant by default (30-day), so no Google-style
 * `access_type=offline` toggle is needed.
 */
export function buildSmokeballAuthorizeUrl(args: {
  client_id: string
  redirect_uri: string
  state: string
  region: SmokeballRegion
  environment: SmokeballEnvironment
  scopes?: readonly string[]
}): string {
  if (!args.client_id) throw new Error('client_id is required')
  if (!args.redirect_uri) throw new Error('redirect_uri is required')
  if (!args.state) throw new Error('state is required')
  const scopes = args.scopes ?? SMOKEBALL_OPERATOR_SCOPES
  if (scopes.length === 0) throw new Error('at least one scope is required')
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: args.client_id,
    redirect_uri: args.redirect_uri,
    scope: scopes.join(' '),
    state: args.state,
  })
  return `${authHost(args.region, args.environment)}/oauth2/authorize?${params.toString()}`
}

interface RawTokenJson {
  access_token?: unknown
  refresh_token?: unknown
  scope?: unknown
  expires_in?: unknown
}

/**
 * Exchange an authorization code for an access + refresh token at the
 * environment-specific token endpoint. Reads the matching client credentials
 * (SMOKEBALL_STAGING_* / SMOKEBALL_PROD_*) from Worker env. Throws on a missing
 * credential or a non-2xx issuer response (status only, never the body, which
 * can echo the grant).
 */
export async function exchangeSmokeballCode(args: {
  code: string
  redirect_uri: string
  region: SmokeballRegion
  environment: SmokeballEnvironment
}): Promise<ProviderTokenResponse> {
  const { client_id, client_secret } = clientCreds(args.environment)
  if (!client_id || !client_secret) {
    throw new Error(
      `Smokeball ${args.environment} client credentials are not configured ` +
        `(SMOKEBALL_${args.environment === 'production' ? 'PROD' : 'STAGING'}_CLIENT_ID / _CLIENT_SECRET).`
    )
  }
  const basic = btoa(`${client_id}:${client_secret}`)
  const response = await fetch(`${authHost(args.region, args.environment)}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id,
      code: args.code,
      redirect_uri: args.redirect_uri,
    }),
  })
  if (!response.ok) {
    // Never include the body — it can echo the code/grant.
    throw new Error(`Smokeball token exchange failed (${response.status})`)
  }
  const raw: RawTokenJson = await response.json()
  if (typeof raw.access_token !== 'string' || raw.access_token.length === 0) {
    throw new Error('Smokeball token exchange returned no access_token')
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

export { AUTH_HOSTS }
