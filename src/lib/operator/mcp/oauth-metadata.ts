/**
 * SPIKE SCAFFOLD (A0) — RFC 9728 OAuth Protected Resource Metadata.
 *
 * The MCP client (claude.ai / Claude Desktop) discovers where to authenticate by
 * fetching `/.well-known/oauth-protected-resource[/<resource-path>]` on the
 * resource server (this console). The document points at the customer's Clerk
 * Authorization Server (`authorization_servers`) and declares the resource id +
 * supported scopes. The client then runs the OAuth 2.1 + PKCE handshake against
 * Clerk and returns with a bearer token we validate in token-validation.ts.
 *
 * We BUILD this small document rather than adapt Clerk's
 * `protectedResourceHandlerClerk` (Next.js/Express-only). The shape is a stable
 * RFC, so the build cost is trivial and keeps us off the Node-bound helpers.
 *
 * Per-customer: `authorization_servers` lists the Clerk issuer(s) registered for
 * this resource. With one Clerk OAuth app per customer (the isolation mechanism),
 * a token minted by customer B's AS is issued by a different `iss` and is
 * rejected when validating against customer A — the discovery doc only tells a
 * client WHERE to authenticate; isolation is enforced at token validation, not
 * here. This document is PUBLIC and unauthenticated, so it carries no
 * customer-selecting power.
 */

/** RFC 9728 §2 protected-resource-metadata document (subset we emit). */
export interface ProtectedResourceMetadata {
  /** The resource identifier — the canonical URL of THIS MCP endpoint. */
  resource: string
  /** Authorization servers that can issue tokens for this resource. */
  authorization_servers: string[]
  /** OAuth scopes this resource understands. */
  scopes_supported: string[]
  /** How the bearer token is presented (header only). */
  bearer_methods_supported: string[]
}

/**
 * Build the protected-resource metadata for the MCP resource. `resourceUrl` is
 * the absolute customer resource URL (for example,
 * `https://smd.services/api/operator/smd/mcp`) — it
 * MUST match the `resource` the client used for discovery and the `aud` Clerk
 * binds (when it does). `authorizationServers` is the list of issuer URLs
 * registered for this resource (empty when none provisioned — an honest "no AS
 * configured" rather than a fabricated one).
 */
export function buildProtectedResourceMetadata(
  resourceUrl: string,
  authorizationServers: readonly string[],
  requireOrganization = false
): ProtectedResourceMetadata {
  return {
    resource: resourceUrl,
    authorization_servers: [...authorizationServers],
    scopes_supported: buildMcpScopes(requireOrganization),
    bearer_methods_supported: ['header'],
  }
}

/**
 * The RFC 9728 §5.1 `WWW-Authenticate` challenge value a 401 from the MCP
 * endpoint must carry, pointing the client at the metadata document so it can
 * (re)discover the AS. `resourceMetadataUrl` is the absolute
 * `/.well-known/oauth-protected-resource/...` URL for this resource.
 */
export function buildWwwAuthenticate(
  resourceMetadataUrl: string,
  requireOrganization = false
): string {
  const scope = buildMcpScopes(requireOrganization).join(' ')
  return `Bearer resource_metadata="${resourceMetadataUrl}", scope="${scope}"`
}

function buildMcpScopes(requireOrganization: boolean): string[] {
  const scopes = ['openid', 'profile', 'email']
  if (requireOrganization) scopes.push('user:org:read')
  return scopes
}
