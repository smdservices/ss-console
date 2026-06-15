/**
 * Customer-resolution seam for the Operator ⇄ Claude MCP connector. See
 * docs/design/operator/03-mcp-server-exposure.md. This answers "which customer
 * does this MCP request serve, and what is that customer's authored
 * `mcp_connector` block + Clerk binding?" — now backed by D1, not a stub.
 *
 * SECURITY CONTRACT (from the console-hosting security review — these are app-code
 * authz invariants because one console validates tokens for ALL customers):
 *
 *   1. The customer is DERIVED FROM THE VERIFIED TOKEN — its `aud` when Clerk
 *      binds a per-resource audience (RFC 8707), else the per-customer `iss`. It
 *      is NEVER read from a URL path segment or request body. A path/body slug,
 *      if present, is UNTRUSTED and may only CHECK-MATCH the token-derived
 *      customer, never select it. The endpoint serves ONE fixed path and the
 *      customer falls out of the token. See `resolveCustomerFromClaims`.
 *
 *   2. Cross-customer isolation rests entirely on `aud` (or the `iss` fallback)
 *      enforcement. `resolveCustomerFromClaims` returning the wrong/none customer
 *      for a token IS the cross-tenant wall; the validator gates on it before any
 *      per-user authorization or data access.
 *
 * Data sources (the two-table data plane, migration 0071):
 *   - mcp_clerk_bindings — per-customer Clerk binding (issuer / client_id /
 *     audience). Provisioning OUTPUT; written when the Clerk OAuth app is created.
 *   - customer_configs.mcp_connector_json — the authored `mcp_connector` block
 *     (enabled / access[]), projected from customer.yaml (ADR 0012).
 *
 * Fail-closed: `loadMcpCustomers` returns `[]` when nothing is provisioned;
 * claims that match no customer resolve to `null` → the endpoint refuses. A
 * binding with no customer_configs row resolves its connector to the disabled
 * default (parseMcpConnector), so a token still 401s on the per-user check.
 */

import type { D1Database } from '@cloudflare/workers-types'
import type { McpConnector } from '../customer-yaml/types'
import { parseMcpConnector } from '../../portal/customer-config'

/**
 * The per-customer Clerk OAuth binding the token validator needs. One Clerk
 * OAuth application per customer is the isolation mechanism (see the `aud`-binding
 * open question in the Clerk setup guide): even if Clerk does not bind a
 * per-resource `aud`, the per-customer issuer + authorized client keep customer
 * B's token from resolving to — or validating against — customer A.
 */
export interface ClerkCustomerBinding {
  /**
   * The customer's Clerk instance issuer, e.g. `https://clerk.smd.services`
   * (prod) or `https://<slug>.clerk.accounts.dev` (dev). The token's `iss` claim
   * MUST equal this exactly. When `audience` is null this `iss` is ALSO the
   * customer-identity key.
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
 * customer: the customer id (→ Fly app via the registry), the authored connector
 * block (enabled flag + `access[]` email→profile bindings + posture), and the
 * Clerk binding for token validation.
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

/** The mcp_clerk_bindings ⋈ customer_configs row shape `loadMcpCustomers` reads. */
interface McpBindingRow {
  customer_slug: string
  issuer: string
  client_id: string
  audience: string | null
  mcp_connector_json: string | null
}

/**
 * Load every provisioned MCP customer from D1 — the registry the pure resolver
 * matches a token against. Reads the Clerk binding (mcp_clerk_bindings) joined to
 * the projected connector block (customer_configs.mcp_connector_json). A binding
 * with no config row LEFT-JOINs to a null connector_json, which parseMcpConnector
 * resolves to the fail-closed default (disabled) — so the customer is known for
 * resolution but grants no access until its config projects.
 *
 * Fail-closed: returns `[]` when nothing is provisioned (the dark default). The
 * read is small (one row per provisioned customer); Phase 1 has a handful.
 */
export async function loadMcpCustomers(db: D1Database): Promise<ResolvedMcpCustomer[]> {
  const { results } = await db
    .prepare(
      'SELECT b.customer_slug, b.issuer, b.client_id, b.audience, c.mcp_connector_json ' +
        'FROM mcp_clerk_bindings b ' +
        'LEFT JOIN customer_configs c ON c.entity_id = b.entity_id'
    )
    .all<McpBindingRow>()
  return (results ?? []).map((row) => ({
    customerId: row.customer_slug,
    connector: parseMcpConnector(row.mcp_connector_json),
    clerk: {
      issuer: row.issuer,
      // Treat empty-string audience as "no binding" (issuer-keyed fallback).
      audience: row.audience && row.audience.length > 0 ? row.audience : null,
      authorizedParties: row.client_id ? [row.client_id] : [],
    },
  }))
}

/** Does the token's `aud` (string or array) include the customer's bound audience? */
function audMatches(aud: string | string[] | undefined, expected: string): boolean {
  if (aud === undefined) return false
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected
}

/**
 * SECURITY-CRITICAL (invariant 1 + 2): derive the customer from VERIFIED token
 * claims — never from a path or body. Call this ONLY with claims that came out of
 * a successful signature verification; passing unverified claims would let a
 * forged `aud`/`iss` select a customer. `customers` is the provisioned registry
 * from {@link loadMcpCustomers}.
 *
 * Resolution order, per the §6 audience finding:
 *   - If a registered customer binds an `audience` and the token's `aud` matches
 *     it → that customer. This is the RFC 8707 mis-redemption gate: a token whose
 *     `aud` is another resource matches no customer here and the validator 401s
 *     BEFORE any data access.
 *   - Else fall back to the per-customer `iss`: the token's issuer identifies the
 *     customer's Clerk app. A customer whose binding has `audience: null` is
 *     matched by issuer; a customer WITH an audience is matched ONLY by audience
 *     (so an issuer-only match never bypasses a resource-bound customer).
 *
 * Returns the single matching customer, or `null` when none matches (fail-closed)
 * or when more than one matches (ambiguous ⇒ refuse rather than guess).
 */
export function resolveCustomerFromClaims(
  claims: CustomerIdentityClaims,
  customers: readonly ResolvedMcpCustomer[]
): ResolvedMcpCustomer | null {
  // Pass 1: audience-bound customers (the strong, spec-compliant key).
  const audMatched = customers.filter(
    (c) => c.clerk.audience !== null && audMatches(claims.aud, c.clerk.audience)
  )
  if (audMatched.length === 1) return audMatched[0]
  if (audMatched.length > 1) return null // ambiguous → refuse

  // Pass 2: issuer-keyed customers (fallback when Clerk does not bind `aud`).
  // Only customers WITHOUT an audience binding are eligible here, so a token that
  // failed the audience match above cannot sidestep into an issuer match against a
  // resource-bound customer.
  if (typeof claims.iss !== 'string' || claims.iss.length === 0) return null
  const issMatched = customers.filter(
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
 * non-empty issuers of the provisioned customers; empty when none provisioned
 * (honest "no AS configured", never fabricated).
 */
export function discoveryAuthorizationServers(customers: readonly ResolvedMcpCustomer[]): string[] {
  const issuers = customers.map((c) => c.clerk.issuer).filter((i) => i.length > 0)
  return [...new Set(issuers)]
}
