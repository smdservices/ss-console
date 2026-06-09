/**
 * OAuth token storage — relays a portal-exchanged token to the customer's
 * Fly Machine, where the connectors read it from `/opt/data/oauth/<provider>.json`.
 *
 * Per [ADR 0010](../../../docs/adr/0010-per-customer-oauth-token-storage.md) the
 * token lives on the customer's per-Machine Fly volume, never in Infisical and
 * never on this Worker. Cloudflare Workers can't write a Fly volume, so the
 * relay (mechanism decided in the OAuth-token-relay ADR) is:
 *
 *   1. Set the `GOOGLE_TOKEN_JSON` Fly *app secret* (base64 of the google-auth
 *      authorized-user JSON the connectors read) via the Fly GraphQL API.
 *   2. Restart the app's Machines so `bootstrap.sh` decodes the secret to the
 *      volume file — the same path `bin/provision-customer.sh` uses at provision.
 *
 * Token *refresh* self-maintains on the volume (the Python connectors rewrite
 * the refreshed token), so this relay only fires on the rare connect/re-consent.
 *
 * Token-shape note (verified against a live Machine, 2026-06-02): the connectors
 * call `google.oauth2.credentials.Credentials.from_authorized_user_file`, so the
 * on-disk shape is the google-auth "authorized user" JSON
 * (`token`/`refresh_token`/`token_uri`/`client_id`/`client_secret`/`scopes`/
 * `expiry`/`universe_domain`/`account`) — NOT the OAuth-exchange response and NOT
 * ADR 0010's documented `{access_token,…}` shape. This file converts.
 */

import { env } from 'cloudflare:workers'

import type { ProviderTokenResponse } from './providers.js'
import { resolveCustomerFlyApp } from '../operator/fly-app-registry'

export interface StoreTokenInput {
  customer_id: string
  provider: string
  reviewer_id: string
  token: ProviderTokenResponse
}

export type StoreTokenResult =
  | { ok: true }
  | {
      ok: false
      reason: 'unavailable' | 'rejected' | 'missing_refresh_token' | 'unknown_customer' | 'network'
    }

export interface OAuthTokenStore {
  store(input: StoreTokenInput): Promise<StoreTokenResult>
}

const FLY_GRAPHQL_URL = 'https://api.fly.io/graphql'
const FLY_MACHINES_API = 'https://api.machines.dev/v1'
const GOOGLE_TOKEN_URI = 'https://oauth2.googleapis.com/token'

/** provider slug → the Fly secret name bootstrap.sh decodes to the volume. */
const PROVIDER_SECRET_NAME: Readonly<Record<string, string>> = Object.freeze({
  'google-workspace': 'GOOGLE_TOKEN_JSON',
})

/** Base64 of a UTF-8 string (Workers-safe; token material is ASCII anyway). */
function base64Utf8(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)))
}

/**
 * Build the google-auth authorized-user JSON the connectors read. `expiry`
 * reuses the exchange's absolute ISO timestamp (google-auth parses it).
 */
function toAuthorizedUserJson(token: ProviderTokenResponse): string {
  return JSON.stringify({
    token: token.access_token,
    refresh_token: token.refresh_token,
    token_uri: GOOGLE_TOKEN_URI,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    scopes: token.scopes.split(/\s+/).filter(Boolean),
    universe_domain: 'googleapis.com',
    account: '',
    expiry: token.expires_at,
  })
}

/** Log a Fly API failure WITHOUT the response body (which can echo the token). */
function logFlyFailure(step: string, app: string, status: number, requestId: string | null): void {
  console.error(
    `[oauth/store] fly ${step} failed: app=${app} status=${status} fly-request-id=${requestId ?? 'none'}`
  )
}

async function setFlySecret(
  app: string,
  name: string,
  base64Value: string
): Promise<StoreTokenResult> {
  const query = `mutation($input: SetSecretsInput!) { setSecrets(input: $input) { release { id version } } }`
  const resp = await fetch(FLY_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.FLY_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: { input: { appId: app, secrets: [{ key: name, value: base64Value }] } },
    }),
  }).catch(() => null)
  if (!resp) return { ok: false, reason: 'network' }
  if (!resp.ok) {
    logFlyFailure('setSecrets', app, resp.status, resp.headers.get('fly-request-id'))
    return { ok: false, reason: 'unavailable' }
  }
  // GraphQL returns 200 with an `errors` array on failure.
  const body = (await resp.json().catch(() => null)) as { errors?: unknown[] } | null
  if (!body || (Array.isArray(body.errors) && body.errors.length > 0)) {
    logFlyFailure('setSecrets', app, 200, resp.headers.get('fly-request-id'))
    return { ok: false, reason: 'unavailable' }
  }
  return { ok: true }
}

/**
 * Restart every Machine in the app so the (non-staged) secret is applied.
 * Mirrors `fly secrets set` (no --stage), which "updates each Machine ...
 * restart of the Machine". If the dogfood shows a restart doesn't re-pull the
 * updated secret on a running Machine, switch to a `machine update` here — the
 * failure is loud (connectors 401 / "no calendar"), not silent.
 */
async function restartFlyMachines(app: string): Promise<StoreTokenResult> {
  const headers = { Authorization: `Bearer ${env.FLY_API_TOKEN}` }
  const listResp = await fetch(`${FLY_MACHINES_API}/apps/${app}/machines`, { headers }).catch(
    () => null
  )
  if (!listResp) return { ok: false, reason: 'network' }
  if (!listResp.ok) {
    logFlyFailure('list machines', app, listResp.status, listResp.headers.get('fly-request-id'))
    return { ok: false, reason: 'unavailable' }
  }
  const machines = (await listResp.json().catch(() => null)) as Array<{ id: string }> | null
  if (!machines || machines.length === 0) {
    logFlyFailure('list machines', app, listResp.status, listResp.headers.get('fly-request-id'))
    return { ok: false, reason: 'unavailable' }
  }
  for (const m of machines) {
    const r = await fetch(`${FLY_MACHINES_API}/apps/${app}/machines/${m.id}/restart`, {
      method: 'POST',
      headers,
    }).catch(() => null)
    if (!r || !r.ok) {
      // Half-success: the secret is staged but a Machine didn't restart. Surface
      // loudly — the new token will apply on the next restart, not now.
      logFlyFailure(
        'machine restart',
        app,
        r ? r.status : 0,
        r ? r.headers.get('fly-request-id') : null
      )
      return { ok: false, reason: 'unavailable' }
    }
  }
  return { ok: true }
}

/**
 * Production token store: relays via Fly secret + Machine restart.
 */
export function createFlySecretTokenStore(): OAuthTokenStore {
  return {
    async store(input): Promise<StoreTokenResult> {
      if (!env.FLY_API_TOKEN || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        console.error(
          '[oauth/store] relay unavailable: FLY_API_TOKEN / GOOGLE_CLIENT_* not configured'
        )
        return { ok: false, reason: 'unavailable' }
      }
      const app = resolveCustomerFlyApp(input.customer_id)
      if (!app) {
        console.error(
          `[oauth/store] unknown customer_id=${input.customer_id}; refusing to target any app`
        )
        return { ok: false, reason: 'unknown_customer' }
      }
      const secretName = PROVIDER_SECRET_NAME[input.provider]
      if (!secretName) {
        console.error(`[oauth/store] no relay secret mapping for provider=${input.provider}`)
        return { ok: false, reason: 'rejected' }
      }
      // A token with no refresh_token can't self-refresh — it would silently die
      // ~1h after connect. Reject loudly rather than clobber a working token.
      if (!input.token.refresh_token) {
        console.error(
          `[oauth/store] token for customer=${input.customer_id} has no refresh_token; rejecting`
        )
        return { ok: false, reason: 'missing_refresh_token' }
      }

      const base64Value = base64Utf8(toAuthorizedUserJson(input.token))
      const setResult = await setFlySecret(app, secretName, base64Value)
      if (!setResult.ok) return setResult
      return restartFlyMachines(app)
    },
  }
}

/**
 * No-op store — retained for dev/preview where Fly relay env is absent. Records
 * intent (no token material) and returns success so the callback path is
 * exercisable without a real Machine.
 */
export function createNoOpTokenStore(): OAuthTokenStore {
  return {
    store(input) {
      console.warn(
        `[oauth/store] no-op store: token for customer=${input.customer_id} provider=${input.provider} reviewer=${input.reviewer_id} accepted but not persisted.`
      )
      return Promise.resolve({ ok: true })
    },
  }
}

/**
 * Default store: the Fly relay when `FLY_API_TOKEN` is configured, else the
 * no-op (local dev / preview). The relay itself re-checks env and returns
 * `unavailable` if misconfigured, so the callback always degrades gracefully.
 */
export function getDefaultTokenStore(): OAuthTokenStore {
  return env.FLY_API_TOKEN ? createFlySecretTokenStore() : createNoOpTokenStore()
}
