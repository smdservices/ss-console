import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'
import type { ResolvedMcpCustomer } from './customer-resolution'

const verifiedClaimsSchema = z.object({
  sub: z.string().min(1),
  iss: z.url(),
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  org_id: z.string().min(1).optional(),
  email: z.email().optional(),
})

export type McpAuthFailureReason =
  | 'missing_token'
  | 'signature_invalid'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'connector_disabled'
  | 'identity_not_authored'
  | 'organization_mismatch'

export type McpAuthResult =
  | {
      ok: true
      customer: ResolvedMcpCustomer
      subject: string
      localUserId: string
      email: string
      profile: string
    }
  | {
      ok: false
      reason: McpAuthFailureReason
      detail: string
      subject?: string
    }

export type McpTokenVerifier = (token: string, customer: ResolvedMcpCustomer) => Promise<unknown>

export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim())
  const token = match?.[1]?.trim()
  return token ? token : null
}

async function verifyPinnedClerkToken(
  token: string,
  customer: ResolvedMcpCustomer
): Promise<unknown> {
  const jwksUrl = new URL('/.well-known/jwks.json', customer.clerk.issuer)
  const jwks = createRemoteJWKSet(jwksUrl)
  const result = await jwtVerify(token, jwks, {
    algorithms: ['RS256'],
  })
  return result.payload
}

function audIncludes(aud: string | string[], expected: string): boolean {
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected
}

function validateClaims(
  rawClaims: unknown,
  customer: ResolvedMcpCustomer
): McpAuthResult | z.infer<typeof verifiedClaimsSchema> {
  const parsed = verifiedClaimsSchema.safeParse(rawClaims)
  if (!parsed.success) {
    return { ok: false, reason: 'signature_invalid', detail: 'required token claims are invalid' }
  }
  const claims = parsed.data
  if (claims.iss !== customer.clerk.issuer) {
    return { ok: false, reason: 'wrong_issuer', detail: 'token issuer does not match resource' }
  }
  if (!audIncludes(claims.aud, customer.clerk.resourceUri)) {
    return { ok: false, reason: 'wrong_audience', detail: 'token is not bound to this resource' }
  }
  if (customer.clerkOrgId && claims.org_id !== customer.clerkOrgId) {
    return {
      ok: false,
      reason: 'organization_mismatch',
      detail: 'token organization does not match customer',
      subject: claims.sub,
    }
  }
  return claims
}

export async function validateMcpToken(
  token: string | null,
  customer: ResolvedMcpCustomer,
  verifier: McpTokenVerifier = verifyPinnedClerkToken
): Promise<McpAuthResult> {
  if (!token) return { ok: false, reason: 'missing_token', detail: 'no bearer token' }

  let rawClaims: unknown
  try {
    rawClaims = await verifier(token, customer)
  } catch (err) {
    return {
      ok: false,
      reason: 'signature_invalid',
      detail: err instanceof Error ? err.message : 'token verification failed',
    }
  }

  const claims = validateClaims(rawClaims, customer)
  if ('ok' in claims) return claims
  if (!customer.connector.enabled) {
    return {
      ok: false,
      reason: 'connector_disabled',
      detail: 'mcp_connector is disabled',
      subject: claims.sub,
    }
  }

  const principal = customer.principals.find((entry) => entry.clerkUserId === claims.sub)
  if (!principal) {
    return {
      ok: false,
      reason: 'identity_not_authored',
      detail: 'Clerk subject is not authorized for this Operator',
      subject: claims.sub,
    }
  }

  return {
    ok: true,
    customer,
    subject: claims.sub,
    localUserId: principal.localUserId,
    email: principal.email,
    profile: principal.profile,
  }
}
