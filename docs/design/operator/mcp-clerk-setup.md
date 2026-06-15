# Clerk setup for the Operator ⇄ Claude MCP connector (Captain runbook)

**Status:** live (DCR model). This guide is what stands up the connector for a
customer end-to-end: a real `claude.ai` connector add → OAuth → authed
`tools/call`. The console code (`src/lib/operator/mcp/`) is DB-backed and the
data plane (migration 0071) is deployed; what remains is a Clerk instance
setting (one toggle) plus recording the customer's issuer, both covered below.

Audience: the Captain (Scott). Mechanical. Where a value must be copied into
config, the field name is in **bold** and the destination is named.

> **Why DCR, not a pre-created OAuth app.** Clerk's own docs: _"For most client
> implementations of MCP, dynamic client registration is required."_ claude.ai
> self-registers its OAuth client during the flow — so we do **not** pre-create a
> per-customer OAuth app or manage a client id / secret. We enable **Dynamic
> Client Registration (DCR)** on the customer's Clerk instance and record only
> the instance **issuer**. Isolation rests on the per-customer issuer pin +
> Clerk's auto-enforced consent screen + the authored `mcp_connector.access[]`
> per-user gate.

---

## 0. Background: what Clerk is doing here

The console is an **OAuth 2.1 Resource Server**. Clerk is the **Authorization
Server (AS)**. The flow:

1. A client org's Claude (claude.ai custom connector / Claude Desktop) is pointed
   at our MCP endpoint: `https://smd.services/api/mcp`.
2. Claude fetches `https://smd.services/.well-known/oauth-protected-resource/api/mcp`
   (RFC 9728). That document names the customer's Clerk instance as the AS.
3. Claude **dynamically registers** itself with Clerk (RFC 7591 DCR), then runs
   OAuth 2.1 + PKCE. The user signs in with their Clerk identity and approves the
   **consent screen** (auto-enforced whenever DCR is on). Clerk issues an **OAuth
   access token** (a signed RS256 JWT).
4. Claude calls `POST /api/mcp` with `Authorization: Bearer <token>`.
5. The console validates the token, security-ordered: verify signature (Clerk's
   JWKS) → **derive which customer the token is for from its verified `aud`**
   (else the per-customer `iss`) → enforce that customer's binding (issuer pin) →
   map the identity (`email`) to the customer's authored `mcp_connector.access[]`.
   The customer is taken from the **token**, never from the URL or body; a token
   whose claims match no customer 401s before any data access. No authored access
   entry ⇒ 401 (fail-closed).

**Isolation under DCR.** With DCR, the OAuth client id (`azp`) is dynamic and
unknown to us, so it is **not** pinned. The cross-tenant wall is: (a) the
per-customer **issuer** — a token from customer B's Clerk instance has a
different `iss` and resolves to a different (or no) customer; (b) Clerk's
**consent screen**; and (c) the authored **`access[]`** email gate — only
authored emails with a valid identity in that instance pass.

---

## 1. Pick the Clerk instance

For the SMD dogfood (customer-zero, `smd`), the connector uses **SMD's existing
Clerk instance** — `https://clerk.smd.services` — the same instance that backs
admin/portal login. Scott already has an identity there.

- For a real external client later, the recommended pattern is a **separate Clerk
  instance per client org** (clean issuer isolation, and the DCR registration
  surface is scoped away from any production auth instance). The dogfood reuses
  SMD's instance deliberately, accepting that DCR opens a public client-
  registration endpoint on it (mitigated by the consent screen + `access[]`).

Dashboard home: **https://dashboard.clerk.com**

---

## 2. Enable Dynamic Client Registration (the one toggle)

This is the single manual Clerk-side setup step.

1. In the Clerk Dashboard, open the OAuth applications page:
   **https://dashboard.clerk.com/~/oauth-applications**
   (Or: left sidebar → **Configure** → **OAuth applications**.)
2. Enable **Dynamic client registration**.
3. Note: enabling DCR **auto-enforces the OAuth consent screen** (Clerk does this
   to prevent CSRF; it cannot be disabled while DCR is on). That is the desired
   posture.

**Verify it took.** Re-fetch the instance's discovery document and confirm a
`registration_endpoint` now appears (it is absent when DCR is off):

```bash
curl -s https://clerk.smd.services/.well-known/openid-configuration \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('registration_endpoint','(none — DCR still off)'))"
```

> Confirm the token's scopes include `email`. SMD's instance already advertises
> `email` in `scopes_supported`; the console maps the token's `email` claim to
> `mcp_connector.access[]`, so without it every call 401s.

---

## 3. Record the customer's issuer in the binding (agent-run)

No OAuth app to create, no client id/secret to copy. The only per-customer Clerk
fact the console needs is the **issuer**, written to the `mcp_clerk_bindings`
table (migration 0071) keyed on the customer's `entity_id`:

| Field           | Value (SMD)                                            |
| --------------- | ------------------------------------------------------ |
| `entity_id`     | `f03ffe58-db0d-47bb-a409-922a7ee62ea7`                 |
| `customer_slug` | `smd`                                                  |
| `issuer`        | `https://clerk.smd.services` (from §2's discovery doc) |
| `client_id`     | `NULL` (DCR — dynamic)                                 |
| `audience`      | `NULL` (until §5 confirms RFC 8707; see below)         |
| `clerk_app_id`  | `NULL` (no app we own)                                 |

The agent writes this row with a `wrangler d1 execute --remote` UPSERT (see
`docs/design/operator/03-mcp-server-exposure.md` and the provisioning notes).
Once the row exists, the public discovery doc the console serves advertises
`authorization_servers: ["https://clerk.smd.services"]`.

---

## 4. Author the `mcp_connector` block (agent-run)

In `operator/customers/<slug>/customer.yaml`, author the connector + the per-user
`access[]`. For SMD:

```yaml
mcp_connector:
  enabled: true
  data_posture: open
  access:
    - email: scott@smd.services # MUST match a users[] email AND the Clerk identity email
      profile: crane
```

Then the projection (`scripts/project-customer-config.ts` →
`wrangler d1 execute --remote`) writes `customer_configs.mcp_connector_json`.
Until both the binding row (§3) and this projection exist, the endpoint stays
**dark** — every token 401s.

> **Email match is the one gotcha.** `access[].email` must equal the email on the
> user's Clerk identity (the OAuth token's `email` claim), case-insensitive. If
> Scott's `clerk.smd.services` login uses a different email than
> `scott@smd.services`, add that email to BOTH `users[]` and `access[]` and
> re-project — otherwise the per-user check fail-closes with `identity_not_authored`.

---

## 5. Add the connector in Claude + answer the audience question

The irreducible Captain step (your account, your consent — cannot be automated):

1. In claude.ai, add a custom connector pointed at `https://smd.services/api/mcp`.
2. Claude discovers the AS, dynamically registers, and shows Clerk's sign-in +
   consent screen. Sign in as Scott and approve.
3. Confirm one authed `tools/list` and one `operator_status` `tools/call` return
   real data (the Operator's recent activity).

**Then answer the RFC 8707 audience question** (the one thing only a real token
can settle). Decode the issued access token (paste into https://jwt.io or read it
from the console logs) and look at `aud`:

- **If `aud` equals `https://smd.services/api/mcp`** (our resource URL): Clerk
  binds a per-resource audience. Set `mcp_clerk_bindings.audience` to that exact
  string for the customer — best-in-class, spec-compliant mis-redemption
  protection layered on top of the issuer pin.
- **If `aud` is absent or generic**: leave `audience = NULL` and rely on the
  issuer pin + consent screen + `access[]` (already enforced unconditionally).

> **Audience binding status:** _TBD — confirm against a real token on first connect._

Either way the console is safe: the issuer pin + `access[]` gate are enforced
unconditionally, and the audience check layers on top when available.

---

## Reference

- Clerk — how Clerk implements OAuth (DCR):
  https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth
- Clerk — connect an MCP client (DCR requirement):
  https://clerk.com/docs/guides/ai/mcp/connect-mcp-client
- RFC 9728 (Protected Resource Metadata): https://datatracker.ietf.org/doc/html/rfc9728
- RFC 7591 (Dynamic Client Registration): https://www.rfc-editor.org/rfc/rfc7591
- RFC 8707 (Resource Indicators): https://www.rfc-editor.org/rfc/rfc8707.html
- MCP authorization spec:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
