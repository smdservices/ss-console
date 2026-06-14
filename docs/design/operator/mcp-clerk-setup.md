# Clerk setup for the Operator ⇄ Claude MCP connector (Captain runbook)

**Status:** A0 spike. This guide is what unblocks the live spike — it walks the
Captain through creating a per-customer Clerk OAuth application and copying the
values the console needs to validate tokens. Everything in `src/lib/operator/mcp/`
typechecks and is unit-tested, but cannot be exercised end-to-end (real
`claude.ai` connector add → OAuth → authed `tools/call`) until a real Clerk app
exists and its issuer is wired into the customer descriptor.

Audience: the Captain (Scott). Mechanical, click-by-click. Where a value must be
copied into config, the field name is in **bold** and the destination is named.

---

## 0. Background: what Clerk is doing here

The console is an **OAuth 2.1 Resource Server**. Clerk is the **Authorization
Server (AS)**. The flow:

1. A client org's Claude (claude.ai custom connector / Claude Desktop) is pointed
   at our MCP endpoint: `https://smd.services/api/mcp`.
2. Claude fetches `https://smd.services/.well-known/oauth-protected-resource/api/mcp`
   (RFC 9728). That document names the customer's Clerk instance as the AS.
3. Claude runs OAuth 2.1 + PKCE against Clerk. The user signs in with their Clerk
   identity. Clerk issues an **OAuth access token** (a signed RS256 JWT).
4. Claude calls `POST /api/mcp` with `Authorization: Bearer <token>`.
5. The console validates the token, security-ordered: verify signature (Clerk's
   JWKS) → **derive which customer the token is for from its verified `aud`**
   (else the per-customer `iss`) → enforce that customer's binding (`iss`/`azp`) →
   map the identity (`email`) to the customer's authored `mcp_connector.access[]`.
   The customer is taken from the **token**, never from the URL or body; a token
   whose `aud` matches no customer 401s before any data access. No authored
   access entry ⇒ 401 (fail-closed).

**One Clerk OAuth application per customer** is the isolation mechanism for the
pilot (see §6, the audience open question). Customer B's token is issued by a
different Clerk app / issuer and will not validate against customer A.

---

## 1. Pick the Clerk instance

SMD already runs a Clerk application **"SMD Services"** (see `astro.config.mjs`).
The pilot customer (customer-zero, `smd`) uses **that same Clerk instance** — the
pilot user already has an identity there.

- For a real external client later, the decision is: a **separate Clerk
  application** under SMD's Clerk account per client org (recommended — clean
  issuer isolation), vs. one shared instance with per-app OAuth clients. For the
  pilot, reuse the existing SMD Services instance.

Dashboard home: **https://dashboard.clerk.com**

---

## 2. Create the OAuth application

1. In the Clerk Dashboard, open the OAuth applications page directly:
   **https://dashboard.clerk.com/~/oauth-applications**
   (Or: left sidebar → **Configure** → **OAuth applications**.)
2. Click **Add OAuth application**. A modal opens.
3. **Name:** `SMD Operator MCP — <customer slug>` (e.g. `SMD Operator MCP — smd`).
   The name is only for your own identification.
4. **Scopes:** enable exactly these three:
   - `openid`
   - `profile`
   - `email` ← **required.** The console maps the token's `email` claim to
     `mcp_connector.access[]`. Without the `email` scope the token carries no
     email, the identity mapping fails, and every call 401s. (See the SEAM NOTE
     in `token-validation.ts` for the Backend-API `sub`→email fallback — not
     wired in the spike, so `email` scope is mandatory for now.)
5. Click **Add**.

---

## 3. Copy the credentials (and where each goes)

After you click **Add**, Clerk shows the **Client Secret once** and then the
app's settings page.

| Clerk dashboard field | Where it lives                           | Notes                                                                                                                                                                                                             |
| --------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Client Secret**     | Worker secret (later slice)              | Shown once. Copy it now into Infisical `/ss` as `MCP_CLERK_CLIENT_SECRET_<slug>` (or hold it). Confidential clients only; if you register Claude via DCR (public client) you may not need it.                     |
| **Client ID**         | `ClerkCustomerBinding.authorizedParties` | Settings page → **Application credentials** → **Client ID**. This is the `azp` value the console pins.                                                                                                            |
| **Discovery URL**     | derive the **issuer** from it            | Settings page → **Application configuration URLs** → **Discovery URL**. It looks like `https://<issuer>/.well-known/openid-configuration`. The **issuer** is that URL with the `/.well-known/...` suffix removed. |

### The issuer + JWKS

- **Issuer** (`iss`): the origin of the Discovery URL. For an SMD production
  instance this is typically `https://clerk.smd.services`; for a dev instance it
  is `https://<slug>.clerk.accounts.dev`. The console pins `iss` to this exact
  string (`ClerkCustomerBinding.issuer`).
- **JWKS:** the console does **not** need the JWKS URL hand-copied —
  `@clerk/backend`'s `verifyToken` discovers and caches the JWKS from the token's
  issuer automatically. (The JWKS is at `<issuer>/.well-known/jwks.json` if you
  ever want to inspect it.)

---

## 4. Redirect URIs

The redirect URI is where Clerk sends the user back after they authenticate.
**The MCP client supplies this**, not the console.

- **claude.ai custom connector:** when you add the connector in the claude.ai UI,
  claude.ai tells you the redirect URI to register. Paste it into the Clerk app's
  **Redirect URIs** field (Settings page). It will be a `https://claude.ai/...`
  callback URL.
- **Claude Desktop:** Desktop uses a localhost loopback redirect
  (`http://localhost:<port>/...` or a custom scheme). Register whatever Desktop
  shows you. (Localhost redirects are standard for native OAuth clients.)
- If you enable **Dynamic Client Registration** (§5), the client registers its own
  redirect URI automatically and you do not hand-enter it.

> Add the redirect URI **before** completing the connector add in Claude, or the
> first OAuth round-trip fails with `redirect_uri_mismatch`.

---

## 5. Dynamic Client Registration (DCR) vs. pre-registered

Clerk supports **Dynamic Client Registration** (RFC 7591) — a toggle on the
OAuth applications page (**Dynamic client registration**).

- **For the pilot: leave DCR OFF and pre-register the client** (one OAuth app,
  redirect URI hand-entered per §4). Simpler, fewer moving parts, and the pilot is
  a single known client. This matches the build plan's "Out of scope (Phase 1):
  DCR-based multi-client onboarding."
- **DCR ON** is the path for onboarding many client orgs without hand-creating an
  app each time (claude.ai registers itself). Revisit when the connector graduates
  past the single pilot.

---

## 6. OPEN QUESTION for the Captain — does Clerk bind a per-resource `aud`? (RFC 8707)

This is the one thing the spike cannot answer from docs and needs you to confirm
against a **real minted token**. It decides the cross-tenant isolation story.

**Why it matters.** The MCP authorization spec (2025-11-25 / 2026-03-15) mandates
RFC 8707 **resource indicators**: the client sends a `resource` parameter naming
our endpoint, and a compliant AS binds the token's `aud` claim to that resource.
The resource server (us) MUST then reject any token whose `aud` is not our
resource. This is what stops a token minted for one resource being replayed at
another ("confused-deputy" / token mis-redemption).

**What to check.** After you complete one OAuth handshake (the A0 spike), decode
the issued access token (paste it into https://jwt.io or inspect it in the
console logs) and look at the `aud` claim:

- **If `aud` equals `https://smd.services/api/mcp`** (our resource URL): Clerk
  binds a per-resource audience. Set `ClerkCustomerBinding.audience` to that exact
  string in the customer descriptor. The console then enforces it via
  `verifyToken({ audience })` — best-in-class isolation, spec-compliant.
- **If `aud` is absent, or is a generic value** (e.g. the instance or client id,
  not our resource URL): Clerk does **not** resource-bind `aud` for this token
  type. Leave `ClerkCustomerBinding.audience = null` and rely on the **fallback
  isolation**: one Clerk OAuth app per customer + the per-customer **issuer pin**
  (`iss` must equal this customer's instance) + the **`azp`/Client ID pin**
  (`authorizedParties`). The console already enforces all three. A customer-B
  token then fails customer A because its `iss` (and `azp`) are a different app.

**Record the answer** in this file (edit the line below) once confirmed, so the
next person provisioning a customer knows which isolation mode is in force:

> **Audience binding status:** _TBD — Captain to confirm against a real token._

Either way the console is safe: the fallback (issuer + azp pin, one app per
customer) is enforced unconditionally, and the audience check layers on top when
available.

---

## 7. Wire the values into the console (where the spike stub is)

The spike ships a single hard-coded descriptor in
`src/lib/operator/mcp/customer-resolution.ts` (`PILOT_STUB`). To light up the live
path for the pilot:

1. Set `PILOT_STUB.clerk.issuer` to the issuer from §3 (e.g.
   `https://clerk.smd.services`).
2. Set `PILOT_STUB.clerk.authorizedParties` to `[<Client ID>]` from §3.
3. Set `PILOT_STUB.clerk.audience` per the §6 finding (the resource URL, or null).
4. Set `PILOT_STUB.connector` from the pilot's real `mcp_connector` block — most
   importantly `enabled: true` and the `access: [{ email, profile }]` entry for
   the pilot user. (Live slice: read this from the materialized `customer.yaml`
   instead of hard-coding — that is the documented next slice, not the spike.)

Until step 4 authors a real `access[]`, the endpoint **fail-closes**: a Clerk-valid
token still 401s because its email is not authored. That is the correct posture —
the spike cannot grant access to anyone until a real config is wired in.

---

## 8. What the Captain runs to finish A0 (the part the agent cannot do)

The agent built and unit-tested everything that does not need a live Clerk app.
The signature-verification path and the real OAuth round-trip need a live app +
a real client. The Captain's A0 steps:

1. Create the Clerk OAuth app (§2–§3).
2. Wire `PILOT_STUB` (§7) and deploy the console (or run it against a dev Clerk
   instance).
3. Add the connector in claude.ai pointed at `https://smd.services/api/mcp`
   (register the redirect URI it gives you, §4).
4. Complete the OAuth sign-in. Confirm one authed `tools/list` + one
   `operator_status` `tools/call` returns the stub payload.
5. Decode the token and **answer the §6 audience question**; set `audience`
   accordingly.
6. Negative test (build-plan A1): a token minted for a different Clerk app/issuer
   must 401. Once a second customer exists, this becomes the cross-tenant test
   added to the operator-substrate suite.

---

## Reference

- Clerk OAuth applications: https://dashboard.clerk.com/~/oauth-applications
- Clerk — how Clerk implements OAuth (DCR, scopes):
  https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth
- Clerk — verifying OAuth access tokens:
  https://clerk.com/docs/guides/configure/auth-strategies/oauth/verify-oauth-tokens
- RFC 9728 (Protected Resource Metadata): https://datatracker.ietf.org/doc/html/rfc9728
- RFC 8707 (Resource Indicators): https://www.rfc-editor.org/rfc/rfc8707.html
- MCP authorization spec:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
