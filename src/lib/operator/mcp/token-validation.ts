/**
 * SPIKE SCAFFOLD (A0/A1) — fail-closed Clerk OAuth-token validation for the
 * Operator ⇄ Claude MCP connector.
 *
 * Build-vs-adapt finding (the spike's key result): Clerk's MCP helpers
 * (`@clerk/mcp-tools`) ship only Next.js/Express handlers and cannot be used
 * from Astro-on-Cloudflare-Workers. BUT the underlying verification primitive,
 * `verifyToken` from `@clerk/backend`, is runtime-agnostic (web-crypto, no Node
 * APIs — it is the same primitive `@clerk/astro` uses) and runs natively on CF
 * Workers. It fetches + caches the instance JWKS, checks the RS256 signature,
 * and validates `iss` / `aud` / `azp` for us. So we ADAPT (`verifyToken`) for
 * the JWT layer rather than hand-rolling JWKS + web-crypto.
 *
 * What this module adds on top of `verifyToken`:
 *   1. Per-customer issuer pin (`iss` MUST equal the customer's Clerk issuer).
 *   2. Per-customer audience/authorized-party binding (cross-tenant isolation:
 *      customer B's token must NOT validate against customer A — build-plan A1
 *      negative test).
 *   3. Identity → `access[]` mapping (the authored email → profile seam from
 *      C1). A Clerk-valid token whose identity is not an authored access entry
 *      is REJECTED (fail-closed).
 *
 * Fail-closed everywhere: any throw, any missing claim, any unmatched identity
 * resolves to a typed failure, never a silent pass.
 */

import { verifyToken } from '@clerk/backend'
import type { McpConnectorAccess } from '../customer-yaml/types'
import type { ResolvedMcpCustomer } from './customer-resolution'

/**
 * Outcome of validating one bearer token against one customer. A discriminated
 * union so callers cannot accidentally treat a failure as a success.
 */
export type McpAuthResult =
  | {
      ok: true
      /** Clerk user id (`sub`) — the stable subject for audit rows. */
      subject: string
      /** Authored email this token mapped to (from `access[]`). */
      email: string
      /** Persona/profile slug the email is bound to (the per-user seam). */
      profile: string
    }
  | {
      ok: false
      /** Machine-readable reason; surfaced as `MCP_AUTH` audit decision. */
      reason:
        | 'missing_token'
        | 'customer_not_configured'
        | 'connector_disabled'
        | 'signature_or_claims_invalid'
        | 'identity_not_authored'
      /** Human-readable detail for logs (never returned to the client verbatim). */
      detail: string
    }

/**
 * Extract the bearer token from an Authorization header. Returns null when
 * absent or malformed — the caller emits the RFC 9728 `WWW-Authenticate`
 * challenge in that case.
 */
export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null
  const m = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim())
  if (!m) return null
  const token = m[1].trim()
  return token.length > 0 ? token : null
}

/**
 * The subset of the verified Clerk JWT payload we read. Kept local + permissive
 * because the OAuth access-token claim set depends on granted scopes; we read
 * `sub` (always present) and `email` (present when the `email` scope is granted,
 * which the setup guide requires).
 */
interface VerifiedClaims {
  sub?: unknown
  email?: unknown
  iss?: unknown
}

/**
 * Map a verified subject/email to an authored `access[]` entry. Email is the
 * authored key (C1). We match on email when the token carries it; this is why
 * the Clerk OAuth app MUST grant the `email` scope (setup guide). The `sub` is
 * retained for audit even when the match is by email.
 *
 * SEAM NOTE: if a deployment cannot guarantee `email` in the token, the live
 * slice resolves `sub` → email via the Clerk Backend API (one cached lookup)
 * before this match. That lookup is deliberately NOT in the spike — it needs a
 * live Clerk app + secret key — and its absence is fail-closed (no email ⇒ no
 * match ⇒ reject).
 */
function matchAuthoredAccess(
  email: string | null,
  access: readonly McpConnectorAccess[]
): McpConnectorAccess | null {
  if (!email) return null
  const normalized = email.trim().toLowerCase()
  for (const entry of access) {
    if (entry.email.trim().toLowerCase() === normalized) return entry
  }
  return null
}

/**
 * The pre-flight gates that don't require the token signature: token present,
 * customer configured + enabled, issuer provisioned. Returns a failure result
 * to short-circuit, or `null` to proceed to signature verification.
 */
function preflightFailure(
  token: string | null,
  customer: ResolvedMcpCustomer | null
): Extract<McpAuthResult, { ok: false }> | null {
  if (!token) return { ok: false, reason: 'missing_token', detail: 'no bearer token' }
  if (!customer) {
    return { ok: false, reason: 'customer_not_configured', detail: 'unknown resource' }
  }
  if (!customer.connector.enabled) {
    return { ok: false, reason: 'connector_disabled', detail: 'mcp_connector disabled' }
  }
  if (!customer.clerk.issuer) {
    // Spike stub ships with an empty issuer until the Captain provisions the
    // Clerk app. No issuer ⇒ we cannot pin `iss` ⇒ refuse rather than trust.
    return { ok: false, reason: 'customer_not_configured', detail: 'clerk issuer not provisioned' }
  }
  return null
}

/**
 * Verify the token signature + claims against the customer's Clerk binding.
 * `verifyToken` fetches + caches the JWKS from the issuer, verifies the RS256
 * signature, and enforces audience / authorizedParties when supplied. Returns
 * the verified claims, or a failure result.
 */
async function verifyClaims(
  token: string,
  customer: ResolvedMcpCustomer
): Promise<VerifiedClaims | Extract<McpAuthResult, { ok: false }>> {
  try {
    // No `secretKey`: signature verification is JWKS-based (public-key), which is
    // all an OAuth resource server needs. The JWKS is discovered from the token
    // issuer. (The live slice may pass the per-customer `secretKey` if a
    // Backend-API `sub`→email lookup is wired; not needed for the spike.)
    return await verifyToken(token, {
      authorizedParties:
        customer.clerk.authorizedParties.length > 0 ? customer.clerk.authorizedParties : undefined,
      audience: customer.clerk.audience ?? undefined,
    })
  } catch (err) {
    return {
      ok: false,
      reason: 'signature_or_claims_invalid',
      detail: err instanceof Error ? err.message : 'verifyToken threw',
    }
  }
}

/**
 * Validate one bearer token against one resolved customer. Fail-closed.
 *
 * Order of checks (each fails closed):
 *   1. token present
 *   2. customer configured + connector enabled
 *   3. Clerk issuer pinned (no issuer ⇒ refuse; the spike stub ships empty)
 *   4. signature + `aud`/`azp` via `verifyToken`, then `iss` pinned per-customer
 *   5. identity (email) matches an authored `access[]` entry
 */
export async function validateMcpToken(
  token: string | null,
  customer: ResolvedMcpCustomer | null
): Promise<McpAuthResult> {
  const preflight = preflightFailure(token, customer)
  if (preflight) return preflight
  // Both non-null after preflight.
  const safeCustomer = customer as ResolvedMcpCustomer
  const safeToken = token as string

  const claimsOrFail = await verifyClaims(safeToken, safeCustomer)
  if ('ok' in claimsOrFail) return claimsOrFail
  const claims = claimsOrFail

  // Pin the issuer per-customer (cross-tenant isolation). `verifyToken` checks
  // the signature against the discovered JWKS; we additionally require the
  // issuer to be exactly this customer's.
  const iss = typeof claims.iss === 'string' ? claims.iss : null
  if (!iss || iss !== safeCustomer.clerk.issuer) {
    return {
      ok: false,
      reason: 'signature_or_claims_invalid',
      detail: `iss mismatch (got ${iss ?? 'none'})`,
    }
  }

  const subject = typeof claims.sub === 'string' ? claims.sub : null
  if (!subject) {
    return { ok: false, reason: 'signature_or_claims_invalid', detail: 'no sub claim' }
  }
  const email = typeof claims.email === 'string' ? claims.email : null

  const authored = matchAuthoredAccess(email, safeCustomer.connector.access)
  if (!authored) {
    // Clerk-valid but not an authored user (or no email in token). Fail-closed:
    // a valid token is necessary but NOT sufficient — the email must be authored
    // in `access[]`. This is also where customer B's valid token (wrong customer
    // entirely) lands if it somehow reached customer A's resource: its email is
    // not in A's `access[]`.
    return {
      ok: false,
      reason: 'identity_not_authored',
      detail: email ? `email ${email} not in access[]` : 'no email claim to map',
    }
  }

  return { ok: true, subject, email: authored.email, profile: authored.profile }
}
