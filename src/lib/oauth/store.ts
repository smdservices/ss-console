/**
 * OAuth token storage interface.
 *
 * Per [ADR 0010](../../../docs/adr/0010-per-customer-oauth-token-storage.md),
 * customer-side OAuth tokens (Gmail, MS Graph, etc.) live on the
 * customer's per-Machine Fly volume at `/opt/data/oauth/<provider>.json`,
 * NOT in Infisical and NOT in a shared store on this Worker. The Worker
 * receives the OAuth callback (because the redirect URI must be a
 * publicly addressable, TLS-fronted endpoint) but it does not own the
 * token. Its job is to relay the token to the customer's Fly Machine.
 *
 * Storage interface contract:
 *
 *   The Worker POSTs the token payload to an authenticated control-plane
 *   endpoint on the customer's Hermes Machine (private network or signed
 *   request, TBD with per-Machine wiring in #850 / #878 follow-ons), and
 *   the Machine writes `/opt/data/oauth/<provider>.json` atomically per
 *   ADR 0010 § "Storage shape". The Worker never holds the token in
 *   memory longer than the duration of the relay.
 *
 * Why per-Machine HTTP relay rather than direct volume write: Cloudflare
 * Workers do not have filesystem access to Fly volumes (different
 * platforms, different trust boundaries). The Machine is the only thing
 * with the volume mounted. ADR 0010's "Workers can't do that" point is
 * resolved by treating the Worker as a thin OAuth front door that hands
 * the token off; the Machine owns persistence.
 *
 * v1 status: the per-Machine relay endpoint and the customer registry it
 * needs (Machine hostname + auth token per customer_id) are not yet
 * wired. This file ships the interface plus a no-op implementation that
 * records the storage intent in the audit log and returns success. The
 * no-op lets the callback path be exercised end-to-end (state issuance,
 * provider exchange, dashboard redirect) without requiring a real
 * Hermes Machine to be running. Follow-on issue: TODO #879-follow-on
 * (file when Hermes Machine control plane lands per #850).
 */

import type { ProviderTokenResponse } from './providers.js'

export interface StoreTokenInput {
  customer_id: string
  provider: string
  reviewer_id: string
  token: ProviderTokenResponse
}

export type StoreTokenResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'rejected' | 'unknown_customer' | 'network' }

export interface OAuthTokenStore {
  store(input: StoreTokenInput): Promise<StoreTokenResult>
}

/**
 * No-op token store for v1. Records the storage attempt to console (with
 * NO token material) and returns success so the callback redirect can
 * complete. Replaced by `createMachineRelayStore` once the Hermes
 * Machine control plane endpoints are available.
 *
 * This is deliberately a separate symbol from the interface so the
 * eventual swap to a real implementation is a one-line callback edit.
 */
export function createNoOpTokenStore(): OAuthTokenStore {
  return {
    store(input) {
      console.warn(
        `[oauth/store] no-op store: token for customer=${input.customer_id} provider=${input.provider} reviewer=${input.reviewer_id} accepted but not persisted. Wire the Hermes Machine relay (ADR 0010, follow-on to #879) before going to production.`
      )
      return Promise.resolve({ ok: true })
    },
  }
}

/**
 * Default store selection for the callback endpoint. Returns the no-op
 * store until the Machine relay lands; callers should not need to know.
 */
export function getDefaultTokenStore(): OAuthTokenStore {
  return createNoOpTokenStore()
}
