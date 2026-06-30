# Clerk setup for the Operator MCP connector

**Status:** access model locked by [ADR 0057](../../adr/0057-operator-claude-connector-access-model.md); console shipped (slices 2a–2c + 2e). The console is a strict OAuth Resource Server. Per-customer activation needs (1) a Clerk binding row, (2) an authored `mcp_connector` policy, and (3) the live token-triple verify. (The slice-2d screening-attestation gate was removed — see amended ADR 0057 §4.)

## Authoritative model (ADR 0057)

**Clerk proves who knocks; the Operator's grant table decides whether to open.** Clerk authenticates a firm user by **mailbox possession** and issues the token; SMD's `mcp_issued_grants` table is the live authorization and instant kill switch. Two decisions from ADR 0057 + the build:

- **One dedicated operator-fleet Clerk instance for external firms**, not one per firm. Isolation rests on the grant table (the authoritative per-request gate), so a single instance authenticating any firm-domain mailbox is sufficient; the per-customer Clerk app was belt-and-suspenders from before the grant table existed. Customer-zero (`smd`) may stay on `clerk.smd.services`; external firms share the fleet instance. (If a regulated client demands structural token isolation, a dedicated per-client instance remains the escape hatch — mirrors the on-Machine-sidecar posture in 03 §2.3.)
- **Email OTP code, not magic link, for the in-flow factor.** A magic link clicked from a mail client often opens a _different_ browser than Claude Desktop's OAuth tab, breaking the PKCE/state binding; a 6-digit code typed back into the same tab never leaves the originating browser. Same mailbox-possession identity ADR 0057 intends — an implementation refinement of its "email-link" wording.
- **Set the Clerk session lifetime to the grant `ttl_days`** so re-auth is forced at the same cadence the grant expires.

> **Open verification (offboarding backstop).** The passive-lapse offboarding story ("kill the mailbox → re-auth fails → access lapses within TTL") holds only if Clerk's **refresh-token absolute expiry ≤ the grant TTL**. This must be confirmed empirically (`crane_verify`) before relying on passive lapse. If Clerk rotates refresh tokens indefinitely, the grant `expires_at` + explicit admin revoke is the real backstop, and passive mailbox-kill is secondary.

## Responsibility split

- **Clerk authenticates.** It runs OAuth Authorization Code + PKCE, obtains user
  consent, and issues the access token.
- **Operator authorizes.** The console validates the exact issuer and resource,
  maps the Clerk `sub` to `users.clerk_user_id`, applies the authored
  `mcp_connector.access[]` profile binding, and then applies Operator tool and
  action-class policy.
- **No fallback exists.** An issuer-valid token without the exact resource
  audience is rejected. Email is authoring and display metadata, not the runtime
  principal.

For SMD, the canonical resource is:

```text
https://smd.services/api/operator/smd/mcp
```

Its protected-resource metadata is:

```text
https://smd.services/.well-known/oauth-protected-resource/api/operator/smd/mcp
```

## 1. Clerk instance and client registration

SMD customer-zero uses `https://clerk.smd.services`.

Claude clients commonly require Dynamic Client Registration (DCR). Enable DCR
only if the target Claude client cannot use a pre-registered public client.
Clerk warns that DCR exposes an unauthenticated client-registration endpoint, so
the consent screen must remain enabled and registrations must be monitored.

Verify Clerk metadata before testing:

```bash
curl -s https://clerk.smd.services/.well-known/oauth-authorization-server
```

Required capabilities:

- Authorization Code and refresh-token grants
- Public-client token authentication (`none`)
- PKCE `S256`
- A client-registration mechanism Claude supports
- JWT access tokens signed by the advertised JWKS

Request `openid profile email user:org:read` when Organizations are enabled.
`user:org:read` lets the user select an Organization and causes Clerk to include
`org_id` in the token.

## 2. Provision the customer binding

Migration 0072 requires one canonical resource URI per customer:

| Field           | SMD value                                       |
| --------------- | ----------------------------------------------- |
| `entity_id`     | `f03ffe58-db0d-47bb-a409-922a7ee62ea7`          |
| `customer_slug` | `smd`                                           |
| `issuer`        | `https://clerk.smd.services`                    |
| `resource_uri`  | `https://smd.services/api/operator/smd/mcp`     |
| `client_id`     | Optional provenance for a pre-registered client |
| `clerk_app_id`  | Optional provenance for a Clerk-managed app     |

`resource_uri` is mandatory. `client_id` does not replace audience validation.

## 3. Author the connector, then issue grants

The authored connector (slice 2c adds `policy` / `allowed_domains` /
`default_profile` / `ttl_days`, distinct from `data_posture`):

```yaml
mcp_connector:
  enabled: true
  data_posture: open # where entitled data may land (personal vs firm Claude)
  policy: allowlist # who may connect: allowlist (default, pilot) | open
  # open-policy only (slice 2e auto-issue):
  # allowed_domains: [firm.com]
  # default_profile: crane
  ttl_days: 30 # per-client grant TTL, bounded [1, 90], never infinite
  access:
    - email: scott@smd.services
      profile: crane
      clerk_subjects:
        - user_3EEs0aMBRgu6PRxBa4g5YhHjggD
        - user_3E1RPGrTMxkSqciXMTyybUNSJWu
```

The email resolves the local customer user. `clerk_subjects`, when present,
authorizes the exact Clerk accounts the user may employ for Claude even when
those accounts carry different emails. The singular `clerk_subject` remains
supported for one-account bindings. When both are omitted, the connector falls
back to that local user's `users.clerk_user_id`. If none is present, it fails
closed.

**Grants are the live authorization (ADR 0057).** Authored `access[]` entries
seat static principals; the dynamic layer + kill switch is `mcp_issued_grants`,
issued/revoked from the admin connectors page
(`POST /api/admin/operator/<slug>/mcp-grants`, slice 2b) and recorded immutably in
`operator_mcp_grant_audit`. Revoking cuts access on the next request. Under
`policy: open`, a verified firm-domain identity is JIT-granted on first connect
(slice 2e).

When `entities.clerk_org_id` is populated, the token must also carry that exact
`org_id`. A non-empty token audience must exactly include the MCP resource URI.
Clerk dynamically registered clients currently omit `aud`; in that case the
exact issuer plus the customer-scoped Clerk subject allowlist is mandatory.

## 4. Deploy and activate

Migration 0072 is an expand migration. It backfills `resource_uri`, enforces it
for future writes, and preserves the legacy columns until a later contract
migration. The production workflow applies D1 migrations before publishing the
application that depends on them.

Keep the connector dark until the Clerk token contract passes the checks below.

Add the custom connector in Claude using:

```text
https://smd.services/api/operator/smd/mcp
```

Complete Clerk sign-in and consent, then verify:

1. The token `iss` is exactly `https://clerk.smd.services`.
2. The token `aud` contains
   `https://smd.services/api/operator/smd/mcp`.
3. The token `sub` equals Scott's provisioned `users.clerk_user_id`.
4. If SMD has `entities.clerk_org_id`, the token `org_id` matches it.
5. `tools/list` succeeds.
6. `operator_status` returns live customer-zero data.
7. A token for another resource returns 401 before any runtime read.

If Clerk does not issue the exact resource audience, stop. File the OAuth trace
and event IDs with Clerk support. Do not set a null audience, accept issuer-only
tokens, or build a local Authorization Server.

## Cleanup

- Remove the localhost test redirect URI after controlled testing.
- Delete the incorrectly named `CLERK_SECRET_KEY` OAuth-client secret from
  Infisical. The MCP Resource Server needs no OAuth client secret.
- Keep the legacy `https://smd.services/api/mcp` connector removed. It returns
  410 and is not an alias for customer-zero.

## References

- Clerk MCP client guide:
  https://clerk.com/docs/guides/ai/mcp/connect-mcp-client
- Clerk OAuth implementation:
  https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth
- MCP authorization specification:
  https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- RFC 9728: https://datatracker.ietf.org/doc/html/rfc9728
- RFC 8707: https://www.rfc-editor.org/rfc/rfc8707.html
