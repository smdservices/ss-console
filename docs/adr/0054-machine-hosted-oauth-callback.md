---
title: Connector OAuth Consent Lands on the Per-Customer Machine, Not the Shared Worker
date: 2026-06-24
status: accepted
captain: Scott Durgan
related-adr: 0007-per-customer-machine-isolation.md, 0036-per-customer-oauth-token-storage.md, 0043-operator-runtime-read-path.md, 0053-author-built-mcp-connectors-per-customer-installed.md
supersedes-for-connectors: 0036 (the Worker-relay path, for author-built connector consent)
---

# ADR 0054 — Connector OAuth Consent Lands on the Per-Customer Machine, Not the Shared Worker

**Status:** Accepted (Captain decision, 2026-06-24).

## Context

A firm-delegated (`authorization_code`) connector — first instance: `mcp:smokeball` for the Ashton & Price pilot — needs the firm to authorize the Operator to reach the firm's practice-management system. That yields a long-lived **refresh token** (Smokeball: 30 days) granting access to **privileged client-matter data**. The token must reach the firm's connector and never anything else.

The first implementation (ADR 0036, built for the portal Google/MS flow and extended to Smokeball) put the OAuth **callback + token relay on the shared, public `ss-web` Cloudflare Worker**: the firm's browser redirected to `smd.services/api/operator/smokeball/connect-callback`, the Worker exchanged the code, then **relayed the token to the customer Machine by setting a Fly app secret + restarting it** — which requires a **Fly API token on the public Worker**.

Standing this up surfaced the flaw. To set a secret on / restart per-customer Machines, the Worker needs a Fly token that can manage those apps; with a single Fly org owning every Operator app, that is **org-wide Fly control sitting on a public surface**. A compromise of `ss-web` would escalate from "leak some API keys" to "set secrets on, restart, or destroy **every** customer's Operator Machine, and exfiltrate every firm's practice-management credentials." That is a **central cross-customer chokepoint** — the precise failure mode [ADR 0007 (per-customer Machine isolation)](0007-per-customer-machine-isolation.md) exists to prevent — for the single most sensitive credential the product handles.

The Worker-relay never actually worked end-to-end (its `FLY_API_TOKEN` was never provisioned, and the OAuth state-signing key was never set), so retiring it for connectors costs no working behavior — and the entire firm-facing OAuth dance (login → Allow → code exchange → a valid refresh token) was proven working against our own staging tenant on 2026-06-24 before the relay was reached.

## Decision

**A firm-delegated connector's OAuth consent — the callback, the code exchange, and the token's resting place — lives entirely on that customer's own isolated Machine. The shared Worker is removed from the connector-credential path.**

1. **The redirect URI is the customer's Machine, not the Worker.** The firm's Smokeball app registers `https://hermes-<slug>.fly.dev/oauth/smokeball/callback`. The Machine already runs the only public HTTP surface it has — the webhook gateway (`webhook_gate.py`, the Fly `http_service` port) that already receives the `matter.updated` webhook. The OAuth callback is one more route on it.

2. **The Machine exchanges the code with its own credentials.** The gateway handler reads the Machine's own `SMOKEBALL_CLIENT_ID/SECRET` (already Fly secrets on that Machine) and POSTs to Smokeball's token endpoint over stdlib HTTPS. No shared client secret, no Worker call.

3. **The token rests only on that Machine, file-delivered (the Clio pattern).** The handler writes the refresh token to a hermes-owned `0600` file on the per-customer volume (`/opt/data/.smokeball-mcp/refresh_token`). The connector reads the file (falling back to the boot env var) and **rewrites it in place when Smokeball rotates the token** — so a rotated token survives restarts and the connector self-heals, exactly as `clio-mcp` does with `tokens.enc`. No Machine restart is needed to go live: the connector builds lazily on first tool call and picks up the file the moment it appears.

4. **State is authorized by a per-customer key, verified on the Machine (no Clerk, no Worker).** The firm is not a portal user, so the callback is authorized solely by a signed `state` (HMAC-SHA256 + short TTL + the bound `customer_id`). The signing key is **per-customer**, derived `HMAC(OPERATOR_OAUTH_STATE_MASTER, slug)` — the same master-and-slug derivation [ADR 0043](0043-operator-runtime-read-path.md) uses for the runtime-read key. The master lives only in the operator secret store (`/ss`); provisioning stages the **derived** key as a Fly secret on the Machine; the connect initiator derives the same key to sign. A state minted for customer X verifies **only** on customer X's Machine — cross-customer replay is impossible — and the handler additionally rejects any state whose `customer_id` is not its own slug.

5. **No standing infrastructure credential on the public Worker.** `ss-web` holds no Fly token and no Smokeball client secret for this flow. The blast radius of a connector's OAuth path is exactly one customer's Machine — the box that already holds that customer's data.

## Consequences

- **Isolation is restored as a property, not a hope.** Customer X's Smokeball credential is exchanged, stored, refreshed, and used entirely within X's Machine. There is no shared component that can reach across customers.
- **The Worker-relay (ADR 0036) is superseded for author-built connector consent.** The Smokeball callback (`src/pages/api/operator/smokeball/connect-callback.ts`), the Fly-secret relay (`relaySmokeballRefreshToken` in `src/lib/oauth/store.ts`), the Worker-side `exchangeSmokeballCode` provider, and the Smokeball client secrets on `ss-web` are removed. ADR 0036 still governs the **portal Google/MS** consent flow (a different surface, where the connecting party _is_ an authenticated portal user); revisiting that is out of scope here.
- **The connect initiator targets the Machine.** `bin/connect-smokeball.sh` emits `redirect_uri = https://hermes-<slug>.fly.dev/oauth/smokeball/callback` and signs with the per-customer derived key.
- **Residual, tracked as follow-ups (not blocking):** (a) the token file is hermes-readable, so a future `execute_code` compromise of the agent uid could read it — the same exposure the env-var token has today; tightening to a broker-owned store is hardening for later. (b) `OPERATOR_OAUTH_STATE_MASTER` is a new operator secret; rotating it re-derives every per-customer key on next provision.
- **Generalizes.** Every future firm-delegated connector (a Clio-via-auth-code, an M365 connector) uses this same Machine-hosted shape; nothing is Smokeball-specific except the token endpoint and scope set.
