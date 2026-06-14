/**
 * SPIKE SCAFFOLD (A0) — customer-resolution seam for the Operator ⇄ Claude MCP
 * connector. See docs/design/operator/03-mcp-server-exposure.md and the build
 * plan (Workstream A). This is the one seam the spike deliberately stubs: it
 * answers "which customer does this MCP request serve, and what is that
 * customer's authored `mcp_connector` block + Clerk binding?"
 *
 * Why a seam (and not the real customer.yaml read yet): the live path needs to
 * (a) load the customer's materialized `customer.yaml` (the same source the
 * portal projection reads) to get `mcp_connector.access[]`, and (b) load the
 * per-customer Clerk app binding (issuer + audience + JWKS) that the Captain
 * provisions per the Clerk setup guide. Both land in later slices (C1's block is
 * authored; C2 provisions the Clerk app). For the spike, a single hard-coded
 * pilot descriptor lets the endpoint typecheck and exercise discovery + JWT
 * validation end-to-end against a real Clerk app once the Captain creates one.
 *
 * Fail-closed: an unknown resource id resolves to `null` → the endpoint refuses
 * (no customer ⇒ no Operator). This mirrors `resolveCustomerFlyApp` in
 * fly-app-registry.ts, which the live implementation will extend rather than
 * duplicate.
 */

import type { McpConnector } from '../customer-yaml/types'

/**
 * The per-customer Clerk OAuth binding the token validator needs. One Clerk
 * OAuth application per customer is the spike's isolation mechanism (see the
 * `aud`-binding open question in the Clerk setup guide): even if Clerk does not
 * bind a per-resource `aud`, pinning the issuer + authorized client per customer
 * keeps customer B's token from validating against customer A.
 */
export interface ClerkCustomerBinding {
  /**
   * The customer's Clerk instance issuer, e.g.
   * `https://clerk.smd.services` (prod) or `https://<slug>.clerk.accounts.dev`
   * (dev). Copied from the Clerk dashboard per the setup guide. The token's
   * `iss` claim MUST equal this exactly.
   */
  issuer: string
  /**
   * Expected audience for tokens minted for this customer's MCP resource, when
   * Clerk binds a per-resource `aud` (RFC 8707). `null` when the instance does
   * not emit a resource-bound `aud` — in that case isolation rests on the
   * per-customer issuer + authorized-party pin instead. See the setup guide.
   */
  audience: string | null
  /**
   * Authorized-party (`azp`) / client id values permitted for this customer's
   * OAuth app. Used as the `authorizedParties` check in `verifyToken`. Empty
   * array ⇒ the azp check is skipped (acceptable only when `audience` is set).
   */
  authorizedParties: string[]
}

/**
 * Everything the MCP endpoint needs to serve one authenticated request for one
 * customer: the customer id (→ Fly app via the registry), the authored
 * connector block (enabled flag + `access[]` email→profile bindings + posture),
 * and the Clerk binding for token validation.
 */
export interface ResolvedMcpCustomer {
  customerId: string
  connector: McpConnector
  clerk: ClerkCustomerBinding
}

/**
 * SPIKE STUB. The pilot customer descriptor. Replaced in the live slice by a
 * read of the materialized `customer.yaml` (the `mcp_connector` block authored
 * in C1) keyed by the resource path, plus the provisioned Clerk binding.
 *
 * The `access` list here is intentionally empty: with no authored access entry,
 * EVERY email fails the authored-user check and the endpoint fail-closes. That
 * is the correct spike posture — the endpoint cannot grant access to anyone
 * until a real `customer.yaml` with a real `access[]` is wired in. The Captain
 * populates `issuer` from the Clerk dashboard (setup guide) to exercise the
 * discovery + OAuth handshake; identity mapping then 401s until `access[]` is
 * sourced from the real config, which is the documented next slice.
 */
const PILOT_STUB: ResolvedMcpCustomer = {
  customerId: 'smd',
  connector: {
    enabled: false,
    data_posture: 'open',
    access: [],
  },
  clerk: {
    // Captain fills this from the Clerk dashboard per mcp-clerk-setup.md.
    // Empty string ⇒ token validation fail-closes (no issuer to match).
    issuer: '',
    audience: null,
    authorizedParties: [],
  },
}

/**
 * Resolve the customer this MCP resource serves. SPIKE: a single resource path
 * maps to the pilot stub; anything else fail-closes to `null`.
 *
 * Live implementation: map the resource path → customer id (the MCP endpoint is
 * per-customer; the path or host carries the customer slug), then load the
 * materialized config + Clerk binding. Keep this signature so the route code
 * does not change when the stub is replaced.
 */
export function resolveMcpCustomer(resourcePath: string): ResolvedMcpCustomer | null {
  // SPIKE: the pilot is served at the single canonical MCP path. The live path
  // will carry the customer slug (e.g. `/api/mcp/<slug>`) and look it up.
  if (resourcePath === '/api/mcp' || resourcePath === '/api/mcp/') return PILOT_STUB
  return null
}
