---
title: OAuth Token Relay — Fly Secret + Machine Restart on Connect
date: 2026-06-02
status: accepted
captain: Scott Durgan
amends: 0010-per-customer-oauth-token-storage.md
related-spec: docs/specs/operator/oauth-lifecycle.md
related-adr: 0007-per-customer-machine-isolation.md, 0012-customer-yaml-storage.md
---

# ADR 0036 — OAuth Token Relay: Fly Secret + Machine Restart

**Status:** Accepted (Captain decision, 2026-06-02).

**Source:** Building the customer-facing "Connect Google" flow surfaced that the portal could exchange an OAuth code but **no provider's token ever reached the Machine** — `src/lib/oauth/store.ts` was a no-op for all providers. ADR 0010 mandated where tokens live (`/opt/data/oauth/<provider>.json` on the per-customer Fly volume) but deferred _how the portal-issued token gets there_ to "#879 follow-on." This ADR decides that mechanism.

## Decision

**The portal relays a freshly-exchanged token to the customer's Machine by setting a Fly app secret and restarting the Machine. The existing `bootstrap.sh` boot-decode writes the volume file — the same path `bin/provision-customer.sh` already uses.**

Concretely (`createFlySecretTokenStore` in `src/lib/oauth/store.ts`):

1. Resolve `customer_id` → Fly app via an **explicit registry** (not a `hermes-${id}` string convention — setting a secret on the wrong app is a cross-tenant leak vector; an unlisted customer is rejected `unknown_customer`). customer-zero `smd` → `hermes-smd`.
2. Build the **google-auth authorized-user JSON** the connectors read (see "Token shape" below), base64-encode it, and set the per-provider Fly app secret (`google-workspace` → `GOOGLE_TOKEN_JSON`) via the Fly GraphQL `setSecrets` mutation.
3. Restart **every** Machine in the app (Fly Machines API) so the new secret is applied — this mirrors `fly secrets set` (no `--stage`), which "updates each Machine ... restart of the Machine." A bare restart does NOT pick up a `--stage`d secret, so we set non-staged and restart.

**The relay only fires on connect / re-consent** — a rare, human-initiated event. Token _refresh_ self-maintains on the volume: the Python connectors (`operator/connectors/google/_google_auth.py`) rewrite the refreshed token to the file. So the restart cost is not paid on the hot path.

### Why not a Machine HTTP endpoint over the "Fly internal network"

The prior intent (store.ts comments, `oauth-lifecycle.md`, ADR 0010 §"#879") assumed the Worker would POST the token to a control-plane endpoint on the Machine "via the Fly internal network." That is wrong twice: (a) Cloudflare Workers are not on Fly's 6PN private network, so it would be a **public** token-write endpoint — a sensitive new attack surface to harden; (b) it requires a new overlay plugin + HMAC auth + Machine-hostname discovery. The Fly-secret path reuses infrastructure that already works (provisioning relies on it) and adds no public token endpoint. **This ADR supersedes that "private-network POST / TBD" intent.**

## Token shape (amends ADR 0010)

Verified against a live Machine (2026-06-02): the connectors call `google.oauth2.credentials.Credentials.from_authorized_user_file`, so the on-disk file is the **google-auth authorized-user JSON**:

```json
{ "token", "refresh_token", "token_uri", "client_id", "client_secret",
  "scopes": [...], "universe_domain": "googleapis.com", "account": "", "expiry": "<ISO-8601-Z>" }
```

This is **not** ADR 0010 §"Storage shape"'s documented `{access_token, refresh_token, scopes, expires_at, obtained_at, provider}`. ADR 0010's shape was aspirational and never matched the connector code. **The authoritative shape is the google-auth one above; ADR 0010 §"Storage shape" is amended to point here.** The relay converts the OAuth-exchange response (`expires_in`) to the absolute `expiry` google-auth expects.

## Safety properties

- **Refresh-token required.** A token with no `refresh_token` can't self-refresh and would silently die ~1h after connect. The relay rejects it (`missing_refresh_token`) and the settings page tells the principal to revoke at myaccount.google.com and reconnect — never clobbering a working token with a doomed one. (`access_type=offline` + `prompt=consent` make Google return one.)
- **No token in logs.** Fly API errors are logged as `status` + `fly-request-id` only — never the response body (which can echo the secret). Token material is never logged.
- **Half-success is loud.** If `setSecrets` succeeds but a Machine restart fails, the relay returns `unavailable` and logs a distinct error — the new token will apply on the next restart, not silently now.
- **Worker capability.** This gives the Worker a new power: set a customer app's secret + restart its Machine via `FLY_API_TOKEN` (a Worker secret, never a `[vars]` entry; SMD-owned, scoped to the customer apps it manages).

## Known limitations / follow-ons

- **Scope-subset protection is partial.** The relay can only see the _granted_ scopes, not what's already on the volume (Workers can't read it). It rejects a token missing `refresh_token`, but a re-grant that _narrows_ scopes (e.g. drops a capability) would still relay. Protecting the on-disk token from a subset re-grant requires tracking the last-relayed scope set in per-customer D1 — deferred.
- **Single-Machine invariant.** The relay restarts all Machines in the app; today each customer app is a single Machine (ADR 0007). If a customer ever scales to >1 Machine, the restart-all loop already covers it, but the propagation timing across machines is untested.
- **Registry.** The `customer_id → Fly app` map is a small explicit table in the store; it graduates to a `customer.yaml`/D1 lookup (ADR 0012) as customers are added.
- **Apply mechanism.** The non-staged-set + restart-all path is validated end-to-end by the customer-zero dogfood (a real connect). If a running Machine needs a `machine update` rather than a `restart` to re-pull the secret, that is a one-line change in `restartFlyMachines` surfaced loudly (connectors 401), not silently.

## Verification

- Unit: `tests/oauth-store.test.ts` (authorized-user JSON shape incl. absolute `expiry`; `setSecrets`→restart sequence; missing-refresh-token / unknown-customer / unavailable rejections; no token in logs). `tests/google-workspace-provider.test.ts` (authorize-URL + scopes).
- Dogfood: customer-zero clicks **Connect Google** → consent → relay sets `hermes-smd` `GOOGLE_TOKEN_JSON` + restart → boot writes the volume file → connectors work.

## References

- [ADR 0010](./0010-per-customer-oauth-token-storage.md) (amended: token shape + the relay mechanism it deferred)
- [ADR 0007](./0007-per-customer-machine-isolation.md), [ADR 0012](./0012-customer-yaml-storage.md)
- `docs/specs/operator/oauth-lifecycle.md` (reconciled: the relay is Fly-secret-set, not a private-network code proxy)
- `src/lib/oauth/store.ts`, `src/lib/oauth/providers/google-workspace.ts`
