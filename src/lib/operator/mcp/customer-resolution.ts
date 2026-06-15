/**
 * SPIKE SCAFFOLD (A0) — customer-resolution seam for the Operator ⇄ Claude MCP
 * connector. See docs/design/operator/03-mcp-server-exposure.md and the build
 * plan (Workstream A). This is the one seam the spike deliberately stubs: it
 * answers "which customer does this MCP request serve, and what is that
 * customer's authored `mcp_connector` block + Clerk binding?"
 *
 * SECURITY CONTRACT (from the console-hosting security review — these are app-code
 * authz invariants because one console validates tokens for ALL customers):
 *
 *   1. The customer is DERIVED FROM THE VERIFIED TOKEN — its `aud` when Clerk
 *      binds a per-resource audience (RFC 8707), else the per-customer `iss`
 *      (one Clerk app per customer ⇒ unique issuer). It is NEVER read from a URL
 *      path segment or request body. A path/body slug, if present, is UNTRUSTED
 *      and may only be used to CHECK-MATCH the token-derived customer, never to
 *      select it. A `/mcp/<customer>` routing shape would be a confused-deputy
 *      bug one layer up — so the endpoint serves ONE fixed path and the customer
 *      falls out of the token. See `resolveCustomerFromClaims`.
 *
 *   2. Cross-customer isolation rests entirely on `aud` (or the `iss` fallback)
 *      enforcement. `resolveCustomerFromClaims` returning the wrong/none customer
 *      for a token IS the cross-tenant wall; the validator gates on it before any
 *      per-user authorization or data access.
 *
 * Fail-closed: claims that match no registered customer resolve to `null` → the
 * endpoint refuses. This mirrors `resolveCustomerFlyApp` in fly-app-registry.ts,
 * which the live implementation will extend rather than duplicate.
 */

import type { McpConnector } from '../customer-yaml/types'

/**
 * The per-customer Clerk OAuth binding the token validator needs. One Clerk
 * OAuth application per customer is the isolation mechanism (see the `aud`-binding
 * open question in the Clerk setup guide): even if Clerk does not bind a
 * per-resource `aud`, the per-customer issuer + authorized client keep customer
 * B's token from resolving to — or validating against — customer A.
 */
export interface ClerkCustomerBinding {
  /**
   * The customer's Clerk instance issuer, e.g.
   * `https://clerk.smd.services` (prod) or `https://<slug>.clerk.accounts.dev`
   * (dev). Copied from the Clerk dashboard per the setup guide. The token's
   * `iss` claim MUST equal this exactly. When `audience` is null this `iss` is
   * ALSO the customer-identity key (the token-derived customer is whichever
   * registered binding owns this issuer).
   */
  issuer: string
  /**
   * Expected audience for tokens minted for this customer's MCP resource, when
   * Clerk binds a per-resource `aud` (RFC 8707). `null` when the instance does
   * not emit a resource-bound `aud` — in that case the customer is keyed off
   * `issuer` instead. When set, `aud` is BOTH the customer-identity key and the
   * mis-redemption gate. See the setup guide §6.
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

/** The subset of verified token claims used to derive the customer identity. */
export interface CustomerIdentityClaims {
  /** Verified `aud` claim (string or string[]); the primary customer key. */
  aud?: string | string[]
  /** Verified `iss` claim; the fallback customer key when `aud` is unbound. */
  iss?: string
}

/**
 * SPIKE STUB. The pilot customer descriptor. Replaced in the live slice by a
 * read of the materialized `customer.yaml` (the `mcp_connector` block authored
 * in C1) plus the provisioned Clerk binding, indexed for claim-based lookup.
 *
 * The `access` list here is intentionally empty: with no authored access entry,
 * EVERY email fails the per-user check and the endpoint fail-closes. That is the
 * correct spike posture — the endpoint cannot grant access to anyone until a real
 * `customer.yaml` with a real `access[]` is wired in. The Captain populates
 * `issuer` (and, per the §6 finding, `audience`) from the Clerk dashboard to
 * exercise discovery + OAuth; identity mapping then 401s until `access[]` is
 * sourced from the real config (the documented next slice).
 */
const PILOT_STUB: ResolvedMcpCustomer = {
  customerId: 'smd',
  connector: {
    enabled: false,
    data_posture: 'open',
    access: [],
  },
  clerk: {
    // Captain fills these from the Clerk dashboard per mcp-clerk-setup.md.
    // Empty issuer ⇒ no token can resolve to this customer (fail-closed).
    issuer: '',
    audience: null,
    authorizedParties: [],
  },
}

/** The registry of all customers this console serves. SPIKE: just the pilot. */
const CUSTOMERS: readonly ResolvedMcpCustomer[] = [PILOT_STUB]

/** Does the token's `aud` (string or array) include the customer's bound audience? */
function audMatches(aud: string | string[] | undefined, expected: string): boolean {
  if (aud === undefined) return false
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected
}

/**
 * SECURITY-CRITICAL (invariant 1 + 2): derive the customer from VERIFIED token
 * claims — never from a path or body. Call this ONLY with claims that came out of
 * a successful signature verification; passing unverified claims would let a
 * forged `aud`/`iss` select a customer.
 *
 * Resolution order, per the §6 audience finding:
 *   - If a registered customer binds an `audience` and the token's `aud` matches
 *     it → that customer. This is the RFC 8707 mis-redemption gate: a token whose
 *     `aud` is another resource matches no customer here and the validator 401s
 *     BEFORE any data access.
 *   - Else (no audience-bound match) fall back to the per-customer `iss`: the
 *     token's issuer uniquely identifies the customer's Clerk app (one app per
 *     customer). A customer whose binding has `audience: null` is matched by
 *     issuer; a customer WITH an audience is matched ONLY by audience (so an
 *     issuer-only match never bypasses a resource-bound customer).
 *
 * Returns the single matching customer, or `null` when none matches (fail-closed)
 * or when more than one matches (ambiguous ⇒ refuse rather than guess).
 */
export function resolveCustomerFromClaims(
  claims: CustomerIdentityClaims
): ResolvedMcpCustomer | null {
  // Pass 1: audience-bound customers (the strong, spec-compliant key).
  const audMatched = CUSTOMERS.filter(
    (c) => c.clerk.audience !== null && audMatches(claims.aud, c.clerk.audience)
  )
  if (audMatched.length === 1) return audMatched[0]
  if (audMatched.length > 1) return null // ambiguous → refuse

  // Pass 2: issuer-keyed customers (fallback when Clerk does not bind `aud`).
  // Only customers WITHOUT an audience binding are eligible here, so a token that
  // failed the audience match above cannot sidestep into an issuer match against a
  // resource-bound customer.
  if (typeof claims.iss !== 'string' || claims.iss.length === 0) return null
  const issMatched = CUSTOMERS.filter(
    (c) => c.clerk.audience === null && c.clerk.issuer.length > 0 && c.clerk.issuer === claims.iss
  )
  return issMatched.length === 1 ? issMatched[0] : null
}

/**
 * UNTRUSTED path check (invariant 1). The MCP endpoint serves ONE fixed resource
 * path; this only confirms a request hit that path. It does NOT and MUST NOT
 * select the customer — that comes from the verified token via
 * `resolveCustomerFromClaims`. If a future routing shape carries a slug in the
 * path/body, compare it against the token-derived `customerId` here and reject a
 * mismatch; never trust it to choose the customer.
 */
export const MCP_RESOURCE_PATH = '/api/mcp'

export function isMcpResourcePath(resourcePath: string): boolean {
  return resourcePath === MCP_RESOURCE_PATH || resourcePath === `${MCP_RESOURCE_PATH}/`
}

/**
 * Authorization-server issuers to advertise in the PUBLIC RFC 9728 discovery doc
 * for the MCP resource. This is discovery only — it tells a client WHERE to
 * authenticate and carries no customer-selecting power (isolation is enforced at
 * token validation via {@link resolveCustomerFromClaims}). Returns the distinct
 * non-empty issuers of every registered customer; empty when none provisioned
 * (honest "no AS configured", never fabricated).
 */
export function discoveryAuthorizationServers(): string[] {
  const issuers = CUSTOMERS.map((c) => c.clerk.issuer).filter((i) => i.length > 0)
  return [...new Set(issuers)]
}
