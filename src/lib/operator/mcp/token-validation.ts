/**
 * SPIKE SCAFFOLD (A0/A1) — fail-closed Clerk OAuth-token validation for the
 * Operator ⇄ Claude MCP connector.
 *
 * Build-vs-adapt finding (the spike's key result): Clerk's MCP helpers
 * (`@clerk/mcp-tools`) ship only Next.js/Express handlers and cannot be used
 * from Astro-on-Cloudflare-Workers. BUT the underlying verification primitive,
 * `verifyToken` from `@clerk/backend`, is runtime-agnostic (web-crypto, no Node
 * APIs — it is the same primitive `@clerk/astro` uses) and runs natively on CF
 * Workers. It fetches + caches the JWKS from the token issuer and checks the
 * RS256 signature for us. So we ADAPT (`verifyToken`) for the JWT layer rather
 * than hand-rolling JWKS + web-crypto.
 *
 * SECURITY ORDERING (from the console-hosting review — one console validates
 * tokens for ALL customers, so cross-tenant isolation is enforced HERE):
 *
 *   1. Verify the SIGNATURE first (against the token's own issuer JWKS). This
 *      yields trusted claims; nothing downstream trusts an unverified field.
 *   2. DERIVE THE CUSTOMER FROM THE VERIFIED `aud` (RFC 8707), else the
 *      per-customer `iss`. A valid-but-wrong-`aud` token matches NO customer and
 *      401s HERE — before any per-user authorization or data access. The customer
 *      is NEVER taken from a URL path or request body (invariant 1); the caller
 *      passes only the verified claims, and resolution happens off them. This is
 *      the single highest-leverage gate: cross-customer isolation rests on it.
 *   3. Enforce the customer's binding on the verified claims: `iss` pin, `azp`
 *      (authorized-party) pin, connector enabled.
 *   4. Map the identity (`email`) → the customer's authored `access[]` (the
 *      per-user authorization WITHIN the resolved customer). Unauthored ⇒ reject.
 *
 * Fail-closed everywhere: any throw, any missing claim, any unmatched customer or
 * identity resolves to a typed failure, never a silent pass.
 */

import { verifyToken } from '@clerk/backend'
import type { McpConnectorAccess } from '../customer-yaml/types'
import {
  resolveCustomerFromClaims,
  type CustomerIdentityClaims,
  type ResolvedMcpCustomer,
} from './customer-resolution'

/**
 * Outcome of validating one bearer token. A discriminated union so callers
 * cannot accidentally treat a failure as a success. On success it carries the
 * token-DERIVED customer (never path-derived) so the caller never re-resolves.
 */
export type McpAuthResult =
  | {
      ok: true
      /** The customer this token was issued for, derived from verified claims. */
      customer: ResolvedMcpCustomer
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
        | 'signature_invalid'
        | 'wrong_audience'
        | 'binding_mismatch'
        | 'connector_disabled'
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
 * `sub` (always present), `email` (present when the `email` scope is granted —
 * the setup guide requires it), and the identity claims `aud`/`iss`/`azp`.
 */
interface VerifiedClaims {
  sub?: unknown
  email?: unknown
  iss?: unknown
  aud?: unknown
  azp?: unknown
}

/** Narrow the permissive verified payload to the customer-identity claim shape. */
function toIdentityClaims(claims: VerifiedClaims): CustomerIdentityClaims {
  const aud =
    typeof claims.aud === 'string'
      ? claims.aud
      : Array.isArray(claims.aud) && claims.aud.every((a) => typeof a === 'string')
        ? claims.aud
        : undefined
  const iss = typeof claims.iss === 'string' ? claims.iss : undefined
  return { aud, iss }
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
 * Verify ONLY the token signature (and standard exp/nbf) against the token's own
 * issuer JWKS. We do NOT pass `audience`/`authorizedParties` here: the customer —
 * and therefore the expected aud/azp — is not known until AFTER we have trusted
 * claims to derive it from. The per-customer aud/iss/azp checks run explicitly in
 * `validateMcpToken` once the customer is resolved. Returns verified claims or a
 * failure.
 */
async function verifySignature(
  token: string
): Promise<VerifiedClaims | Extract<McpAuthResult, { ok: false }>> {
  try {
    // No `secretKey`: JWKS (public-key) verification is all an OAuth resource
    // server needs; the JWKS is discovered + cached from the token's `iss`.
    return await verifyToken(token, {})
  } catch (err) {
    return {
      ok: false,
      reason: 'signature_invalid',
      detail: err instanceof Error ? err.message : 'verifyToken threw',
    }
  }
}

/**
 * Enforce the resolved customer's Clerk binding on the verified claims:
 *   - `iss` MUST equal the customer's issuer (defense in depth — the customer was
 *     already derived from a verified claim, but we re-pin so a future multi-issuer
 *     registry cannot drift).
 *   - `azp` (authorized party) MUST be in the customer's allowlist when one is set.
 *   - the connector MUST be enabled.
 * Returns a failure, or null to proceed.
 */
function enforceBinding(
  claims: VerifiedClaims,
  customer: ResolvedMcpCustomer
): Extract<McpAuthResult, { ok: false }> | null {
  const iss = typeof claims.iss === 'string' ? claims.iss : null
  if (!iss || iss !== customer.clerk.issuer) {
    return { ok: false, reason: 'binding_mismatch', detail: `iss mismatch (got ${iss ?? 'none'})` }
  }
  const allowed = customer.clerk.authorizedParties
  if (allowed.length > 0) {
    const azp = typeof claims.azp === 'string' ? claims.azp : null
    if (!azp || !allowed.includes(azp)) {
      return {
        ok: false,
        reason: 'binding_mismatch',
        detail: `azp not authorized (got ${azp ?? 'none'})`,
      }
    }
  }
  if (!customer.connector.enabled) {
    return { ok: false, reason: 'connector_disabled', detail: 'mcp_connector disabled' }
  }
  return null
}

/**
 * Validate one bearer token. Fail-closed, security-ordered (see module header):
 * signature → customer-from-`aud` → binding pin → per-user `access[]`.
 *
 * The customer is the RESULT of validation, not an input — it is derived from the
 * verified token, never from the request path/body (invariant 1). A token whose
 * `aud` matches no customer here is rejected (`wrong_audience`) before any data
 * access (invariant 2).
 *
 * `customers` is the provisioned registry loaded from D1 by the route layer
 * (`loadMcpCustomers`). Passing it in (rather than reading D1 here) keeps this
 * validator pure and unit-testable. An empty registry ⇒ every token 401s
 * (`wrong_audience`) — the fail-closed dark default.
 */
export async function validateMcpToken(
  token: string | null,
  customers: readonly ResolvedMcpCustomer[]
): Promise<McpAuthResult> {
  if (!token) return { ok: false, reason: 'missing_token', detail: 'no bearer token' }

  // 1. Signature first — establishes trusted claims.
  const verified = await verifySignature(token)
  if ('ok' in verified) return verified
  const claims = verified

  // 2. Derive the customer FROM the verified claims (aud-first; iss fallback).
  //    This is the cross-tenant gate: a valid-but-wrong-aud token matches no
  //    customer and is rejected here, before any per-user authz or data access.
  const customer = resolveCustomerFromClaims(toIdentityClaims(claims), customers)
  if (!customer) {
    return {
      ok: false,
      reason: 'wrong_audience',
      detail: 'token aud/iss matches no configured customer',
    }
  }

  // 3. Enforce the resolved customer's binding on the verified claims.
  const bindingFailure = enforceBinding(claims, customer)
  if (bindingFailure) return bindingFailure

  // 4. Per-user authorization WITHIN the resolved customer.
  const subject = typeof claims.sub === 'string' ? claims.sub : null
  if (!subject) {
    return { ok: false, reason: 'signature_invalid', detail: 'no sub claim' }
  }
  const email = typeof claims.email === 'string' ? claims.email : null
  const authored = matchAuthoredAccess(email, customer.connector.access)
  if (!authored) {
    // Clerk-valid, right customer, but not an authored user (or no email claim).
    // Fail-closed: a valid token is necessary but NOT sufficient.
    return {
      ok: false,
      reason: 'identity_not_authored',
      detail: email ? `email ${email} not in access[]` : 'no email claim to map',
    }
  }

  return { ok: true, customer, subject, email: authored.email, profile: authored.profile }
}
