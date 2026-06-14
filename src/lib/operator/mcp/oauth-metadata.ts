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
 * Per-customer: `authorization_servers` is the customer's Clerk issuer. With one
 * Clerk OAuth app per customer (the spike's isolation mechanism), each customer’s
 * resource advertises its own AS — so a token minted by customer B’s AS is
 * issued by a different `iss` and fails customer A’s issuer pin.
 */

import type { ResolvedMcpCustomer } from './customer-resolution'

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
 * Build the protected-resource metadata for a resolved customer.
 * `resourceUrl` is the absolute URL of the MCP endpoint (e.g.
 * `https://smd.services/api/mcp`) — it MUST match the `resource` the client used
 * for discovery and the `aud` Clerk binds (when it does).
 */
export function buildProtectedResourceMetadata(
  resourceUrl: string,
  customer: ResolvedMcpCustomer
): ProtectedResourceMetadata {
  return {
    resource: resourceUrl,
    // When the issuer is not yet provisioned (spike stub), advertise an empty
    // list — an honest "no AS configured" rather than a fabricated one.
    authorization_servers: customer.clerk.issuer ? [customer.clerk.issuer] : [],
    scopes_supported: ['openid', 'profile', 'email'],
    bearer_methods_supported: ['header'],
  }
}

/**
 * The RFC 9728 §5.1 `WWW-Authenticate` challenge value a 401 from the MCP
 * endpoint must carry, pointing the client at the metadata document so it can
 * (re)discover the AS. `resourceMetadataUrl` is the absolute
 * `/.well-known/oauth-protected-resource/...` URL for this resource.
 */
export function buildWwwAuthenticate(resourceMetadataUrl: string): string {
  return `Bearer resource_metadata="${resourceMetadataUrl}"`
}
