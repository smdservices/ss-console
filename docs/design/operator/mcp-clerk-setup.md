# Clerk setup for the Operator MCP connector

**Status:** activation-gated. The console is deployed as a strict OAuth Resource
Server, but a customer remains dark until Clerk issues an access token bound to
that customer's canonical MCP resource.

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

## 3. Provision the stable principal

The authored connector remains readable:

```yaml
mcp_connector:
  enabled: true
  data_posture: open
  access:
    - email: scott@smd.services
      profile: crane
```

The email must resolve to a local `users` row for the same customer. That row
must have `users.clerk_user_id` populated with the exact Clerk user ID expected
in the token `sub`. If it is null, the connector fails closed.

When `entities.clerk_org_id` is populated, the token must also carry that exact
`org_id`. When the entity has no Clerk Organization, issuer + audience + subject
remain mandatory.

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
